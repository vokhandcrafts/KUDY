// G04.02.c — acceptance suite for the AccessReady capability channel
// (issue #191). Criteria:
// 1. one activation commit delivers exactly one event through the typed
//    DownloadAccessPort; an event object built outside the module has no
//    delivery path (runtime proof);
// 2. stop_ids are derived from the activated package's route.json, filtered
//    to the activated tier — never taken from a caller;
// 3. repeating the same identity produces no second emission;
// 4. a crash before the commit emits nothing; after a restart readiness is
//    derived from the disk and zone B carries no ready column or flag;
// 5. a download finishing after End mutates no session row; the files stay
//    under their package key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { activate, layerPath, recoverOnOpen, stagingLayerPath } from './download.ts';
import { createAccessPort, emitAccessReady, parseRouteStops } from './access.ts';
import type { AccessReadyEvent, DownloadAccessPort } from './access.ts';
import { createNodeDownloadStore, nodeSha256 } from './nodeDownloadStore.ts';
import { crashOnRename, lockFrom } from './test-fixture.ts';
import { finishSession, getSession, getBundleAssets, openDatabase, startSession } from '../db/db.ts';
import { ZONE_B_DDL } from '../db/schema.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { ActivateDeps, ActivateInput, FetchPort, LayerKey } from './types.ts';

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const KEY_EXT: LayerKey = { ...KEY, tier: 'extended' };

const utf8 = (text: string) => new TextEncoder().encode(text);

