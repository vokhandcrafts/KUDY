// G20.25 — adapter tests for the production /v1/grant wire handler (spec N7:
// «Тэст праходзіць вытворчы апрацоўшчык і адрознівае гэтыя прычыны»). Every
// suite drives `serveGrantRequest` — the same function the Deno entrypoint
// serves — through the real bearer auth, the real manifest loader, the real
// RevenueCat adapter and the real signer; only the transports are fakes
// (the device-wire precedent): SQL answers the pinned statement constants
// and `globalThis.fetch` routes by URL to a fake Storage/RevenueCat edge —
// no live deployment anywhere. The N7 cases fail when the corrupted-manifest
// guard in loadManifestDoc is removed: a malformed body then escapes into
// the fault boundary as 503 instead of the closed 403.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { GRANT_ERRORS } from '../../../services/download/grant.ts';

import { bearerSecretHash, DEVICE_LOOKUP_SQL } from './device-core.ts';
import {
  GRANT_CACHE_CAP_SQL,
  GRANT_CACHE_READ_SQL,
  GRANT_CACHE_SWEEP_EXPIRED_SQL,
  GRANT_CACHE_WRITE_SQL,
  GRANT_PRODUCT_LOOKUP_SQL,
  GRANT_RATE_INCREMENT_SQL,
  GRANT_RETRY_AFTER_SECONDS,
} from './grant-core.ts';
import { serveGrantRequest, type GrantRuntimeConfig, type GrantSqlClient } from './grant-wire.ts';
import { captureConsoleError } from './wire-test-support.ts';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_SECRET = 'test-device-secret';
const MANIFEST_LOCK_URL = 'https://files.test/demo-route/v1/be/extended/lock.json';
const REQUEST_BODY = { route_id: 'demo-route', version: 'v1', locale: 'be', tier: 'extended', paths: ['a.txt'] };

const CONFIG: GrantRuntimeConfig = {
  environment: 'sandbox',
  revenueCatSecret: 'rc-secret',
  revenueCatBase: 'https://rc.test',
  supabaseUrl: 'https://storage.test',
  serviceRoleKey: 'role-key',
  bucket: 'files',
  urlTtlSeconds: 600,
  cacheTtlSeconds: 86400,
};

function assertClosedList(status: number, code: string): void {
  const entry = GRANT_ERRORS.find((candidate) => candidate.code === code);
  assert.ok(entry, `${code} must exist on the client closed list`);
  assert.equal(entry.status, status, `${code} keeps its closed-list status`);
}

