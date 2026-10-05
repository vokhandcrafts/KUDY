// G08.02 — behavioral tests for the /v1/grant core. Every rule here fails
// when the corresponding gate in grant-core.ts is reverted (implementation-
// rules 1/14): request shape, unsafe-path pre-probe rejection, product
// mapping, exact-manifest membership, the 403/503 distinction, the
// sandbox→production refusal, the bounded positive cache and the N8
// per-device request gate. The SQL ports run their production constants
// against real Postgres (PGlite) with the committed migrations applied;
// provider, manifest source, signer and clock are fakes — the thin platform
// adapters are exercised at deploy time.
//
// The closed-list cross-check keeps the server answers aligned with the
// client contract (services/download/grant.ts GRANT_ERRORS, `19` §3.6): an
// answer the server emits must exist on the client list with the same status.
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { GRANT_ERRORS } from '../../../services/download/grant.ts';

import { registerDevice } from './device-core.ts';
import {
  createSqlEntitlementCache,
  createSqlGrantRate,
  createSqlProductLookup,
  GRANT_CACHE_MAX_ROWS_PER_DEVICE,
  GRANT_RATE_LIMIT,
  GRANT_RATE_WINDOW_MS,
  GRANT_RETRY_AFTER_SECONDS,
  GRANT_URL_TTL_SECONDS,
  handleGrant,
  isUnsafePath,
  isUnsafeUrlTtl,
  type EntitlementVerdict,
  type GrantPortDeps,
} from './grant-core.ts';
import { freshMigratedDatabase, pgliteGrantRunner, type GrantSqlRunner } from './test-db.ts';

const ROUTE = 'g00-03-spike';
const VERSION = '2026-09-15.1';
const LOCALE = 'be';
const TIER = 'extended';
const MANIFEST_PATHS = ['transcripts/private-story-01.be.txt', 'audio/private-story-01.be.mp3'];
const LOCK_URL = 'https://files.test/g00-03-spike/2026-09-15.1/be/lock.json';
const PRODUCT_ID = 'kudy.spike.g00_03.story_01';

test('isUnsafePath refuses traversal, absolute, home, drive/scheme, backslash, NUL and empty forms', () => {
  const unsafe = [
    '',
    'a/../b',
    '..',
    '../escape',
    '/absolute',
    '~/home',
    'C:\\win',
    'C:/win',
    'https://evil.test/x',
    'a\\b',
    'nul\0byte',
    'a//b',
    'a/./b',
    'a/',
    ' '.repeat(257),
  ];
  for (const candidate of unsafe) {
    assert.equal(isUnsafePath(candidate), true, `must refuse: ${JSON.stringify(candidate.slice(0, 24))}`);
  }
  const safe = ['audio/story-01.mp3', 'transcripts/private-story-01.be.txt', 'a/b/c/d.dat'];
  for (const candidate of safe) {
    assert.equal(isUnsafePath(candidate), false, `must allow: ${candidate}`);
  }
});

test('isUnsafeUrlTtl: only finite positive integers up to the canonical 600 s pass (N5)', () => {
  // The 09 §2 private-zone value is both the default and the upper bound —
  // this pin keeps the constant tied to the canon it restates.
  assert.equal(GRANT_URL_TTL_SECONDS, 600);
  const unsafe = [0, -0, -1, 0.5, 600.5, NaN, Infinity, -Infinity, 601, 1e9];
  for (const ttl of unsafe) {
    assert.equal(isUnsafeUrlTtl(ttl), true, `must refuse: ${ttl}`);
  }
  const safe = [1, 599, 600];
  for (const ttl of safe) {
    assert.equal(isUnsafeUrlTtl(ttl), false, `must allow: ${ttl}`);
  }
});