// route.json of the package (09 §7: a root file beside the locale
// directories, shape per contracts/schemas/route.schema.json). Three named
// stops — two base, one extended — and one unnamed entry the payload must
// skip; the ids of the activated tier are the unlock payload.
const ROUTE_DOC = {
  route_id: 'route-x',
  version: '1',
  city_id: 'city-x',
  access: 'paid',
  stops: [
    { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base' },
    { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'base' },
    { id: 'stop-3', position: 2, place_id: 'place-3', access_tier: 'extended' },
    { position: 3, place_id: 'place-4', access_tier: 'base' },
  ],
};

// The layer files (stories, not stops — the per-layer stops.json carries the
// story list; the route's stops live in route.json above).
const STORIES_BASE = utf8(
  '[{"story_id":"story-b","place_id":"place-1","voice_id":"voice-1","tier":"base","duration_s":60,"text":"t","transcript":"t","sources":["s"]}]',
);
const STORIES_EXT = utf8(
  '[{"story_id":"story-e","place_id":"place-3","voice_id":"voice-1","tier":"extended","duration_s":60,"text":"t","transcript":"t","sources":["s"]}]',
);
const AUDIO = utf8('audio-bytes-0123456789abcdef');

const LAYER_BASE: Record<string, Uint8Array> = { 'stops.json': STORIES_BASE, 'audio/story-b.m4a': AUDIO };
const LAYER_EXT: Record<string, Uint8Array> = { 'stops.json': STORIES_EXT, 'audio/story-e.m4a': AUDIO };

interface RigOptions {
  sources?: Record<string, Uint8Array>;
  // null — no route.json at the package root; a string — its raw bytes.
  routeJson?: string | null;
  handlers?: Array<(event: AccessReadyEvent) => void>;
}

// Test rig: a package root with route.json, a node store over it, a counting
// fetch port over the given sources, and a fresh port whose deliveries are
// recorded in `events`.
function rig(root: string, options: RigOptions = {}): {
  deps: ActivateDeps;
  access: DownloadAccessPort;
  events: AccessReadyEvent[];
  fetchLog: string[];
} {
  const routeJson = options.routeJson === undefined ? JSON.stringify(ROUTE_DOC) : options.routeJson;
  if (routeJson !== null) {
    fs.mkdirSync(path.join(root, 'bundles/route-x/1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bundles/route-x/1/route.json'), routeJson);
  }
  const sources = options.sources ?? LAYER_BASE;
  const store = createNodeDownloadStore(root);
  const access = createAccessPort();
  const events: AccessReadyEvent[] = [];
  access.onAccessReady((event) => events.push(event));
  for (const handler of options.handlers ?? []) access.onAccessReady(handler);
  const fetchLog: string[] = [];
  const fetch: FetchPort = async (rel) => {
    fetchLog.push(rel);
    const bytes = sources[rel];
    if (!bytes) throw new Error(`no source bytes for ${rel}`);
    return bytes;
  };
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return { access, events, fetchLog, deps: { store, fetch, sha256: nodeSha256, driver, access } };
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g0402c-'));
}

test('criterion 1: one commit delivers exactly one event; an outside-built object has no delivery path', async () => {
  const root = tmpRoot();
  try {
    const { access, events, deps } = rig(root);

    // An event built outside the module. Every public surface is tried:
    // the port exposes only onAccessReady (a handler registration, not a
    // delivery), emitAccessReady takes no event object at all, and against
    // a port it did not create the module fails closed.
    const forged = {
      type: 'AccessReady',
      routeId: 'route-x',
      version: '9',
      locale: 'be',
      tier: 'extended',
      stopIds: ['stop-3'],
      issuer: 'services/download',
    };
    assert.deepEqual(Object.keys(access), ['onAccessReady']);
    const foreignEvents: AccessReadyEvent[] = [];
    const foreign: DownloadAccessPort = { onAccessReady: () => foreignEvents.push(forged as AccessReadyEvent) };
    assert.deepEqual(await emitAccessReady(foreign, KEY, async () => null), ['access#no-channel']);
    assert.deepEqual(foreignEvents, []);
    assert.deepEqual(events, []);

    // The commit delivers the event the module built itself. Event-shaped
    // fields smuggled onto the activation input (stopIds, issuer, type) are
    // ignored — the honest key wins and the payload comes from the disk.
    const tampered: ActivateInput = { ...forged, ...KEY, lock: await lockFrom(LAYER_BASE) } as ActivateInput;
    const result = await activate(tampered, deps);
    assert.equal(result.status, 'complete');
    assert.deepEqual(events, [
      {
        type: 'AccessReady',
        routeId: 'route-x',
        version: '1',
        locale: 'be',
        tier: 'base',
        stopIds: ['stop-1', 'stop-2'],
        issuer: 'services/download',
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 2: stop_ids come from the activated package, filtered to the activated tier', async () => {
  const root = tmpRoot();
  try {
    const base = rig(root);
    const baseResult = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, base.deps);
    assert.equal(baseResult.status, 'complete');
    assert.deepEqual(base.events[0]?.stopIds, ['stop-1', 'stop-2']);

    // The extended layer of the same package unlocks only its own stops.
    const ext = rig(root, { sources: LAYER_EXT });
    const extResult = await activate({ ...KEY_EXT, lock: await lockFrom(LAYER_EXT) }, ext.deps);
    assert.equal(extResult.status, 'complete');
    assert.deepEqual(ext.events[0]?.stopIds, ['stop-3']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 2: a missing or corrupt route.json yields an empty payload with a diagnostic, never a throw', async () => {
  const rootMissing = tmpRoot();
  try {
    const missing = rig(rootMissing, { routeJson: null });
    const result = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, missing.deps);
    assert.equal(result.status, 'complete');
    assert.deepEqual(missing.events[0]?.stopIds, []);
    assert.deepEqual(result.diagnostics, ['access#route-json-missing']);
  } finally {
    fs.rmSync(rootMissing, { recursive: true, force: true });
  }

  const rootCorrupt = tmpRoot();
  try {
    const corrupt = rig(rootCorrupt, { routeJson: '{"stops": nope' });
    const result = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, corrupt.deps);
    assert.equal(result.status, 'complete');
    assert.deepEqual(corrupt.events[0]?.stopIds, []);
    assert.deepEqual(result.diagnostics, ['access#route-json-invalid']);
  } finally {
    fs.rmSync(rootCorrupt, { recursive: true, force: true });
  }
});

test('parseRouteStops: unnamed stops and foreign tiers are skipped, corrupt input is diagnosed', () => {
  const corrupt = parseRouteStops(utf8('nope{'), 'base');
  assert.deepEqual(corrupt, { stopIds: [], diagnostic: 'access#route-json-invalid' });
  const noStops = parseRouteStops(utf8('{"route_id":"route-x"}'), 'base');
  assert.deepEqual(noStops, { stopIds: [], diagnostic: 'access#route-json-invalid' });
  const mixed = parseRouteStops(
    utf8(
      JSON.stringify({
        stops: [
          null,
          42,
          { id: 7, access_tier: 'base' },
          { id: 'other-tier', access_tier: 'extended' },
          { id: 'good', access_tier: 'base' },
        ],
      }),
    ),
    'base',
  );
  assert.deepEqual(mixed, { stopIds: ['good'] });
});

test('criterion 3: repeating the same identity produces no second emission', async () => {
  const root = tmpRoot();
  try {
    const { access, events, deps } = rig(root);
    const lock = await lockFrom(LAYER_BASE);
    await activate({ ...KEY, lock }, deps);
    const repeated = await activate({ ...KEY, lock }, deps);
    assert.equal(repeated.status, 'complete');
    assert.equal((repeated as Extract<typeof repeated, { status: 'complete' }>).fetched, 0);
    assert.equal(events.length, 1);

    // A different identity still emits: the dedupe is per identity, not global.
    const extFetch: FetchPort = async (rel) => {
      const bytes = LAYER_EXT[rel];
      if (!bytes) throw new Error(`no source bytes for ${rel}`);
      return bytes;
    };
    const extResult = await activate(
      { ...KEY_EXT, lock: await lockFrom(LAYER_EXT) },
      { ...deps, fetch: extFetch },
    );
    assert.equal(extResult.status, 'complete');
    assert.equal(events.length, 2);
    assert.equal(events[1]?.tier, 'extended');
    assert.deepEqual(events[1]?.stopIds, ['stop-3']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: a crash before the commit emits nothing; recovery on open derives from disk', async () => {
  const root = tmpRoot();
  try {
    // The injected crash kills the process at the final rename — the commit
    // did not happen, so no event may exist (Proof: an emission moved before
    // this rename fires here and this test fails).
    const { access, events, deps } = rig(root);
    const crashingStore = crashOnRename(deps.store, (_from, to) => to === layerPath(KEY));
    await assert.rejects(
      activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, { ...deps, store: crashingStore }),
      { message: 'injected crash' },
    );
    assert.deepEqual(events, []);
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);

    // Restart: readiness derives from the disk — the final layer is absent,
    // the rebuilt registry says pending, the answer is not-ready.
    const recovered = await recoverOnOpen({ ...KEY, lock: await lockFrom(LAYER_BASE) }, {
      store: deps.store,
      sha256: deps.sha256,
      driver: deps.driver,
    });
    assert.deepEqual(recovered, { status: 'not-ready', key: KEY });
    assert.equal(getBundleAssets(deps.driver, KEY).every((row) => row.status === 'pending'), true);

    // The retry completes on a fresh run (new port) and emits exactly once;
    // resume keeps the staged files (zero fetches).
    const retry = rig(root);
    const retryResult = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, retry.deps);
    assert.equal(retryResult.status, 'complete');
    assert.equal((retryResult as Extract<typeof retryResult, { status: 'complete' }>).fetched, 0);
    assert.equal(retry.events.length, 1);

    // The crash row "between rename and AccessReady" self-heals: a fresh run
    // derives readiness from the disk (ready), receives nothing from the
    // recovery itself — the commit is the single emission site — and the next
    // activation in that run delivers the event once.
    const restarted = rig(root);
    const healed = await recoverOnOpen({ ...KEY, lock: await lockFrom(LAYER_BASE) }, {
      store: restarted.deps.store,
      sha256: restarted.deps.sha256,
      driver: restarted.deps.driver,
    });
    assert.deepEqual(healed, { status: 'ready', key: KEY });
    assert.deepEqual(restarted.events, []);
    const reconfirmed = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, restarted.deps);
    assert.equal(reconfirmed.status, 'complete');
    assert.equal(restarted.events.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: zone B carries no ready column or flag', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  for (const table of Object.keys(ZONE_B_DDL)) {
    const columns = driver.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
    assert.equal(
      columns.some((name) => /ready/i.test(name)),
      false,
      `${table} carries a ready column: ${columns.join(', ')}`,
    );
  }
  // The session row is the ADR G01.03 §3.1 field set, verbatim — no room for
  // a readiness flag next to it.
  const sessionColumns = driver
    .prepare('PRAGMA table_info(session)')
    .all()
    .map((row) => String(row.name))
    .sort();
  assert.deepEqual(sessionColumns, [
    'auto_fired',
    'finished_at',
    'heard',
    'last_stop_id',
    'locale',
    'play_seq',
    'route_id',
    'session_id',
    'started_at',
    'state',
    'tier',
    'version',
  ]);
});

test('criterion 5: a download finishing after End mutates no session row; files stay under the package key', async () => {
  const root = tmpRoot();
  try {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    const START = { sessionId: 'sess-1', routeId: 'route-x', version: '1', locale: 'be', startedAt: 100 };
    startSession(driver, START);
    finishSession(driver, 'sess-1', { finishedAt: 200 });
    const rowBefore = getSession(driver, 'sess-1');

    const { events, deps } = rig(root);
    const result = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, deps);
    assert.equal(result.status, 'complete');
    assert.equal(events.length, 1);
    assert.deepEqual(getSession(driver, 'sess-1'), rowBefore);

    // The files live under the package key; staging is gone after the commit.
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY), 'stops.json')), true);
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY), 'audio/story-b.m4a')), true);
    assert.equal(fs.existsSync(path.join(root, stagingLayerPath(KEY))), false);
    assert.equal(getBundleAssets(deps.driver, KEY).every((row) => row.status === 'complete'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 5: a download finishing during a live session mutates no session row either', async () => {
  const root = tmpRoot();
  try {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    startSession(driver, { sessionId: 'sess-2', routeId: 'route-x', version: '1', locale: 'be', startedAt: 100 });
    const rowBefore = getSession(driver, 'sess-2');

    const { deps } = rig(root);
    const result = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, deps);
    assert.equal(result.status, 'complete');
    assert.deepEqual(getSession(driver, 'sess-2'), rowBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a handler that throws is isolated: the remaining handlers still receive the event, the failure surfaces', async () => {
  const root = tmpRoot();
  try {
    const seen: AccessReadyEvent[] = [];
    const { events, deps } = rig(root, {
      handlers: [
        () => {
          throw new Error('boom');
        },
        (event) => seen.push(event),
      ],
    });
    const result = await activate({ ...KEY, lock: await lockFrom(LAYER_BASE) }, deps);
    assert.equal(result.status, 'complete');
    assert.equal(events.length, 1);
    assert.equal(seen.length, 1);
    assert.deepEqual(result.diagnostics, ['access#handler-threw:boom']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
