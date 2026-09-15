// Automated checks for the G00.03.a spike. Everything here runs against the
// local test transport (mock provider + mock store) on loopback; no check in
// this file proves a real store, a real RevenueCat deployment or a real
// device — those are G00.03.b/.c lanes. Contract shapes follow
// docs/architecture/09 §5.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGrantServer } from '../server/grant-server.mjs';
import { createRevenueCatProvider, createTestProvider } from '../server/provider.mjs';
import { createPurchaseClient } from '../client/purchase-client.mjs';
import { createTestStorePort, createTestStoreSim } from '../client/store-port.mjs';

const spikeRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const storageRoot = join(spikeRoot, 'data', 'storage');
const fixturePath = join(storageRoot, 'g00-03-spike', '2026-09-15.1', 'be', 'extended', 'transcripts', 'private-story-01.be.txt');
const fixtureBytes = readFileSync(fixturePath);

const PRODUCT = 'kudy.spike.g00_03.story_01';
const ROUTE_ID = 'g00-03-spike';
const VERSION = '2026-09-15.1';
const LOCALE = 'be';
const TIER = 'extended';
const PATH_OK = 'transcripts/private-story-01.be.txt';

const catalog = JSON.parse(readFileSync(join(spikeRoot, 'server', 'catalog.json'), 'utf8'));

const catalogRequest = {
  productId: PRODUCT,
  routeId: ROUTE_ID,
  version: VERSION,
  locale: LOCALE,
  tier: TIER,
  paths: [PATH_OK],
};

async function startServer(t, {
  environment = 'sandbox',
  store,
  urlTtlSeconds = 600,
  entitlementCacheTtlSeconds = 86400,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'kudy-g00-03-a-'));
  const logs = [];
  const server = createGrantServer({
    catalog,
    devicesFile: join(scratch, 'runtime', 'devices.json'),
    storageRoot,
    provider: createTestProvider({ store }),
    urlSigningKey: randomBytes(32),
    urlTtlSeconds,
    entitlementCacheTtlSeconds,
    environment,
    log: (event, fields) => logs.push({ event, ...fields }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => server.close());
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  return { baseUrl: `http://127.0.0.1:${port}`, logs };
}

function clientFor(baseUrl, store, storeAccount) {
  return createPurchaseClient({
    serverBaseUrl: baseUrl,
    storePort: createTestStorePort({ store, storeAccount }),
  });
}

async function registerAndPurchase(t, {
  storeAccount = 'store-account-1',
  environment,
  urlTtlSeconds,
  entitlementCacheTtlSeconds,
} = {}) {
  const store = createTestStoreSim();
  const { baseUrl, logs } = await startServer(t, { environment, store, urlTtlSeconds, entitlementCacheTtlSeconds });
  const client = clientFor(baseUrl, store, storeAccount);
  const registration = await client.register();
  const granted = await client.purchaseAndGrant(catalogRequest);
  return { store, baseUrl, logs, client, registration, granted };
}

test('purchase → grant → download delivers only the manifest member file', async (t) => {
  const { client, registration, granted } = await registerAndPurchase(t);
  assert.match(registration.deviceId, /^[0-9a-f-]{36}$/, 'device_id is a UUID');
  assert.equal(Buffer.from(registration.deviceSecret, 'base64url').length, 32, 'device_secret is 32 bytes');
  assert.equal(granted.ok, true, JSON.stringify(granted));
  assert.equal(typeof granted.lockUrl, 'string');
  assert.equal(granted.urls.length, 1);
  assert.equal(granted.urls[0].path, PATH_OK);
  assert.match(granted.urls[0].url, /^\/private\//);
  assert.ok(granted.urls[0].expires_at > Date.now());
  const downloaded = await client.download(granted.urls[0]);
  assert.equal(downloaded.ok, true);
  assert.deepEqual(downloaded.bytes, fixtureBytes);
});

test('bought=true without a purchase gets 403 no_entitlement and zero private bytes', async (t) => {
  const store = createTestStoreSim();
  const { baseUrl } = await startServer(t, { store });
  const client = clientFor(baseUrl, store, 'store-account-1');
  await client.register();
  client.markBoughtWithoutPurchase();
  assert.equal(client.bought(), true);
  const granted = await client.requestGrant(catalogRequest);
  assert.equal(granted.ok, false);
  assert.equal(granted.status, 403);
  assert.equal(granted.code, 'no_entitlement');
  assert.ok(!granted.urls);
});

test('a wrong bearer device secret is refused', async (t) => {
  const store = createTestStoreSim();
  const { baseUrl } = await startServer(t, { store });
  const response = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${Buffer.from('not-the-secret').toString('base64url')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ route_id: ROUTE_ID, version: VERSION, locale: LOCALE, tier: TIER, paths: [PATH_OK] }),
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'device_auth_failed');
});