test('shape gate: malformed bodies are 400 invalid_request before any mapping, manifest or provider probe', async (t) => {
  const h = await wiredDeps(t);
  const bodies: unknown[] = [
    null,
    42,
    'grant',
    {},
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER },
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER, paths: [] },
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER, paths: 'audio/x.mp3' },
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER, paths: ['ok', 7] },
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER, paths: Array.from({ length: 21 }, () => 'a.mp3') },
    { route_id: 7, version: VERSION, locale: LOCALE, tier: TIER, paths: ['a.mp3'] },
    // Mapping keys are catalog identifiers: a charset outside the boundary
    // pattern never reaches the product lookup or SQL parameters.
    { route_id: 'g00 03', version: VERSION, locale: LOCALE, tier: TIER, paths: ['a.mp3'] },
    { route_id: "route'; drop", version: VERSION, locale: LOCALE, tier: TIER, paths: ['a.mp3'] },
    { route_id: ROUTE, version: 'v1/..', locale: LOCALE, tier: TIER, paths: ['a.mp3'] },
    { route_id: ROUTE, version: VERSION, locale: '', tier: TIER, paths: ['a.mp3'] },
    { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: 'пашыраны', paths: ['a.mp3'] },
  ];
  for (const body of bodies) {
    const answer = await handleGrant(body, h.deviceId, environment(), h.deps);
    assert.deepEqual(
      { status: answer.status, code: answer.status === 200 ? undefined : answer.code },
      { status: 400, code: 'invalid_request' },
      `must refuse: ${JSON.stringify(body).slice(0, 60)}`,
    );
  }
});

test('cross-check: every 4xx/5xx code the client knows is either a grant-endpoint answer or documented elsewhere', () => {
  // url_expired/url_invalid belong to the file source, device_auth_failed and
  // not_found to the wrapper's own gates (device-core auth, route miss) — the
  // grant core itself never emits them.
  const elsewhere = ['url_expired', 'url_invalid', 'device_auth_failed', 'not_found'];
  const emitted = [
    { status: 400, code: 'invalid_request' },
    { status: 403, code: 'unknown_route_tier' },
    { status: 403, code: 'manifest_not_found' },
    { status: 403, code: 'path_not_allowed' },
    { status: 403, code: 'no_entitlement' },
    { status: 403, code: 'environment_mismatch' },
    { status: 429, code: 'rate_limited' },
    { status: 503, code: 'entitlement_unavailable' },
  ];
  for (const entry of emitted) {
    const known = GRANT_ERRORS.find((candidate) => candidate.code === entry.code);
    assert.ok(known, `${entry.code} must exist on the client closed list`);
    assert.equal(known.status, entry.status, `${entry.code} status must match the client closed list`);
  }
  for (const entry of GRANT_ERRORS) {
    const covered = emitted.some((candidate) => candidate.code === entry.code) || elsewhere.includes(entry.code);
    assert.ok(covered, `client code ${entry.code} must be emitted here or documented as another endpoint's`);
  }
});

interface Harness {
  db: Awaited<ReturnType<typeof freshMigratedDatabase>>;
  runner: GrantSqlRunner;
  deps: GrantPortDeps;
  deviceId: string;
  manifestLoads: string[];
  providerCalls: Array<{ deviceId: string; productId: string }>;
  minted: Array<{ path: string; deviceId: string; ttlSeconds: number }>;
  setVerdict(verdict: EntitlementVerdict): void;
  setManifest(paths: string[] | null): void;
  advanceClock(ms: number): void;
  cacheRows(): Promise<Array<{ route_id: string; tier: string; env: string | null; expires_in_s: number }>>;
}

