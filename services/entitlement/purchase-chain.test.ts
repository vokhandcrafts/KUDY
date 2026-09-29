// G08.04 — acceptance suite for the client purchase chain (issue #291).
// Criteria:
// 1. a download failure after payment keeps the product paid — the retry is
//    a download, the store is never asked again;
// 2. an expired grant URL renews mid-download without a repeated purchase;
// 3. the chain turns ready only after the activation's own verify (per-file
//    hash), never after the transfer, and the AccessReady event is the
//    commit's own emission;
// + the honest pass-through of the store answers and the before-any-side-
//   effect boundary validation (implementation-rules 14).
// The engine side of the unlock (same-version keeps heard, no autoplay;
// another version mixes nothing in) is the reducer's contract (G05.01.a
// criterion 5) — its delivery through the one access port into the live walk
// is proven in controllers/run/runOrchestrator.test.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPurchaseChain, type PurchaseChainDeps } from './purchase-chain.ts';
import { FakeStoreSessionPort, rcError } from './fake-port.ts';
import { scriptedGrant, type ScriptedGrant } from './grant-fake.ts';
import { createAccessPort } from '../download/access.ts';
import type { AccessReadyEvent } from '../download/access.ts';
import { createNodeDownloadStore, nodeSha256 } from '../download/nodeDownloadStore.ts';
import { lockFrom, utf8 } from '../download/test-fixture.ts';
import { openDatabase } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { LayerKey } from '../download/types.ts';

const KEY: LayerKey = { routeId: 'route-1', version: 'v1', locale: 'be', tier: 'base' };
const PRODUCT = 'com.kudy.route.gdansk_extended';
const DEVICE = '3f2b8c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const NOW = 1_700_000_000_000;

const STOPS = utf8('[{"story_id":"story-b","place_id":"place-1"}]\n');
const AUDIO = utf8('audio-bytes-0123456789abcdef');
// The honest bytes with the audio's sha256 broken — the same length, so the
// fault is the digest check, never the size ladder's first step.
const AUDIO_WRONG = utf8('audio-bytes-ffffffffffffffff');
const GOOD_SOURCES: Record<string, Uint8Array> = {
  'stops.json': STOPS,
  'audio/story-1.m4a': AUDIO,
};

// route.json at the package root (09 §7): two base stops and one extended —
// the activated tier filters the unlock payload.
const ROUTE_DOC = {
  route_id: 'route-1',
  version: 'v1',
  city_id: 'city-1',
  access: 'paid',
  stops: [
    { id: 'a', position: 0, place_id: 'place-1', access_tier: 'base' },
    { id: 'b', position: 1, place_id: 'place-2', access_tier: 'base' },
    { id: 'c', position: 2, place_id: 'place-3', access_tier: 'extended' },
  ],
};

interface ChainRig {
  chain: ReturnType<typeof createPurchaseChain>;
  storePort: FakeStoreSessionPort;
  grant: ScriptedGrant;
  events: AccessReadyEvent[];
  root: string;
  diagnostics: string[];
}

// The full rig: store session fake, node bundles store with the package
// route.json staged, fresh zone A driver, one access port, the grant fake —
// wired exactly as the composition root will.
async function chainRig(
  options: { sources?: Record<string, Uint8Array>; expireFirst?: boolean } = {},
): Promise<ChainRig> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0804-'));
  fs.mkdirSync(path.join(root, `bundles/${KEY.routeId}/${KEY.version}`), { recursive: true });
  fs.writeFileSync(
    path.join(root, `bundles/${KEY.routeId}/${KEY.version}/route.json`),
    JSON.stringify(ROUTE_DOC),
  );
  const storePort = new FakeStoreSessionPort();
  const access = createAccessPort();
  const events: AccessReadyEvent[] = [];
  access.onAccessReady((event) => events.push(event));
  const grant = scriptedGrant({
    sources: options.sources ?? { ...GOOD_SOURCES },
    expireFirstMint: options.expireFirst,
    now: NOW,
  });
  const diagnostics: string[] = [];
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const deps: PurchaseChainDeps = {
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
    onDiagnostics: (line) => diagnostics.push(line),
  };
  return { chain: createPurchaseChain(deps), storePort, grant, events, root, diagnostics };
}

