// Shared harness for the G00.03.b negative suite (spike docs/architecture/09 §5).
// It is deliberately separate from the .a suite harness: here every server
// instance reports its provider traffic and exposes the URL signing key, so
// tests can forge tokens and count entitlement checks. Everything runs on the
// local test transport (mock provider + mock store) on loopback; live probes
// live in live-remote.test.mjs and are skipped unless G00_03_B_LIVE_URL is set.
// No check here proves a real store, a real RevenueCat deployment or a real
// device — those stay with G00.03.c.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGrantServer } from '../server/grant-server.mjs';
import { createTestProvider } from '../server/provider.mjs';
import { createPurchaseClient } from '../client/purchase-client.mjs';
import { createTestStorePort, createTestStoreSim } from '../client/store-port.mjs';

export const SPIKE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE_ROOT = join(SPIKE_ROOT, 'data', 'storage');
export const MANIFEST_BASE = 'g00-03-spike/2026-09-15.1/be/extended';
export const PRODUCT = 'kudy.spike.g00_03.story_01';
export const ROUTE_ID = 'g00-03-spike';
export const VERSION = '2026-09-15.1';
export const LOCALE = 'be';
export const TIER = 'extended';
export const PATH_OK = 'transcripts/private-story-01.be.txt';
export const PATH_NON_MEMBER = 'transcripts/private-story-02.be.txt';
// Set to a running server base URL to point the live probes at it; the mock
// suite ignores it and the live file self-skips without it.
export const LIVE_URL = process.env.G00_03_B_LIVE_URL ?? null;

export const CATALOG = JSON.parse(readFileSync(join(SPIKE_ROOT, 'server', 'catalog.json'), 'utf8'));
export const CATALOG_REQUEST = {
  productId: PRODUCT,
  routeId: ROUTE_ID,
  version: VERSION,
  locale: LOCALE,
  tier: TIER,
  paths: [PATH_OK],
};
export const GRANT_BODY = {
  route_id: ROUTE_ID,
  version: VERSION,
  locale: LOCALE,
  tier: TIER,
  paths: [PATH_OK],
};

let scratchCounter = 0;
export function scratchDir(label) {
  scratchCounter += 1;
  return mkdtempSync(join(tmpdir(), `kudy-g00-03-b-${label}-${scratchCounter}-`));
}

// Provider traffic counter wrapped around the store-backed test provider: the
// cache-bypass checks need to see whether the server actually asked.
export function makeRig({ storeEnvironment = 'sandbox' } = {}) {
  const store = createTestStoreSim({ environment: storeEnvironment });
  const target = createTestProvider({ store });
  let asks = 0;
  const provider = {
    async verifyEntitlement(question) {
      asks += 1;
      return target.verifyEntitlement(question);
    },
  };
  return { store, provider, providerAsks: () => asks };
}

// One loopback server over a rig. `signingKey` is hoisted so a test can mint
// tokens the way a signing-key holder would; `devicesFile` can be shared
// between two servers (used by the mutation checks); `factory` lets the
// mutation file boot a mutated grant-server implementation over the same rig.
export async function serve(t, rig, {
  label = 'srv',
  serverEnvironment = 'sandbox',
  urlTtlSeconds = 600,
  cacheTtlSeconds = 86400,
  devicesFile = null,
  signingKey = randomBytes(32),
  factory = createGrantServer,
} = {}) {
  const workDir = devicesFile ? null : scratchDir(label);
  const work = devicesFile ?? join(workDir, 'runtime', 'devices.json');
  if (workDir) t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const events = [];
  const listening = factory({
    catalog: CATALOG,
    devicesFile: work,
    storageRoot: STORAGE_ROOT,
    provider: rig.provider,
    urlSigningKey: signingKey,
    urlTtlSeconds,
    entitlementCacheTtlSeconds: cacheTtlSeconds,
    environment: serverEnvironment,
    log: (event, fields) => events.push({ event, ...fields }),
  });
  await new Promise((done) => listening.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${listening.address().port}`;
  t.after(() => listening.close());
  return { base, events, signingKey, devicesFile: work };
}

export function clientAt(base, store, storeAccount) {
  return createPurchaseClient({
    serverBaseUrl: base,
    storePort: createTestStorePort({ store, storeAccount }),
  });
}

// Register a device and bind a purchase to it on the given server. The setup
// grant itself may fail (that is the negative under test in the environment
// cases); the purchase always binds the device, and `purchase` is returned so
// a test can assert on it.
export async function entitledDevice(t, rig, { base, store, account = 'acct-1' }) {
  const client = clientAt(base, store, account);
  const registration = await client.register();
  const purchase = await client.purchaseAndGrant(CATALOG_REQUEST);
  return {
    client,
    registration,
    deviceId: registration.deviceId,
    secret: registration.deviceSecret,
    purchase,
  };
}

// Raw grant probe; never prints or returns the bearer secret. Sends the exact
// Authorization header value given (null = no header), so malformed scheme
// shapes reach the server verbatim; postGrant wraps a device secret instead.
export async function postGrantRaw(base, authorizationHeader, payload) {
  const headers = { 'content-type': 'application/json' };
  if (authorizationHeader !== null) headers.authorization = authorizationHeader;
  let response;
  try {
    response = await fetch(`${base}/v1/grant`, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (error) {
    return { status: 0, code: null, body: null, urls: null, transportError: String(error?.cause?.code ?? error?.message ?? error) };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, code: body?.error?.code ?? null, body, urls: body?.urls ?? null };
}

export function postGrant(base, deviceSecret, payload) {
  return postGrantRaw(base, deviceSecret === null ? null : `Bearer ${deviceSecret}`, payload);
}