async function wiredDeps(t: TestContext): Promise<Harness> {
  const db = await freshMigratedDatabase();
  t.after(() => db.close());
  const runner = pgliteGrantRunner(db);
  const registration = registerDevice();
  await db.query('insert into devices (device_id, secret_hash) values ($1, $2)', [registration.deviceId, registration.secretHash]);
  await db.query('insert into grant_products (product_id, route_id, tier) values ($1, $2, $3)', [PRODUCT_ID, ROUTE, TIER]);

  let nowMs = 1_700_000_000_000;
  let verdict: EntitlementVerdict = { ok: true, entitled: true, environment: 'sandbox' };
  let manifestPaths: string[] | null = MANIFEST_PATHS;
  const manifestLoads: string[] = [];
  const providerCalls: Array<{ deviceId: string; productId: string }> = [];
  const minted: Array<{ path: string; deviceId: string; ttlSeconds: number }> = [];

  const deps: GrantPortDeps = {
    now: () => nowMs,
    products: createSqlProductLookup(runner),
    manifests: {
      async load(routeId, version, locale, tier) {
        manifestLoads.push(`${routeId}/${version}/${locale}/${tier}`);
        if (manifestPaths === null) return null;
        return { paths: manifestPaths, lockUrl: LOCK_URL };
      },
    },
    provider: {
      async verifyEntitlement(input) {
        providerCalls.push({ ...input });
        return verdict;
      },
    },
  signer: {
    // Async on purpose: the production signer is a network call (Storage
    // signed URLs); the port must be awaited by the core (review round 1).
    mint: async (input) => {
      minted.push({ ...input });
      return { url: `https://files.test/granted/${input.path}`, expiresAtMs: input.nowMs + input.ttlSeconds * 1000 };
    },
  },
    cache: createSqlEntitlementCache(runner),
    rate: createSqlGrantRate(runner),
  };

  return {
    db,
    runner,
    deps,
    deviceId: registration.deviceId,
    manifestLoads,
    providerCalls,
    minted,
    setVerdict(next) { verdict = next; },
    setManifest(next) { manifestPaths = next; },
    advanceClock(ms) { nowMs += ms; },
    async cacheRows() {
      const result = await db.query(
        "select route_id, tier, payload ->> 'environment' as env, (extract(epoch from expires_at) * 1000 - $1)::float8 as expires_in_s from entitlement_cache where device_id = $2",
        [nowMs, registration.deviceId],
      );
      return result.rows as Array<{ route_id: string; tier: string; env: string | null; expires_in_s: number }>;
    },
  };
}

function environment() {
  return { environment: 'sandbox' as const };
}

function grantRequest(paths: string[]) {
  return { route_id: ROUTE, version: VERSION, locale: LOCALE, tier: TIER, paths };
}

test('gate order: unsafe paths are refused before any mapping or manifest probe', async (t) => {
  const h = await wiredDeps(t);
  const answer = await handleGrant(grantRequest(['../escape.mp3']), h.deviceId, environment(), h.deps);
  assert.deepEqual(answer, { status: 403, code: 'path_not_allowed' });
  assert.deepEqual(h.manifestLoads, [], 'no manifest load may happen for an unsafe path');
  assert.deepEqual(h.providerCalls, [], 'no provider call may happen for an unsafe path');
});

test('unknown route × tier is refused against the real grant_products table', async (t) => {
  const h = await wiredDeps(t);
  const request = { route_id: 'other-route', version: VERSION, locale: LOCALE, tier: TIER, paths: ['a.mp3'] };
  const answer = await handleGrant(request, h.deviceId, environment(), h.deps);
  assert.deepEqual(answer, { status: 403, code: 'unknown_route_tier' });
  assert.deepEqual(h.manifestLoads, [], 'no manifest load may happen without a product');
});

test('manifest of the exact version/locale/tier: missing manifest and non-member paths are refused', async (t) => {
  const h = await wiredDeps(t);
  h.setManifest(null);
  const missing = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.deepEqual(missing, { status: 403, code: 'manifest_not_found' });

  h.setManifest(['transcripts/private-story-01.be.txt']);
  const foreign = await handleGrant(grantRequest(['audio/private-story-01.be.mp3']), h.deviceId, environment(), h.deps);
  assert.deepEqual(foreign, { status: 403, code: 'path_not_allowed' }, 'a manifest member of another request shape must not pass');
  assert.deepEqual(h.providerCalls, [], 'entitlement must not be consulted before the manifest gate passes');
});