function grantRequest(body: unknown): Request {
  return new Request('https://edge.test/functions/v1/grant', {
    method: 'POST',
    headers: { authorization: `Bearer ${DEVICE_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fakeGrantSql(seed: { cacheRow?: Record<string, unknown> } = {}): GrantSqlClient {
  return {
    async unsafe(sql: string, params: (string | number | boolean | null)[]) {
      if (sql === DEVICE_LOOKUP_SQL) {
        assert.equal(params[0], bearerSecretHash(`Bearer ${DEVICE_SECRET}`), 'the lookup receives the bearer hash');
        return [{ device_id: DEVICE_ID }];
      }
      if (sql === GRANT_PRODUCT_LOOKUP_SQL) return [{ product_id: 'demo.product.01' }];
      if (sql === GRANT_RATE_INCREMENT_SQL) return [{ attempts: 1 }];
      if (sql === GRANT_CACHE_READ_SQL) return seed.cacheRow ? [seed.cacheRow] : [];
      if (sql === GRANT_CACHE_WRITE_SQL || sql === GRANT_CACHE_SWEEP_EXPIRED_SQL || sql === GRANT_CACHE_CAP_SQL) {
        return [];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

interface TransportSeed {
  /** Raw manifest bytes served by the fake Storage GET. */
  body?: string;
  status?: number;
  /** The storage transport itself fails (a genuine network fault). */
  fail?: Error;
  /** RevenueCat answer body; default `{}`. */
  providerBody?: string;
  providerFail?: Error;
}

interface TransportCounts {
  manifest: number;
  sign: number;
  provider: number;
}

function installTransport(t: TestContext, seed: TransportSeed = {}): TransportCounts {
  const counts: TransportCounts = { manifest: 0, sign: 0, provider: 0 };
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/storage/v1/object/sign/')) {
      counts.sign += 1;
      return Promise.resolve(new Response(JSON.stringify({ signedURL: '/object/sign/fake?token=x' }), { status: 200 }));
    }
    if (url.includes('/storage/v1/object/')) {
      counts.manifest += 1;
      if (seed.fail) return Promise.reject(seed.fail);
      return Promise.resolve(
        new Response(seed.body ?? 'null', { status: seed.status ?? 200, headers: { 'content-type': 'application/json' } }),
      );
    }
    if (url.startsWith('https://rc.test/')) {
      counts.provider += 1;
      if (seed.providerFail) return Promise.reject(seed.providerFail);
      return Promise.resolve(new Response(seed.providerBody ?? '{}', { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  return counts;
}

async function readError(response: Response): Promise<string> {
  const body = await response.json() as { error: { code: string } };
  return body.error.code;
}

test('corrupt_manifest_403_no_provider: malformed manifest bytes answer the closed 403 through the production handler', async (t) => {
  const db = fakeGrantSql();
  const counts = installTransport(t, { body: '{ "paths": ["a.txt", ' });
  const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => db, () => ({ ...CONFIG }));
  assert.equal(response.status, 403, 'corrupted manifest bytes are a denial, not a provider outage');
  assert.equal(await readError(response), 'manifest_not_found');
  assertClosedList(403, 'manifest_not_found');
  assert.equal(counts.manifest, 1);
  assert.equal(counts.provider, 0, 'zero provider calls on a corrupted manifest');
  assert.equal(counts.sign, 0, 'zero sign calls on a corrupted manifest');
});

test('null_manifest_403: a stored JSON null answers 403, never the fault-boundary 503', async (t) => {
  const db = fakeGrantSql();
  const counts = installTransport(t, { body: 'null' });
  const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => db, () => ({ ...CONFIG }));
  assert.equal(response.status, 403, 'the null field access must not escape into the 503');
  assert.equal(await readError(response), 'manifest_not_found');
  assertClosedList(403, 'manifest_not_found');
  assert.equal(counts.provider, 0);
  assert.equal(counts.sign, 0);
});

test('array, primitive, empty and invalid-field manifest shapes stay on the closed 403 (N7 shapes)', async (t) => {
  const shapes = [
    '[]',
    '["a.txt"]',
    '{}',
    '""',
    '42',
    '"manifest"',
    `{"paths": "a.txt", "lock_url": "${MANIFEST_LOCK_URL}"}`,
    '{"paths": ["a.txt", 5], "lock_url": "x"}',
    '{"paths": ["a.txt"], "lock_url": ""}',
    '{"paths": ["a.txt"], "lock_url": 17}',
  ];
  const db = fakeGrantSql();
  const seed: TransportSeed = {};
  const counts = installTransport(t, seed);
  for (const body of shapes) {
    seed.body = body;
    const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => db, () => ({ ...CONFIG }));
    assert.equal(response.status, 403, `shape ${body} must stay a denial`);
    assert.equal(await readError(response), 'manifest_not_found', `shape ${body} keeps the closed code`);
  }
  assert.equal(counts.provider, 0, 'no shape may reach the provider');
  assert.equal(counts.sign, 0, 'no shape may mint a URL');
});

test('storage_failure_status: a genuine transport failure keeps the documented 503 retry path', async (t) => {
  const db = fakeGrantSql();
  const counts = installTransport(t, {
    fail: new Error('fetch failed for https://storage.test/storage/v1/object/files/manifest.json: ECONNREFUSED'),
  });
  const captured = await captureConsoleError(() =>
    serveGrantRequest(grantRequest(REQUEST_BODY), () => db, () => ({ ...CONFIG })));
  const response = captured.result;
  assert.equal(response.status, 503, 'a transport failure stays on the retryable path, distinct from the 403');
  assert.equal(await readError(response), 'entitlement_unavailable');
  assertClosedList(503, 'entitlement_unavailable');
  assert.equal(response.headers.get('retry-after'), String(GRANT_RETRY_AFTER_SECONDS));
  assert.equal(counts.provider, 0, 'the transport fault happens before the provider layer');
  assert.equal(counts.sign, 0);
  assert.equal(captured.lines.length, 1, 'exactly one operator diagnostic');
  assert.match(captured.lines[0]!, /entitlement_unavailable/);
  assert.match(captured.lines[0]!, /<redacted-url>/, 'the failing URL is redacted in the diagnostic');
  assert.ok(!captured.lines[0]!.includes('storage.test'), 'no storage URL reaches stderr');
});

test('provider transport failure answers the same closed 503 through the production RevenueCat adapter', async (t) => {
  const db = fakeGrantSql();
  const counts = installTransport(t, {
    body: JSON.stringify({ paths: ['a.txt'], lock_url: MANIFEST_LOCK_URL }),
    providerFail: new Error('provider unreachable'),
  });
  const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => db, () => ({ ...CONFIG }));
  assert.equal(response.status, 503);
  assert.equal(await readError(response), 'entitlement_unavailable');
  assertClosedList(503, 'entitlement_unavailable');
  assert.equal(response.headers.get('retry-after'), String(GRANT_RETRY_AFTER_SECONDS));
  assert.equal(counts.provider, 1);
  assert.equal(counts.sign, 0, 'a failed verification never mints');
});

test('valid_manifest_membership: a valid manifest with a matching-environment cache hit mints only member paths', async (t) => {
  const manifest = { paths: ['a.txt', 'b.txt'], lock_url: MANIFEST_LOCK_URL };
  const cacheRow = { environment: 'sandbox', expires_at_ms: Date.now() + 3_600_000 };
  const counts = installTransport(t, { body: JSON.stringify(manifest) });
  const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => fakeGrantSql({ cacheRow }), () => ({
    ...CONFIG,
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { lock_url: string; urls: Array<{ path: string; url: string; expires_at: number }> };
  assert.equal(body.lock_url, MANIFEST_LOCK_URL, 'the manifest lock_url passes through unchanged');
  assert.deepEqual(body.urls.map((minted) => minted.path), ['a.txt'], 'only the requested member path is minted');
  assert.ok(body.urls[0]!.url.startsWith('https://storage.test/storage/v1/'), 'the signed URL carries the storage base');
  assert.equal(counts.sign, 1);
  assert.equal(counts.provider, 0, 'a matching-environment cache hit skips the provider');

  const denied = await serveGrantRequest(grantRequest({ ...REQUEST_BODY, paths: ['c.txt'] }), () => fakeGrantSql({ cacheRow }), () => ({
    ...CONFIG,
  }));
  assert.equal(denied.status, 403, 'a non-member path stays denied');
  assert.equal(await readError(denied), 'path_not_allowed');
  assertClosedList(403, 'path_not_allowed');
});

test('a foreign-environment cache row falls through to the provider — no cross-environment reuse', async (t) => {
  const manifest = { paths: ['a.txt'], lock_url: MANIFEST_LOCK_URL };
  const cacheRow = { environment: 'production', expires_at_ms: Date.now() + 3_600_000 };
  const counts = installTransport(t, {
    body: JSON.stringify(manifest),
    providerBody: JSON.stringify({ subscriber: { entitlements: { ent1: { product_identifier: 'demo.product.01' } } } }),
  });
  const response = await serveGrantRequest(grantRequest(REQUEST_BODY), () => fakeGrantSql({ cacheRow }), () => ({
    ...CONFIG,
  }));
  assert.equal(counts.provider, 1, 'the foreign-environment row never authorizes');
  assert.equal(response.status, 503, 'an entitled answer without environment attribution fails closed');
  assert.equal(await readError(response), 'entitlement_unavailable');
  assert.equal(counts.sign, 0);
});
