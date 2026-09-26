// G08.02 — deterministic demo of the /v1/grant server boundaries (issue
// #289). The gate matrix runs against real Postgres (PGlite) with the
// committed migrations applied and the production SQL ports; the provider,
// the manifest source and the signer are fakes with a fixed clock, so every
// printed line is stable. Device and product identifiers are seeded at
// runtime and never printed.
import { registerDevice } from './device-core.ts';
import {
  createSqlEntitlementCache,
  createSqlProductLookup,
  GRANT_RETRY_AFTER_SECONDS,
  GRANT_URL_TTL_SECONDS,
  handleGrant,
  type EntitlementVerdict,
  type GrantPortDeps,
} from './grant-core.ts';
import { freshMigratedDatabase, pgliteRowsRunner } from './test-db.ts';

const db = await freshMigratedDatabase();
const runner = pgliteRowsRunner(db);
const device = registerDevice();
await db.query('insert into devices (device_id, secret_hash) values ($1, $2)', [device.deviceId, device.secretHash]);
await db.query(
  "insert into grant_products (product_id, route_id, tier) values ('demo.product.01', 'demo-route', 'extended')",
  [],
);

const NOW = 1_700_000_000_000;
let verdict: EntitlementVerdict = { ok: true, entitled: true, environment: 'sandbox' };
let manifestPaths: string[] | null = ['audio/story-01.mp3', 'audio/story-02.mp3'];
let providerCalls = 0;

const deps: GrantPortDeps = {
  now: () => NOW,
  products: createSqlProductLookup(runner),
  manifests: {
    load: async () => (manifestPaths === null ? null : { paths: manifestPaths, lockUrl: 'https://files.test/demo-route/lock.json' }),
  },
  provider: {
    verifyEntitlement: async () => {
      providerCalls += 1;
      return verdict;
    },
  },
  signer: {
    mint: async (input) => ({ url: `https://files.test/granted/${input.path}`, expiresAtMs: input.nowMs + input.ttlSeconds * 1000 }),
  },
  cache: createSqlEntitlementCache(runner),
};

const request = (paths: string[]) => ({
  route_id: 'demo-route',
  version: 'v1',
  locale: 'be',
  tier: 'extended',
  paths,
});
const sandbox = { environment: 'sandbox' as const };

// 1. A path outside the manifest → refused before the entitlement check.
console.log('foreign path →', JSON.stringify(await handleGrant(request(['audio/other.mp3']), device.deviceId, sandbox, deps)));

// 2. No purchase → 403; the refusal is never cached.
verdict = { ok: true, entitled: false, environment: null };
console.log('not entitled →', JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), device.deviceId, sandbox, deps)));

// 3. Provider outage → 503 with Retry-After, not a denial.
verdict = { ok: false, reason: 'unavailable' };
console.log('provider down →', JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), device.deviceId, sandbox, deps)));

// 4. A sandbox entitlement never opens the production server.
verdict = { ok: true, entitled: true, environment: 'sandbox' };
console.log(
  'sandbox → production:',
  JSON.stringify(await handleGrant(request(['audio/story-01.mp3']), device.deviceId, { environment: 'production' }, deps)),
);

// 5. Entitled on the matching environment → exactly the requested members.
const granted = await handleGrant(request(['audio/story-02.mp3']), device.deviceId, sandbox, deps);
console.log(
  'entitled → status',
  granted.status,
  'members',
  granted.status === 200 ? JSON.stringify(granted.body.urls.map((grantedUrl) => grantedUrl.path)) : '-',
);
console.log('url ttl seconds', GRANT_URL_TTL_SECONDS, '/ retry-after seconds', GRANT_RETRY_AFTER_SECONDS);

// 6. The positive cache answers the repeated request without the provider.
const before = providerCalls;
const again = await handleGrant(request(['audio/story-02.mp3']), device.deviceId, sandbox, deps);
console.log('cache hit skips provider:', again.status === 200 && providerCalls === before);