test('no_entitlement and provider outage land on different sides of the 403/503 line', async (t) => {
  const h = await wiredDeps(t);

  h.setVerdict({ ok: true, entitled: false, environment: null });
  const refused = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.deepEqual(refused, { status: 403, code: 'no_entitlement' });

  h.setVerdict({ ok: false, reason: 'unavailable' });
  const outage = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.deepEqual(outage, { status: 503, code: 'entitlement_unavailable', retryAfterSeconds: GRANT_RETRY_AFTER_SECONDS });

  // Refusals are never cached (09 §5.1): the table must still be empty.
  assert.deepEqual(await h.cacheRows(), []);
  // And the next request verifies again — nothing negative was stored.
  h.setVerdict({ ok: true, entitled: true, environment: 'sandbox' });
  const granted = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.equal(granted.status, 200);
  assert.equal(h.providerCalls.length, 3, 'each refused round must have verified the provider afresh');
});

test('sandbox entitlement never opens the production server and vice versa', async (t) => {
  const h = await wiredDeps(t);

  h.setVerdict({ ok: true, entitled: true, environment: 'sandbox' });
  const production = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, { environment: 'production' }, h.deps);
  assert.deepEqual(production, { status: 403, code: 'environment_mismatch' });

  h.setVerdict({ ok: true, entitled: true, environment: 'production' });
  const sandbox = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.deepEqual(sandbox, { status: 403, code: 'environment_mismatch' });
  assert.deepEqual(await h.cacheRows(), [], 'a mismatched-environment verdict must not be cached');
});

test('a grant mirrors exactly the requested manifest members with short-lived URLs', async (t) => {
  const h = await wiredDeps(t);
  const paths = [MANIFEST_PATHS[1]!, MANIFEST_PATHS[0]!];
  const answer = await handleGrant(grantRequest(paths), h.deviceId, environment(), h.deps);
  assert.equal(answer.status, 200);
  if (answer.status !== 200) return;
  assert.equal(answer.body.lock_url, LOCK_URL);
  assert.deepEqual(
    answer.body.urls.map((granted) => granted.path),
    paths,
    'the answer must mirror the request, not the whole manifest',
  );
  assert.deepEqual(
    answer.body.urls.map((granted) => granted.url),
    paths.map((path) => `https://files.test/granted/${path}`),
  );
  assert.deepEqual(
    answer.body.urls.map((granted) => granted.expires_at),
    paths.map(() => 1_700_000_000_000 + GRANT_URL_TTL_SECONDS * 1000),
  );
  assert.deepEqual(
    h.minted.map((call) => call.ttlSeconds),
    paths.map(() => GRANT_URL_TTL_SECONDS),
  );
});

test('an out-of-policy URL TTL fails the whole round closed: the signer never mints and no layer is probed', async (t) => {
  const h = await wiredDeps(t);
  for (const ttl of [0, -1, 0.5, 601, NaN, Infinity]) {
    const answer = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, { ...environment(), urlTtlSeconds: ttl }, h.deps);
    assert.deepEqual(
      answer,
      { status: 503, code: 'entitlement_unavailable', retryAfterSeconds: GRANT_RETRY_AFTER_SECONDS },
      `must refuse to mint for ttl ${ttl}`,
    );
  }
  assert.deepEqual(h.minted, [], 'the signer must never see an out-of-policy TTL');
  assert.deepEqual(h.manifestLoads, [], 'no manifest load may happen under a misconfigured TTL');
  assert.deepEqual(h.providerCalls, [], 'the provider must not be consulted under a misconfigured TTL');
  assert.deepEqual(await h.cacheRows(), [], 'a misconfigured round must not write cache rows');
});