const unlockInput = async (sources: Record<string, Uint8Array> = GOOD_SOURCES) => ({
  identity: { deviceId: DEVICE },
  productId: PRODUCT,
  key: KEY,
  lock: await lockFrom(sources),
});

const withRoot = async (run: (rig: ChainRig) => Promise<void>): Promise<void> => {
  const rig = await chainRig();
  try {
    await run(rig);
  } finally {
    fs.rmSync(rig.root, { recursive: true, force: true });
  }
};

test('criterion 1: a download failure after payment keeps the product paid — the retry is a download, the store is never asked again', async () => {
  await withRoot(async (rig) => {
    // The purchase finishes; the transfer dies on the first file.
    rig.storePort.purchaseResolves({ productId: PRODUCT });
    rig.grant.failNextFetches(1);
    const first = await rig.chain.unlock(await unlockInput());
    assert.equal(first.kind, 'download-incomplete');
    assert.ok(first.kind === 'download-incomplete' && first.result.status === 'partial');
    assert.equal(rig.chain.stateOf(PRODUCT), 'paid');
    assert.deepEqual(rig.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
    assert.deepEqual(rig.events, []);

    // The retry: the store session is not touched again — no second link,
    // no second purchase — and the same unlock call completes the download;
    // the commit itself emits the AccessReady event through the port.
    const second = await rig.chain.unlock(await unlockInput());
    assert.equal(second.kind, 'ready');
    assert.equal(rig.chain.stateOf(PRODUCT), 'ready');
    assert.deepEqual(rig.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
    assert.deepEqual(rig.events, [
      {
        type: 'AccessReady',
        routeId: 'route-1',
        version: 'v1',
        locale: 'be',
        tier: 'base',
        stopIds: ['a', 'b'],
        issuer: 'services/download',
      },
    ]);
  });
});

test('criterion 1: honest store answers pass through and never start a download', async () => {
  await withRoot(async (rig) => {
    // The user backs out at the payment sheet.
    rig.storePort.purchaseRejects(rcError('1'));
    const outcome = await rig.chain.unlock(await unlockInput());
    assert.deepEqual(outcome, {
      kind: 'purchase-not-finished',
      state: 'not-owned',
      outcome: { kind: 'cancelled' },
    });
    assert.equal(rig.chain.stateOf(PRODUCT), 'not-owned');
    assert.deepEqual(rig.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
    assert.deepEqual(rig.grant.requested, []);
    assert.deepEqual(rig.events, []);
  });
});

test('criterion 1: already-owned — the store refuses a second charge, the chain marks paid and downloads', async () => {
  await withRoot(async (rig) => {
    // The across-restart path: the store session sees the non-consumable
    // already owned and refuses to charge; the chain treats the answer as
    // the owned fact and goes straight to the download.
    rig.storePort.purchaseRejects(rcError('6'));
    const outcome = await rig.chain.unlock(await unlockInput());
    assert.equal(outcome.kind, 'ready');
    assert.equal(rig.chain.stateOf(PRODUCT), 'ready');
    assert.deepEqual(rig.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
    assert.equal(rig.events.length, 1);
  });
});

test('criterion 2: an expired grant URL renews mid-download without a repeated purchase', async () => {
  const expired = await chainRig({ expireFirst: true });
  try {
    expired.storePort.purchaseResolves({ productId: PRODUCT });
    const outcome = await expired.chain.unlock(await unlockInput());
    assert.equal(outcome.kind, 'ready');
    // One POST to mint, one to re-grant the expired portion (09 §5.1) —
    // and exactly one purchase over the whole chain.
    assert.equal(expired.grant.requested.length, 2);
    assert.deepEqual(expired.grant.requested[0], expired.grant.requested[1]);
    assert.deepEqual(expired.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
  } finally {
    fs.rmSync(expired.root, { recursive: true, force: true });
  }
});

test('criterion 3: ready only after verify — a hash-mismatch is paid, not ready, and emits nothing', async () => {
  await withRoot(async (rig) => {
    rig.storePort.purchaseResolves({ productId: PRODUCT });
    rig.grant.serve({ ...GOOD_SOURCES, 'audio/story-1.m4a': AUDIO_WRONG });
    const first = await rig.chain.unlock(await unlockInput());
    assert.equal(first.kind, 'download-incomplete');
    assert.ok(first.kind === 'download-incomplete' && first.result.status === 'hash-mismatch');
    assert.equal(rig.chain.stateOf(PRODUCT), 'paid');
    // No commit, no event: the AccessReady emission is the activation
    // commit's own, not the chain's answer to a finished transfer.
    assert.deepEqual(rig.events, []);

    // The honest bytes arrive: the retry verifies every file and commits.
    rig.grant.serve({ ...GOOD_SOURCES });
    const second = await rig.chain.unlock(await unlockInput());
    assert.equal(second.kind, 'ready');
    assert.equal(rig.chain.stateOf(PRODUCT), 'ready');
    assert.equal(rig.events.length, 1);
  });
});

test('criterion 3 (disk truth): a ready product whose layer regressed re-activates and lands back on paid', async () => {
  await withRoot(async (rig) => {
    rig.storePort.purchaseResolves({ productId: PRODUCT });
    assert.equal((await rig.chain.unlock(await unlockInput())).kind, 'ready');

    // The layer disappears from the disk (a deletion, a damaged volume) —
    // the chain's own 'ready' must not stand in for the disk: the next
    // unlock re-runs the activation, the transfer fails, and the state
    // honestly regresses to paid.
    fs.rmSync(path.join(rig.root, `bundles/${KEY.routeId}/${KEY.version}/${KEY.locale}`), {
      recursive: true,
      force: true,
    });
    rig.grant.failNextFetches(1);
    const regressed = await rig.chain.unlock(await unlockInput());
    assert.equal(regressed.kind, 'download-incomplete');
    assert.equal(rig.chain.stateOf(PRODUCT), 'paid');

    // The repair completes without the store and without a second event:
    // the channel dedupes the identity per run (the engine already holds
    // the tier from the first commit).
    rig.grant.failNextFetches(0);
    assert.equal((await rig.chain.unlock(await unlockInput())).kind, 'ready');
    assert.equal(rig.events.length, 1);
    assert.deepEqual(rig.storePort.calls, [`link ${DEVICE}`, `purchase ${PRODUCT}`]);
  });
});

test('boundary: a corrupt request is invalid-input before any store, grant or filesystem call', async () => {
  await withRoot(async (rig) => {
    const outcome = await rig.chain.unlock({
      identity: { deviceId: DEVICE },
      productId: 'com.kudy.route.gdansk extended',
      key: { routeId: '../escape', version: 'v1', locale: 'be', tier: 'base' },
      lock: [],
    });
    assert.deepEqual(outcome, {
      kind: 'invalid-input',
      state: 'not-owned',
      diagnostics: ['chain#product-id', 'chain#layer-key', 'chain#lock'],
    });
    assert.deepEqual(rig.storePort.calls, []);
    assert.deepEqual(rig.grant.requested, []);

    // The identity rule is isolated on its own: a deviceId that is not the
    // UUID POST /v1/device issues is refused locally, the store untouched.
    const foreignIdentity = await rig.chain.unlock({
      identity: { deviceId: 'not-a-uuid' },
      productId: PRODUCT,
      key: KEY,
      lock: await lockFrom(GOOD_SOURCES),
    });
    assert.deepEqual(foreignIdentity, {
      kind: 'invalid-input',
      state: 'not-owned',
      diagnostics: ['chain#device-id'],
    });
    assert.deepEqual(rig.storePort.calls, []);

    // The corrupt request never touches the honest state either.
    rig.storePort.purchaseResolves({ productId: PRODUCT });
    assert.equal((await rig.chain.unlock(await unlockInput())).kind, 'ready');
    const afterReady = await rig.chain.unlock({
      identity: { deviceId: DEVICE },
      productId: PRODUCT,
      key: { ...KEY, locale: '../not-a-locale' },
      lock: [],
    });
    assert.deepEqual(afterReady, {
      kind: 'invalid-input',
      state: 'ready',
      diagnostics: ['chain#layer-key', 'chain#lock'],
    });
    assert.equal(rig.chain.stateOf(PRODUCT), 'ready');
  });
});
