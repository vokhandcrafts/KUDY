// The shared deterministic harness of the /v1/grant demos (G08.02 issue
// #289, G20.11 issue #482): real Postgres (PGlite) with the committed
// migrations applied and the production SQL ports; the provider, the
// manifest source and the signer are fakes on a fixed clock, so every
// printed line is stable. Device and product identifiers are seeded at
// runtime and never printed.
import { registerDevice } from './device-core.ts';
import {
  createSqlEntitlementCache,
  createSqlGrantRate,
  createSqlProductLookup,
  type EntitlementVerdict,
  type GrantPortDeps,
} from './grant-core.ts';
import { freshMigratedDatabase, pgliteGrantRunner } from './test-db.ts';

export const DEMO_NOW_MS = 1_700_000_000_000;

export interface GrantDemoHarness {
  deviceId: string;
  deps: GrantPortDeps;
  providerCalls: number;
  mintCalls: number;
  setVerdict(verdict: EntitlementVerdict): void;
  setManifest(paths: string[] | null): void;
  close(): Promise<void>;
}

export async function createGrantDemoHarness(manifestPaths: string[]): Promise<GrantDemoHarness> {
  const db = await freshMigratedDatabase();
  const runner = pgliteGrantRunner(db);
  const device = registerDevice();
  await db.query('insert into devices (device_id, secret_hash) values ($1, $2)', [device.deviceId, device.secretHash]);
  await db.query(
    "insert into grant_products (product_id, route_id, tier) values ('demo.product.01', 'demo-route', 'extended')",
    [],
  );

  let verdict: EntitlementVerdict = { ok: true, entitled: true, environment: 'sandbox' };
  let manifest: string[] | null = manifestPaths;
  let providerCalls = 0;
  let mintCalls = 0;

  const deps: GrantPortDeps = {
    now: () => DEMO_NOW_MS,
    products: createSqlProductLookup(runner),
    manifests: {
      load: async () => (manifest === null ? null : { paths: manifest, lockUrl: 'https://files.test/demo-route/lock.json' }),
    },
    provider: {
      verifyEntitlement: async () => {
        providerCalls += 1;
        return verdict;
      },
    },
    signer: {
      mint: async (input) => {
        mintCalls += 1;
        return { url: `https://files.test/granted/${input.path}`, expiresAtMs: input.nowMs + input.ttlSeconds * 1000 };
      },
    },
    cache: createSqlEntitlementCache(runner),
    rate: createSqlGrantRate(runner),
  };

  return {
    deviceId: device.deviceId,
    deps,
    get providerCalls() {
      return providerCalls;
    },
    get mintCalls() {
      return mintCalls;
    },
    setVerdict(next) {
      verdict = next;
    },
    setManifest(next) {
      manifest = next;
    },
    async close() {
      await db.close();
    },
  };
}