test('the URL TTL cap: 600 mints exactly 600 s, 601 never reaches the signer', async (t) => {
  const h = await wiredDeps(t);
  const granted = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, { ...environment(), urlTtlSeconds: 600 }, h.deps);
  assert.equal(granted.status, 200);
  if (granted.status === 200) {
    assert.deepEqual(
      granted.body.urls.map((grantedUrl) => grantedUrl.expires_at),
      MANIFEST_PATHS.map(() => 1_700_000_000_000 + 600 * 1000),
    );
  }
  assert.deepEqual(h.minted.map((call) => call.ttlSeconds), MANIFEST_PATHS.map(() => 600));

  // The same harness: the 601 round must fail at the TTL gate — before the
  // positive cache could answer and before any further mint call.
  const refused = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, { ...environment(), urlTtlSeconds: 601 }, h.deps);
  assert.deepEqual(refused, { status: 503, code: 'entitlement_unavailable', retryAfterSeconds: GRANT_RETRY_AFTER_SECONDS });
  assert.deepEqual(h.minted.map((call) => call.ttlSeconds), MANIFEST_PATHS.map(() => 600), '601 must not add a single mint call');
  assert.equal(h.providerCalls.length, 1, 'the 601 round must fail before the provider');
});

test('the URL TTL and the entitlement-cache TTL are distinct policies', async (t) => {
  const h = await wiredDeps(t);
  const answer = await handleGrant(
    grantRequest(MANIFEST_PATHS),
    h.deviceId,
    { ...environment(), urlTtlSeconds: 600, cacheTtlSeconds: 3600 },
    h.deps,
  );
  assert.equal(answer.status, 200);
  assert.deepEqual(h.minted.map((call) => call.ttlSeconds), MANIFEST_PATHS.map(() => 600), 'the minted URL TTL stays 600 s');
  const rows = await h.cacheRows();
  assert.equal(rows.length, 1);
  assert.ok(
    rows[0]!.expires_in_s > 3_500_000 && rows[0]!.expires_in_s <= 3_600_000,
    `the cache row must carry its own 3600 s TTL, got ${rows[0]!.expires_in_s}`,
  );
});

test('positive cache: a fresh row answers without the provider; an expired row never grants', async (t) => {
  const h = await wiredDeps(t);
  const first = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.equal(first.status, 200);
  assert.equal(h.providerCalls.length, 1);

  const rows = await h.cacheRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.env, 'sandbox');
  assert.equal(rows[0]!.route_id, ROUTE);
  assert.ok(rows[0]!.expires_in_s > 86_000, 'the cache row must carry the ~24h TTL');

  h.advanceClock(60_000);
  const second = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.equal(second.status, 200);
  assert.equal(h.providerCalls.length, 1, 'a fresh positive row must answer without the provider');

  // Past the TTL the row is dead: the provider is verified again, and when it
  // is down the answer is 503 — the expired row never grants access.
  h.advanceClock(100_000_000);
  h.setVerdict({ ok: false, reason: 'unavailable' });
  const third = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.deepEqual(third, { status: 503, code: 'entitlement_unavailable', retryAfterSeconds: GRANT_RETRY_AFTER_SECONDS });
  assert.equal(h.providerCalls.length, 2);
});

test('a cache row written under another environment never grants under this one', async (t) => {
  const h = await wiredDeps(t);
  const first = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, environment(), h.deps);
  assert.equal(first.status, 200);
  assert.equal(h.providerCalls.length, 1);

  const production = await handleGrant(grantRequest(MANIFEST_PATHS), h.deviceId, { environment: 'production' }, h.deps);
  assert.equal(h.providerCalls.length, 2, 'a foreign-environment row must fall through to the provider');
  assert.deepEqual(production, { status: 403, code: 'environment_mismatch' });
  const rows = await h.cacheRows();
  assert.deepEqual(rows.map((row) => row.env), ['sandbox'], 'the sandbox row must survive untouched');
});