test('provider outage with no cache fails closed: 503 + Retry-After, never 403', async (t) => {
  const { store, baseUrl, registration, granted } = await registerAndPurchase(t, { entitlementCacheTtlSeconds: 0 });
  assert.equal(granted.ok, true);
  store.setAvailable(false);
  const response = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${registration.deviceSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ route_id: ROUTE_ID, version: VERSION, locale: LOCALE, tier: TIER, paths: [PATH_OK] }),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '30');
  const body = await response.json();
  assert.equal(body.error.code, 'entitlement_unavailable');
  store.setAvailable(true);
  const client = clientFor(baseUrl, store, 'store-account-1');
  await client.register();
  void client;
  const recovered = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${registration.deviceSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ route_id: ROUTE_ID, version: VERSION, locale: LOCALE, tier: TIER, paths: [PATH_OK] }),
  });
  assert.equal(recovered.status, 200, 'recovery without fallback artifacts');
});

test('a cached positive verdict keeps downloads alive through a provider outage', async (t) => {
  const { store, logs, client, granted } = await registerAndPurchase(t);
  assert.equal(granted.ok, true);
  store.setAvailable(false);
  const nextBatch = await client.requestGrant({ ...catalogRequest, paths: [PATH_OK] });
  assert.equal(nextBatch.ok, true, 'resume works from the positive cache');
  assert.equal(nextBatch.urls.length, 1);
  const downloaded = await client.download(nextBatch.urls[0]);
  assert.deepEqual(downloaded.bytes, fixtureBytes);
  assert.ok(logs.some((entry) => entry.event === 'entitlement_cache_hit'));
});

test('non-member and unsafe paths are refused', async (t) => {
  const { client } = await registerAndPurchase(t);
  const candidates = [
    'transcripts/other-story.txt',
    '../outside.txt',
    'transcripts/../../outside.txt',
    '/etc/passwd',
    'https://evil.example/file',
    'C:/win.ini',
    '',
  ];
  for (const candidate of candidates) {
    const granted = await client.requestGrant({ ...catalogRequest, paths: [candidate] });
    assert.equal(granted.status, 403, candidate);
    assert.equal(granted.code, 'path_not_allowed', candidate);
  }
});

