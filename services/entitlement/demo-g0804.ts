// G08.04 demo — the client purchase chain (аплата → загрузка → AccessReady),
// live against the scripted store session, the signed-URL grant fake and the
// real activation core with a node bundles store. The same modules and
// wiring the composition root will use. Deterministic: no clock, no
// randomness, no network; the device UUID and the product ids are synthetic
// constants, no secrets anywhere; every scenario gets its own temporary
// bundles root under the OS temp dir, removed at the end — nothing of it is
// printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAccessPort, type DownloadAccessPort } from '../download/access.ts';
import { createNodeDownloadStore, nodeSha256 } from '../download/nodeDownloadStore.ts';
import { openDatabase } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { SqlDriver } from '../db/types.ts';
import { FakeStoreSessionPort, rcError } from './fake-port.ts';
import { scriptedGrant, type ScriptedGrant } from './grant-fake.ts';
import { createPurchaseChain, type UnlockOutcome } from './purchase-chain.ts';

const DEVICE = '3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const PRODUCT = 'com.kudy.route.gdansk_extended';
const KEY = { routeId: 'route-1', version: 'v1', locale: 'be', tier: 'base' } as const;
const NOW = 1_700_000_000_000;

const utf8 = (text: string) => new TextEncoder().encode(text);
const STOPS = utf8('[{"story_id":"story-b","place_id":"place-1"}]\n');
const AUDIO = utf8('audio-bytes-0123456789abcdef');
const AUDIO_WRONG = utf8('audio-bytes-ffffffffffffffff');
const ROUTE_DOC = {
  route_id: KEY.routeId,
  version: KEY.version,
  city_id: 'city-1',
  access: 'paid',
  stops: [
    { id: 'a', position: 0, place_id: 'place-1', access_tier: 'base' },
    { id: 'b', position: 1, place_id: 'place-2', access_tier: 'base' },
  ],
};
const lock = [
  { path: 'stops.json', bytes: STOPS.length, sha256: await nodeSha256(STOPS) },
  { path: 'audio/story-1.m4a', bytes: AUDIO.length, sha256: await nodeSha256(AUDIO) },
];

// One scenario rig: its own bundles root, store session, the shared
// scripted grant fake (grant-fake.ts) and the chain. The knobs: an
// `expireFirstMint` makes the first minted URL batch answer 403 url_expired
// (the renewal the source must recover from), `interruptNextFetches` turns
// the next fetches into interrupted transfers, `serve` swaps the served
// bytes (the hash-mismatch scenario).
interface Rig {
  chain: ReturnType<typeof createPurchaseChain>;
  storePort: FakeStoreSessionPort;
  grantPosts: () => number;
  serve: (sources: Record<string, Uint8Array>) => void;
  interruptNextFetches: (count: number) => void;
}

const roots: string[] = [];

async function makeRig(
  access: DownloadAccessPort,
  options: { expireFirstMint?: boolean; sources?: Record<string, Uint8Array> } = {},
): Promise<Rig> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0804-demo-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, `bundles/${KEY.routeId}/${KEY.version}`), { recursive: true });
  fs.writeFileSync(
    path.join(root, `bundles/${KEY.routeId}/${KEY.version}/route.json`),
    JSON.stringify(ROUTE_DOC),
  );
  const grant: ScriptedGrant = scriptedGrant({
    sources: options.sources ?? { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO },
    expireFirstMint: options.expireFirstMint,
    now: NOW,
  });
  const storePort = new FakeStoreSessionPort();
  const driver: SqlDriver = nodeSqliteDriver();
  openDatabase(driver);
  const chain = createPurchaseChain({
    store: storePort,
    bundlesStore: createNodeDownloadStore(root),
    sha256: nodeSha256,
    driver,
    access,
    grant: {
      transport: grant.transport,
      credential: async () => 'device-secret',
      fetchBytes: grant.fetchBytes,
      delay: async () => {},
      now: () => NOW,
    },
  });
  return {
    chain,
    storePort,
    grantPosts: () => grant.requested.length,
    serve: grant.serve,
    interruptNextFetches: grant.failNextFetches,
  };
}

const input = { identity: { deviceId: DEVICE }, productId: PRODUCT, key: KEY, lock };
const show = (outcome: UnlockOutcome): string =>
  outcome.kind === 'download-incomplete'
    ? JSON.stringify({ kind: outcome.kind, state: outcome.state, status: outcome.result.status })
    : JSON.stringify({ kind: outcome.kind, state: outcome.state });

async function main(): Promise<void> {
  const access = createAccessPort();
  const events: string[] = [];
  access.onAccessReady((event) =>
    events.push(`AccessReady ${event.routeId}@${event.version} ${event.locale}/${event.tier} stops=[${event.stopIds}]`),
  );

  // The user backs out at the payment sheet: no download is attempted.
  const rig1 = await makeRig(access);
  rig1.storePort.purchaseRejects(rcError('1'));
  console.log('cancelled      →', show(await rig1.chain.unlock(input)), '| state =', rig1.chain.stateOf(PRODUCT));

  // The transaction finishes, but the transfer dies: the product stays
  // «Куплена · трэба загрузіць» — the next action is a download retry.
  rig1.storePort.purchaseResolves({ productId: PRODUCT });
  rig1.interruptNextFetches(1);
  console.log('failed dl      →', show(await rig1.chain.unlock(input)), '| state =', rig1.chain.stateOf(PRODUCT));

  // The retry: the store session is not touched again, the download
  // completes, and the commit itself emits AccessReady through the port.
  console.log('retry          →', show(await rig1.chain.unlock(input)), '| state =', rig1.chain.stateOf(PRODUCT));
  console.log('store calls    →', JSON.stringify(rig1.storePort.calls));

  // The expired grant URL: the source re-grants the portion mid-download
  // and completes — one POST to mint, one to renew, no repeated payment.
  const rig2 = await makeRig(access, { expireFirstMint: true });
  rig2.storePort.purchaseResolves({ productId: PRODUCT });
  console.log('expired url    →', show(await rig2.chain.unlock(input)), '| grant POSTs =', rig2.grantPosts());

  // A transferred file whose bytes fail the digest check: the activation
  // answers hash-mismatch — never ready, never an event, still paid.
  const rig3 = await makeRig(access);
  rig3.storePort.purchaseResolves({ productId: PRODUCT });
  rig3.serve({ 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO_WRONG });
  console.log('hash-mismatch  →', show(await rig3.chain.unlock(input)), '| state =', rig3.chain.stateOf(PRODUCT));
  rig3.serve({ 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
  console.log('verified retry →', show(await rig3.chain.unlock(input)), '| state =', rig3.chain.stateOf(PRODUCT));
  console.log('events         →', JSON.stringify(events, null, 0));
}

try {
  await main();
} finally {
  // Every scenario root is this process's own mkdtemp child; the output
  // never names a path, and the cleanup keeps the demo side-effect free.
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