test('the cache is bounded: expired rows are swept and the per-device cap holds', async (t) => {
  const h = await wiredDeps(t);
  // This test exercises the cache cap past its bound, not the request gate —
  // the N8 gate would deny rounds 31+ of the same window before the cache
  // write. The rate port keeps the production runner with a raised limit.
  h.deps.rate = createSqlGrantRate(h.runner, 10_000);
  // Fill the cache past the cap with distinct route × tier rows.
  for (let index = 0; index < GRANT_CACHE_MAX_ROWS_PER_DEVICE + 4; index += 1) {
    const routeId = `route-${String(index).padStart(3, '0')}`;
    // Each round a moment later, so the eviction order (freshest expiry
    // first) is unambiguous.
    h.advanceClock(1_000);
    await h.db.query('insert into grant_products (product_id, route_id, tier) values ($1, $2, $3)', [`p-${index}`, routeId, TIER]);
    const request = { route_id: routeId, version: VERSION, locale: LOCALE, tier: TIER, paths: ['a.mp3'] };
    h.setManifest(['a.mp3']);
    const answer = await handleGrant(request, h.deviceId, environment(), h.deps);
    assert.equal(answer.status, 200, `round ${index} must grant`);
  }
  const rows = await h.cacheRows();
  assert.ok(
    rows.length <= GRANT_CACHE_MAX_ROWS_PER_DEVICE,
    `the device must hold at most ${GRANT_CACHE_MAX_ROWS_PER_DEVICE} rows, holds ${rows.length}`,
  );
  // The freshest rows survive; the earliest ones were evicted.
  assert.ok(!rows.some((row) => row.route_id === 'route-000'), 'the oldest row must have been evicted');
  assert.ok(rows.some((row) => row.route_id === `route-${String(GRANT_CACHE_MAX_ROWS_PER_DEVICE + 3).padStart(3, '0')}`), 'the newest row must survive');
});

// --- N8: the per-device request gate before the provider --------------------

test('grant_limit_no_provider_call: beyond the per-device limit the answer is 429 and the provider is never called again', async (t) => {
  const h = await wiredDeps(t);
  const request = grantRequest([MANIFEST_PATHS[0]]);
  for (let round = 1; round <= GRANT_RATE_LIMIT; round += 1) {
    const answer = await handleGrant(request, h.deviceId, environment(), h.deps);
    assert.equal(answer.status, 200, `round ${round} within the limit must grant`);
  }
  const providerCallsAtLimit = h.providerCalls.length;
  const mintedAtLimit = h.minted.length;
  assert.ok(providerCallsAtLimit > 0, 'the first round must have verified with the provider');

  // The cache answers the repeats — but the request counter still counts
  // them (N8: «Ліміт дзейнічае і для паўтораў»). Beyond the limit the answer
  // is the closed 429 and no port past the gate runs.
  for (let round = 0; round < 3; round += 1) {
    const answer = await handleGrant(request, h.deviceId, environment(), h.deps);
    if (answer.status !== 429) assert.fail(`expected 429, got ${JSON.stringify(answer)}`);
    assert.equal(answer.code, 'rate_limited');
    assert.ok(
      Number.isInteger(answer.retryAfterSeconds) && answer.retryAfterSeconds >= 1
        && answer.retryAfterSeconds <= GRANT_RATE_WINDOW_MS / 1000,
      'Retry-After must name the remaining part of the window',
    );
  }
  assert.equal(h.providerCalls.length, providerCallsAtLimit, 'zero additional provider calls beyond the limit');
  assert.equal(h.minted.length, mintedAtLimit, 'the denied rounds mint nothing');
});