test('grant errors expose only an error code, never the storage layout', async (t) => {
  const store = createTestStoreSim();
  const { baseUrl } = await startServer(t, { store });
  const client = clientFor(baseUrl, store, 'store-account-1');
  const registration = await client.register();
  const raw = await client.requestGrant({ ...catalogRequest, paths: ['../x'] });
  assert.equal(raw.status, 403);
  assert.deepEqual(Object.keys(raw), ['ok', 'status', 'code']);
  assert.match(raw.code, /^[a-z_]+$/);
  const badShape = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: { authorization: `Bearer ${registration.deviceSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ anything: 'unvalidated' }),
  });
  const body = await badShape.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error), ['code']);
});

test('the client cannot make the server map an arbitrary route or tier', async (t) => {
  const { client } = await registerAndPurchase(t);
  const wrongRoute = await client.requestGrant({ ...catalogRequest, routeId: 'another-route' });
  assert.equal(wrongRoute.status, 403);
  assert.equal(wrongRoute.code, 'unknown_route_tier');
  const wrongTier = await client.requestGrant({ ...catalogRequest, tier: 'base' });
  assert.equal(wrongTier.status, 403);
  assert.equal(wrongTier.code, 'unknown_route_tier');
});

test('an unmapped version or locale has no manifest', async (t) => {
  const { client } = await registerAndPurchase(t);
  const wrongVersion = await client.requestGrant({ ...catalogRequest, version: '9999-99-99.9' });
  assert.equal(wrongVersion.status, 403);
  assert.equal(wrongVersion.code, 'manifest_not_found');
  const wrongLocale = await client.requestGrant({ ...catalogRequest, locale: 'en' });
  assert.equal(wrongLocale.status, 403);
  assert.equal(wrongLocale.code, 'manifest_not_found');
});

test('restore on a fresh device grants the same purchase without a second payment', async (t) => {
  const store = createTestStoreSim();
  const { baseUrl } = await startServer(t, { store });
  const first = clientFor(baseUrl, store, 'store-account-1');
  await first.register();
  const purchased = await first.purchaseAndGrant(catalogRequest);
  assert.equal(purchased.ok, true);
  assert.equal(store.payments(), 1);

  const second = clientFor(baseUrl, store, 'store-account-1');
  await second.register();
  const restored = await second.restoreAndGrant(catalogRequest);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.urls.length, 1);
  const downloaded = await second.download(restored.urls[0]);
  assert.deepEqual(downloaded.bytes, fixtureBytes);
  assert.equal(store.payments(), 1, 'restore must not charge again');
});

test('expired URL is refused; a fresh grant needs device authorization again', async (t) => {
  const { baseUrl, client, granted } = await registerAndPurchase(t, { urlTtlSeconds: 1 });
  assert.equal(granted.ok, true);
  const first = await client.download(granted.urls[0]);
  assert.equal(first.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await client.download(granted.urls[0]);
  assert.equal(expired.status, 403);
  assert.equal(expired.code, 'url_expired');

  const anonymous = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route_id: ROUTE_ID, version: VERSION, locale: LOCALE, tier: TIER, paths: [PATH_OK] }),
  });
  assert.equal(anonymous.status, 403);
  const regranted = await client.requestGrant(catalogRequest);
  assert.equal(regranted.ok, true, 'regrant with device authorization works');
  const refreshed = await client.download(regranted.urls[0]);
  assert.equal(refreshed.ok, true);
});

test('sandbox entitlement does not open a production resource', async (t) => {
  const { granted } = await registerAndPurchase(t, { environment: 'production' });
  assert.equal(granted.status, 403);
  assert.equal(granted.code, 'environment_mismatch');
  assert.ok(!granted.urls);
});

test('a client-supplied user_id cannot borrow another device entitlement', async (t) => {
  const store = createTestStoreSim();
  const { baseUrl } = await startServer(t, { store });
  const entitled = clientFor(baseUrl, store, 'store-account-1');
  const { deviceId: entitledDeviceId } = await entitled.register();
  assert.equal((await entitled.purchaseAndGrant(catalogRequest)).ok, true);

  const stranger = clientFor(baseUrl, store, 'store-account-2');
  const strangerDevice = await stranger.register();
  const response = await fetch(`${baseUrl}/v1/grant`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${strangerDevice.deviceSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      route_id: ROUTE_ID,
      version: VERSION,
      locale: LOCALE,
      tier: TIER,
      paths: [PATH_OK],
      user_id: entitledDeviceId,
    }),
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'no_entitlement');
});

test('tampered tokens are refused', async (t) => {
  const { client, granted } = await registerAndPurchase(t);
  assert.equal(granted.ok, true);
  const tamperedUrl = `${granted.urls[0].url.slice(0, -2)}xy`;
  const denied = await client.download({ ...granted.urls[0], url: tamperedUrl });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, 'url_invalid');
});

test('logs hold codes and states only — no secrets, receipts or signed URLs', async (t) => {
  const { baseUrl, logs, client, registration, granted } = await registerAndPurchase(t);
  assert.equal(granted.ok, true);
  await client.requestGrant({ ...catalogRequest, paths: ['transcripts/other-story.txt'] });
  await fetch(`${baseUrl}/private/${'x'.repeat(40)}`, { method: 'POST' });
  const tampered = await client.download({ ...granted.urls[0], url: `${granted.urls[0].url.slice(0, -2)}xy` });
  assert.equal(tampered.status, 403);

  const serialized = JSON.stringify(logs);
  assert.ok(logs.length > 0);
  assert.ok(!serialized.includes(registration.deviceSecret));
  assert.ok(!serialized.includes(registration.deviceId));
  assert.ok(!serialized.includes(granted.urls[0].url));
  assert.ok(!serialized.includes('/private/'));
  assert.ok(!serialized.toLowerCase().includes('bearer'));
  assert.ok(!serialized.toLowerCase().includes('receipt'));
  assert.ok(logs.some((entry) => entry.event === 'grant_issued'));
  assert.ok(logs.some((entry) => entry.event === 'file_denied'));
  assert.ok(logs.every((entry) => entry.device_hash === undefined || /^[0-9a-f]{16}$/.test(entry.device_hash)));
});

test('createPurchaseClient rejects insecure non-loopback base URLs', () => {
  const store = createTestStoreSim();
  assert.throws(
    () => createPurchaseClient({ serverBaseUrl: 'http://example.com', storePort: createTestStorePort({ store, storeAccount: 'a' }) }),
    /https/,
  );
  for (const okBase of ['https://grant.example.com', 'http://127.0.0.1:8642', 'http://localhost:8642']) {
    createPurchaseClient({ serverBaseUrl: okBase, storePort: createTestStorePort({ store, storeAccount: 'a' }) });
  }
});

test('register() rejects a failed registration and keeps no device', async () => {
  const store = createTestStoreSim();
  const client = createPurchaseClient({
    serverBaseUrl: 'http://127.0.0.1:1',
    storePort: createTestStorePort({ store, storeAccount: 'a' }),
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'entitlement_unavailable' } }),
    }),
  });
  await assert.rejects(client.register(), /device registration failed \(500\)/);
  await assert.rejects(client.purchaseAndGrant(catalogRequest), /not registered/);
  assert.equal(client.deviceId(), null);
});

test('the live RevenueCat provider refuses non-https base URLs', () => {
  assert.throws(
    () => createRevenueCatProvider({ secretApiKey: 'sk_placeholder', baseUrl: 'http://127.0.0.1:1' }),
    /https/,
  );
  assert.doesNotThrow(() => createRevenueCatProvider({ secretApiKey: 'sk_placeholder' }));
});

test('the live RC adapter reads product_identifier and fails closed on unknown environment', async () => {
  const provider = createRevenueCatProvider({
    secretApiKey: 'sk_placeholder',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ subscriber: { entitlements: { pro: { product_identifier: PRODUCT } } } }),
    }),
  });
  const verdict = await provider.verifyEntitlement({ deviceId: 'd1', productId: PRODUCT });
  assert.equal(verdict.ok, false, 'entitled answer without environment attribution fails closed');
  assert.equal(verdict.detail, 'environment_undeterminable');
});

test('the live RC adapter treats 404 as no entitlement and other http errors as unavailable', async () => {
  const notFound = createRevenueCatProvider({
    secretApiKey: 'sk_placeholder',
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  assert.deepEqual(
    await notFound.verifyEntitlement({ deviceId: 'd1', productId: PRODUCT }),
    { ok: true, entitled: false, environment: null },
  );
  const unavailable = createRevenueCatProvider({
    secretApiKey: 'sk_placeholder',
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  const down = await unavailable.verifyEntitlement({ deviceId: 'd1', productId: PRODUCT });
  assert.equal(down.ok, false);
  assert.equal(down.reason, 'unavailable');
});