test('concurrent_grant_limit: parallel rounds cannot bypass counting (G20.26 criterion 3)', async (t) => {
  const h = await wiredDeps(t);
  // limit + 5 concurrent rounds: the atomic window increment serializes in
  // the real database, so exactly the limit answers may pass the gate.
  const rounds = GRANT_RATE_LIMIT + 5;
  const answers = await Promise.all(
    Array.from({ length: rounds }, () => handleGrant(grantRequest([MANIFEST_PATHS[0]]), h.deviceId, environment(), h.deps)),
  );
  const granted = answers.filter((answer) => answer.status === 200);
  const limited = answers.filter((answer) => answer.status === 429);
  assert.equal(granted.length, GRANT_RATE_LIMIT, 'exactly the limit many rounds pass');
  assert.equal(limited.length, rounds - GRANT_RATE_LIMIT, 'the rest are rate-limited');
  // Every allowed round consumed one counted attempt — the provider saw no
  // more verifications than allowed rounds that needed it.
  assert.ok(h.providerCalls.length <= GRANT_RATE_LIMIT, 'no provider call may bypass the gate');
});

test('limiter_failure_denied: a limiter fault propagates fail-closed, never as an allow or a limit denial', async (t) => {
  const h = await wiredDeps(t);
  // The limiter storage dies: the round must not answer 200 (no bypass) nor
  // 429 (a storage fault is not a limit — spec N1), and must not reach the
  // provider; the Deno wrapper maps the fault to its closed 503.
  h.deps.rate = {
    consume: async () => {
      throw new Error('rate storage unavailable');
    },
  };
  await assert.rejects(
    () => handleGrant(grantRequest([MANIFEST_PATHS[0]]), h.deviceId, environment(), h.deps),
    /rate storage unavailable/,
  );
  assert.deepEqual(h.providerCalls, [], 'a limiter fault never reaches the provider');
  assert.deepEqual(h.minted, [], 'a limiter fault never mints');

  // A malformed count from the SQL layer (not a valid attempt number) is the
  // same failure: the shared core refuses it before the limit comparison
  // (spec N1) instead of reading it as 0 or as a limit denial.
  const brokenRunner: GrantSqlRunner = {
    findProduct: async () => [],
    readCache: async () => [],
    writeCache: async () => {},
    sweepExpiredCache: async () => {},
    capCache: async () => {},
    incrementRate: async () => [{ attempts: '12' }],
  };
  h.deps.rate = createSqlGrantRate(brokenRunner);
  await assert.rejects(() => handleGrant(grantRequest([MANIFEST_PATHS[0]]), h.deviceId, environment(), h.deps), /valid attempt count/);
  assert.deepEqual(h.providerCalls, [], 'a malformed count never reaches the provider');
});

test('second_device_budget: another device works within its own budget after one device exhausts its limit', async (t) => {
  const h = await wiredDeps(t);
  // A second device in the SAME deployment: its counter row is its own, so
  // it works while device A waits out its window (one shared provider
  // budget, per-device buckets).
  const second = registerDevice();
  await h.db.query('insert into devices (device_id, secret_hash) values ($1, $2)', [second.deviceId, second.secretHash]);

  for (let round = 0; round < GRANT_RATE_LIMIT; round += 1) {
    const answer = await handleGrant(grantRequest([MANIFEST_PATHS[0]]), h.deviceId, environment(), h.deps);
    assert.equal(answer.status, 200, `device A round ${round + 1} within the limit must grant`);
  }
  const exhausted = await handleGrant(grantRequest([MANIFEST_PATHS[0]]), h.deviceId, environment(), h.deps);
  if (exhausted.status !== 429) assert.fail(`expected 429, got ${JSON.stringify(exhausted)}`);
  assert.equal(exhausted.code, 'rate_limited', 'device A is limited');

  const answer = await handleGrant(grantRequest([MANIFEST_PATHS[0]]), second.deviceId, environment(), h.deps);
  assert.equal(answer.status, 200, 'device B passes its own gate');
  assert.deepEqual(
    h.providerCalls.filter((call) => call.deviceId === second.deviceId).map((call) => call.deviceId),
    [second.deviceId],
    'device B was verified by the provider exactly once',
  );
});
