// G04.02.a — acceptance suite for the download activation core (issue #189).
// Criteria:
// 1. an interrupted transfer, lack of space, a corrupted hash and a repeated
//    request each have their own test, none of them yields ready, and a
//    failed upgrade leaves the old ready layer byte-identical;
// 2. resume does not re-fetch files already verified by hash (fetches counted);
// 3. staging sits next to the final directory; an injected crash between
//    verify and rename leaves the old or the new complete layer, never a mix;
// 4. every segment and lock path is checked as a safe unit on input before
//    any filesystem call; a corrupt lock.json yields diagnostics, not a throw;
// 5. bundle_asset reflects pending/partial/complete, is rebuilt by re-hashing
//    the disk, and zone B stays untouched;
// 6. hashing is over raw bytes (committed CRLF fixture, EOL-pinned) and the
//    suite is enumerated by npm test (the services glob — wiring.test.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { activate, layerPath, recoverOnOpen, rebuildBundleAssets, stagingLayerPath } from './download.ts';
import { createDeletionGate, deletePackage } from './delete.ts';
import { createNodeDownloadStore, nodeSha256 } from './nodeDownloadStore.ts';
import {
  AUDIO,
  crashOnRename,
  depsFor,
  GOOD,
  lockFrom,
  openFresh,
  recordingStore,
  snapshotDir,
  STOPS,
  utf8,
} from './test-fixture.ts';
import { getBundleAssets, getSession, startSession } from '../db/db.ts';
import type { SqlDriver } from '../db/types.ts';
import type { ActivationResult, ActivateDeps, DeletionGate, LayerKey } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// Same length as AUDIO, one byte flipped — a corrupted transfer the size
// check cannot see but the hash must.
const AUDIO_TAMPERED = (() => {
  const bytes = Uint8Array.from(AUDIO);
  bytes[3] ^= 0xff;
  return bytes;
})();

const totalBytes = (sources: Record<string, Uint8Array>) =>
  Object.values(sources).reduce((sum, bytes) => sum + bytes.length, 0);

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g0402a-'));
}

test('criterion 1: an interrupted transfer stays partial, never ready, and resume completes', async () => {
  const root = tmpRoot();
  try {
    const { deps, fetchLog } = depsFor(root);
    const lock = await lockFrom(GOOD);
    // The transfer dies on the second file: the fetch port rejects.
    const realFetch = deps.fetch;
    let calls = 0;
    deps.fetch = async (rel) => {
      calls += 1;
      if (calls === 2) throw new Error('connection lost');
      return realFetch(rel);
    };

    const failed = await activate({ ...KEY, lock }, deps);
    assert.equal(failed.status, 'partial');
    const partial = failed as Extract<typeof failed, { status: 'partial' }>;
    assert.deepEqual(partial.missing, ['audio/story-1.m4a']);
    assert.deepEqual(partial.diagnostics, ['audio/story-1.m4a#fetch-failed', 'connection lost']);
    // Partial never counts as ready: no final layer appeared.
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);

    // The transfer returns: only the missing file is fetched (criterion 2).
    // The failed audio attempt rejected before the port resolved, so the log
    // carries one entry per run: stops.json, then audio on the resume.
    const resumed = await activate({ ...KEY, lock }, deps);
    assert.equal(resumed.status, 'complete');
    assert.equal((resumed as Extract<typeof resumed, { status: 'complete' }>).fetched, 1);
    assert.deepEqual(fetchLog, ['stops.json', 'audio/story-1.m4a']);
    assert.equal(fs.readFileSync(path.join(root, layerPath(KEY), 'stops.json')).toString('hex'), hex(STOPS));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: lack of space yields insufficient-space and fetches nothing', async () => {
  const root = tmpRoot();
  try {
    const { deps, fetchLog } = depsFor(root, { freeBytes: 5 });
    const result = await activate({ ...KEY, lock: await lockFrom(GOOD) }, deps);
    assert.equal(result.status, 'insufficient-space');
    assert.deepEqual(result as Extract<typeof result, { status: 'insufficient-space' }>, {
      status: 'insufficient-space',
      key: KEY,
      needed: totalBytes(GOOD),
      free: 5,
    });
    assert.deepEqual(fetchLog, []);
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a corrupted hash yields hash-mismatch, never ready, and corrupt bytes are not kept', async () => {
  const root = tmpRoot();
  try {
    // Size first: a shorter transfer is already a corrupted one.
    const shortSources = { ...GOOD, 'audio/story-1.m4a': AUDIO.slice(0, AUDIO.length - 4) };
    const short = depsFor(root, { sources: shortSources });
    const sizeResult = await activate({ ...KEY, lock: await lockFrom(GOOD) }, short.deps);
    assert.equal(sizeResult.status, 'hash-mismatch');
    assert.deepEqual((sizeResult as Extract<typeof sizeResult, { status: 'hash-mismatch' }>).diagnostics, [
      'audio/story-1.m4a#size-mismatch',
    ]);
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);

    // Same length, flipped byte: only the full hash catches it.
    const byteSources = { ...GOOD, 'audio/story-1.m4a': AUDIO_TAMPERED };
    const bytes = depsFor(root, { sources: byteSources });
    const hashResult = await activate({ ...KEY, lock: await lockFrom(GOOD) }, bytes.deps);
    assert.equal(hashResult.status, 'hash-mismatch');
    assert.deepEqual((hashResult as Extract<typeof hashResult, { status: 'hash-mismatch' }>).diagnostics, [
      'audio/story-1.m4a#sha256-mismatch',
    ]);
    // The corrupt bytes never entered staging: nothing to "accidentally" keep.
    assert.equal(await bytes.deps.store.readFile(`${stagingLayerPath(KEY)}/audio/story-1.m4a`), null);
    assert.equal(fs.existsSync(path.join(root, layerPath(KEY))), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a repeated request after failure stays failed; after complete it is a no-op with zero fetches', async () => {
  const root = tmpRoot();
  try {
    const sources: Record<string, Uint8Array> = { ...GOOD, 'audio/story-1.m4a': AUDIO_TAMPERED };
    const { deps } = depsFor(root, { sources });
    const lock = await lockFrom(GOOD);
    const first = await activate({ ...KEY, lock }, deps);
    const second = await activate({ ...KEY, lock }, deps);
    assert.equal(first.status, 'hash-mismatch');
    assert.equal(second.status, 'hash-mismatch');

    // The transfer heals: activation completes (stops.json was already kept
    // in staging from the failed runs — only the audio is fetched).
    sources['audio/story-1.m4a'] = AUDIO;
    const healing = depsFor(root, { sources });
    const third = await activate({ ...KEY, lock }, healing.deps);
    assert.equal(third.status, 'complete');

    // Repeated request for the complete layer: no fetches, files unchanged,
    // stale staging junk for this key swept away.
    const before = snapshotDir(root, 'bundles');
    await healing.deps.store.ensureDir(`${stagingLayerPath(KEY)}/audio`);
    await healing.deps.store.writeFile(`${stagingLayerPath(KEY)}/audio/story-1.m4a.part`, utf8('ambiguous leftover'));
    const repeated = await activate({ ...KEY, lock }, healing.deps);
    assert.equal(repeated.status, 'complete');
    assert.equal((repeated as Extract<typeof repeated, { status: 'complete' }>).fetched, 0);
    assert.deepEqual(snapshotDir(root, 'bundles'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a failed upgrade leaves the old ready layer byte-identical', async () => {
  const root = tmpRoot();
  try {
    const v2: LayerKey = { ...KEY, version: '2' };
    const sources: Record<string, Uint8Array> = { ...GOOD };
    const { deps } = depsFor(root, { sources });
    const lockV1 = await lockFrom(GOOD);
    assert.equal((await activate({ ...KEY, lock: lockV1 }, deps)).status, 'complete');
    const before = snapshotDir(root, `bundles/${KEY.routeId}/${KEY.version}`);

    // Upgrade to version 2 fails on a corrupted audio file.
    sources['audio/story-1.m4a'] = AUDIO_TAMPERED;
    const lockV2 = await lockFrom(GOOD);
    const failed = await activate({ ...v2, lock: lockV2 }, deps);
    assert.equal(failed.status, 'hash-mismatch');

    // The old ready layer did not move by a byte.
    assert.deepEqual(snapshotDir(root, `bundles/${KEY.routeId}/${KEY.version}`), before);
    assert.equal(fs.existsSync(path.join(root, layerPath(v2))), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 2: resume does not re-fetch files already verified by hash', async () => {
  const root = tmpRoot();
  try {
    const { deps, fetchLog } = depsFor(root);
    // Pre-seed staging: stops.json hash-verified, audio ambiguous (.part).
    await deps.store.ensureDir(`${stagingLayerPath(KEY)}/audio`);
    await deps.store.writeFile(`${stagingLayerPath(KEY)}/stops.json`, STOPS);
    await deps.store.writeFile(`${stagingLayerPath(KEY)}/audio/story-1.m4a.part`, utf8('half a transfer'));

    const result = await activate({ ...KEY, lock: await lockFrom(GOOD) }, deps);
    assert.equal(result.status, 'complete');
    // Exactly one fetch: the ambiguous audio; the verified stops.json was not
    // re-fetched, and the .part leftover did not count as present.
    assert.deepEqual(fetchLog, ['audio/story-1.m4a']);
    assert.equal(
      fs.readFileSync(path.join(root, layerPath(KEY), 'audio/story-1.m4a')).toString('hex'),
      hex(AUDIO),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a crash between verify and rename leaves the old layer, and recovery needs no re-fetch', async () => {
  const root = tmpRoot();
  try {
    const v2: LayerKey = { ...KEY, version: '2' };
    const sources: Record<string, Uint8Array> = { ...GOOD };
    const { deps } = depsFor(root, { sources });
    const lockV1 = await lockFrom(GOOD);
    const lockV2 = await lockFrom(GOOD);
    assert.equal((await activate({ ...KEY, lock: lockV1 }, deps)).status, 'complete');
    const v1Snapshot = snapshotDir(root, `bundles/${KEY.routeId}/${KEY.version}`);

    // The v2 layer verifies fully; death strikes exactly at the activation
    // rename into the final directory.
    const crashing = crashOnRename(deps.store, (_from, to) => to === layerPath(v2));
    await assert.rejects(activate({ ...v2, lock: lockV2 }, { ...deps, store: crashing }), /injected crash/);
    // Old complete layer untouched, new layer absent — never a mix.
    assert.deepEqual(snapshotDir(root, `bundles/${KEY.routeId}/${KEY.version}`), v1Snapshot);
    assert.equal(fs.existsSync(path.join(root, layerPath(v2))), false);
    // The verified v2 files wait in staging.
    const staged = await deps.store.readFile(`${stagingLayerPath(v2)}/audio/story-1.m4a`);
    assert.notEqual(staged, null);
    assert.equal(hex(staged!), hex(AUDIO));

    // Recovery: the staged files hash-verify, so nothing is re-fetched.
    const done = await activate({ ...v2, lock: lockV2 }, deps);
    assert.equal(done.status, 'complete');
    assert.equal((done as Extract<typeof done, { status: 'complete' }>).fetched, 0);
    assert.deepEqual(snapshotDir(root, `bundles/${KEY.routeId}/${KEY.version}`), v1Snapshot);
    assert.equal(fs.readFileSync(path.join(root, layerPath(v2), 'stops.json')).toString('hex'), hex(STOPS));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a crash while repairing a damaged layer never mixes old and new', async () => {
  const root = tmpRoot();
  try {
    const { deps } = depsFor(root);
    const lock = await lockFrom(GOOD);
    assert.equal((await activate({ ...KEY, lock }, deps)).status, 'complete');

    // The final layer gets damaged on disk (bit rot, tampering): the level-2
    // size check fails, so the next activation takes the replace path.
    await deps.store.writeFile(`${layerPath(KEY)}/stops.json`, utf8('{"stops":[]'));
    const damaged = snapshotDir(root, layerPath(KEY));

    // Death between the two replace renames: the damaged layer moved to
    // staging trash but the new layer did not land yet.
    const crashing = crashOnRename(deps.store, (from) => from === layerPath(KEY));
    await assert.rejects(activate({ ...KEY, lock }, { ...deps, store: crashing }), /injected crash/);
    // The final directory holds exactly the old (damaged) bytes — no mix.
    assert.deepEqual(snapshotDir(root, layerPath(KEY)), damaged);

    // Recovery: the re-run repairs the layer and sweeps the trash.
    const done = await activate({ ...KEY, lock }, deps);
    assert.equal(done.status, 'complete');
    assert.equal(fs.readFileSync(path.join(root, layerPath(KEY), 'stops.json')).toString('hex'), hex(STOPS));
    assert.equal(fs.existsSync(path.join(root, `${stagingLayerPath(KEY)}.old`)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: unsafe segments and lock paths are rejected before any filesystem call', async () => {
  const root = tmpRoot();
  try {
    const { deps } = depsFor(root);
    const { store: spy, calls } = recordingStore(deps.store);
    const unsafeKeys: Array<[LayerKey, string]> = [
      [{ ...KEY, routeId: '../evil' }, 'route_id#unsafe-path:../evil'],
      [{ ...KEY, version: 'a/b' }, 'version#unsafe-path:a/b'],
      [{ ...KEY, locale: '/abs' }, 'locale#unsafe-path:/abs'],
      [{ ...KEY, locale: 'be\u0000x' }, 'locale#unsafe-path:be\u0000x'],
      // An out-of-contract tier is exactly the fault the type normally rules
      // out — the input boundary still has to catch it.
      [{ ...KEY, tier: 'premium' } as unknown as LayerKey, 'tier#type'],
    ];
    for (const [key, diagnostic] of unsafeKeys) {
      const result = await activate({ ...key, lock: await lockFrom(GOOD) }, { ...deps, store: spy });
      assert.equal(result.status, 'invalid-input');
      assert.deepEqual((result as Extract<typeof result, { status: 'invalid-input' }>).diagnostics, [diagnostic]);
    }
    const unsafeLock = await activate(
      { ...KEY, lock: [{ path: '../escape', bytes: 1, sha256: 'x' }] },
      { ...deps, store: spy },
    );
    assert.equal(unsafeLock.status, 'invalid-input');
    assert.deepEqual((unsafeLock as Extract<typeof unsafeLock, { status: 'invalid-input' }>).diagnostics, [
      'lock.json[0]#unsafe-path:../escape',
    ]);
    // Validation ran before the first filesystem call: nothing was touched.
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: a corrupt lock.json yields diagnostics, never a throw', async () => {
  const root = tmpRoot();
  try {
    const { deps } = depsFor(root);
    const corruptLocks: Array<[unknown, string | null]> = [
      ['nope', 'lock.json#type'],
      [null, 'lock.json#type'],
      [[], 'lock.json#empty'],
      [[null], 'lock.json[0]#type'],
      [[{}], 'lock.json[0].path#type'],
      [[{ path: 'a', bytes: 1 }], 'lock.json[0].sha256#type'],
      [[{ path: 'a', bytes: -1, sha256: 'x' }], 'lock.json[0].bytes#type'],
      [[{ path: 'a', bytes: 1.5, sha256: 'x' }], 'lock.json[0].bytes#type'],
      [[{ path: 'a', bytes: '10', sha256: 'x' }], 'lock.json[0].bytes#type'],
      [[{ path: 'a', bytes: 1, sha256: 5 }], 'lock.json[0].sha256#type'],
      [
        [
          { path: 'a', bytes: 1, sha256: 'x' },
          { path: 'a', bytes: 1, sha256: 'x' },
        ],
        'lock.json[1]#duplicate:a',
      ],
    ];
    for (const [lock, diagnostic] of corruptLocks) {
      const result = await activate({ ...KEY, lock }, deps);
      assert.equal(result.status, 'invalid-input', `lock ${JSON.stringify(lock)} must be diagnosed`);
      if (diagnostic !== null) {
        assert.deepEqual((result as Extract<typeof result, { status: 'invalid-input' }>).diagnostics, [diagnostic]);
      }
    }
    assert.equal(fs.existsSync(path.join(root, 'bundles')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 5: bundle_asset reflects pending/partial/complete and rebuilds from the disk; zone B stays untouched', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const sessionId = '11111111-1111-4111-8111-111111111111';
    startSession(driver, {
      sessionId,
      routeId: KEY.routeId,
      version: KEY.version,
      locale: KEY.locale,
      startedAt: 1_700_000_000_000,
    });
    driver.prepare("INSERT INTO settings (key, value) VALUES ('analytics_consent', 'granted')").run();
    driver
      .prepare(
        "INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent) VALUES ('evt-1', 'session_started', 1, 1, '{}', 0)",
      )
      .run();
    const sessionBefore = getSession(driver, sessionId);

    const { deps } = depsFor(root, { driver });
    const lock = await lockFrom(GOOD);

    // Interrupted transfer: the registry shows the verified file and the
    // pending one — pending/partial/complete as honest disk facts.
    const realFetch = deps.fetch;
    let calls = 0;
    deps.fetch = async (rel) => {
      calls += 1;
      if (calls === 2) throw new Error('connection lost');
      return realFetch(rel);
    };
    await activate({ ...KEY, lock }, deps);
    let rows = getBundleAssets(driver, KEY);
    assert.deepEqual(
      rows.map((row) => [row.path, row.status, row.bytesDone]),
      [
        ['audio/story-1.m4a', 'pending', 0],
        ['stops.json', 'complete', STOPS.length],
      ],
    );

    // Complete: every row carries the verified size and the lock hash.
    assert.equal((await activate({ ...KEY, lock }, deps)).status, 'complete');
    rows = getBundleAssets(driver, KEY);
    assert.deepEqual(
      rows.map((row) => [row.path, row.status, row.bytesDone, row.bytesTotal, row.sha256]),
      [
        ['audio/story-1.m4a', 'complete', AUDIO.length, AUDIO.length, await nodeSha256(AUDIO)],
        ['stops.json', 'complete', STOPS.length, STOPS.length, await nodeSha256(STOPS)],
      ],
    );

    // Bit rot on the final layer: the rebuild re-hashes the disk and marks
    // the damaged file partial with its honest size.
    const damagedStops = utf8('{"stops":[?\n');
    await deps.store.writeFile(`${layerPath(KEY)}/stops.json`, damagedStops);
    const rebuilt = await rebuildBundleAssets({ ...KEY, lock }, deps);
    assert.equal(rebuilt.status, 'rebuilt');
    rows = getBundleAssets(driver, KEY);
    assert.deepEqual(
      rows.map((row) => [row.path, row.status, row.bytesDone]),
      [
        ['audio/story-1.m4a', 'complete', AUDIO.length],
        ['stops.json', 'partial', damagedStops.length],
      ],
    );

    // Zone B is untouched by the whole run.
    assert.deepEqual(getSession(driver, sessionId), sessionBefore);
    assert.equal(driver.prepare("SELECT value FROM settings WHERE key = 'analytics_consent'").get()?.value, 'granted');
    assert.equal(driver.prepare('SELECT COUNT(*) AS n FROM event_queue').get()?.n, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 6: hashing runs over raw bytes — the committed CRLF fixture verifies unchanged', async () => {
  const store = createNodeDownloadStore(path.join(here, 'fixtures', 'eol'));
  const crlf = await store.readFile('crlf.txt');
  assert.notEqual(crlf, null);
  // The sha256 of the committed bytes, fixed here: an EOL-converting checkout
  // changes the bytes and this assertion fails (AR-1, implementation-rules 4).
  assert.equal(await nodeSha256(crlf!), 'bed1003a7256342ba47cf2284b30a63c62ad57c87f1c5eb417f95e8e886c0a21');
  const binary = await store.readFile('bytes.bin');
  assert.equal(binary!.length, 256);
  assert.equal(await nodeSha256(binary!), '40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880');
});

test('criterion 6: activation hashes the transferred bytes — CRLF content verifies, an EOL-flipped hash mismatches', async () => {
  const root = tmpRoot();
  try {
    // A layer whose content carries CRLF bytes, hashed as-is.
    const crlfSource = { 'audio/story-1.m4a': utf8('town square guide.\r\nstop two.\r\n') };
    const { deps } = depsFor(root, { sources: crlfSource });
    const good = await activate({ ...KEY, lock: await lockFrom(crlfSource) }, deps);
    assert.equal(good.status, 'complete');

    // The LF-converted bytes of the same text must NOT verify against the
    // CRLF lock: no silent EOL normalization may sneak into the check.
    const lfSource = { 'audio/story-1.m4a': utf8('town square guide.\nstop two.\n') };
    const flipped = depsFor(root, { sources: lfSource });
    const v2: LayerKey = { ...KEY, version: '2' };
    const result = await activate({ ...v2, lock: await lockFrom(crlfSource) }, flipped.deps);
    assert.equal(result.status, 'hash-mismatch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// G20.09 — same-package overlap (issue #480). Two activate() calls of one
// layer share the staging tree, the .part names and the rename tail; the
// per-package lane serializes them, and these tests fail when that
// serialization is reverted.

// A fetch port that parks on one path until the test releases it — the
// controlled barrier of the overlap schedules.
function parkingFetch(deps: ActivateDeps, parkedPath: string): { release: () => void } {
  const realFetch = deps.fetch;
  let release: () => void = () => {};
  const parked = new Promise<void>((resolve) => {
    release = resolve;
  });
  deps.fetch = async (rel) => {
    if (rel === parkedPath) await parked;
    return realFetch(rel);
  };
  return { release };
}

// Resolves once a rename lands on the target path: the overlap window opens
// exactly there (a file is staged; the rename tail has not run).
function signalOnRename(deps: ActivateDeps, targetRel: string): Promise<void> {
  const realRename = deps.store.rename.bind(deps.store);
  let resolve!: () => void;
  const signal = new Promise<void>((r) => {
    resolve = r;
  });
  deps.store = {
    ...deps.store,
    rename: async (from: string, to: string) => {
      await realRename(from, to);
      if (to === targetRel) resolve();
    },
  };
  return signal;
}

// Guard for the independence proof: the promise must settle on its own, a
// global (cross-package) queue would leave it parked until the timeout.
function raceWithTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('unrelated package lanes blocked each other')), ms);
  });
  guard.catch(() => {});
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Criterion 1 — the ready inventory must equal the disk at every publish
// point: every lock path complete in the registry, every file present with
// the hash the row claims, no staging or trash leftovers.
async function assertPublishPoint(
  root: string,
  driver: SqlDriver,
  key: LayerKey,
  sources: Record<string, Uint8Array>,
): Promise<void> {
  const store = createNodeDownloadStore(root);
  const rows = getBundleAssets(driver, key);
  assert.deepEqual(
    rows.map((row) => [row.path, row.status]).sort(),
    Object.keys(sources).map((rel) => [rel, 'complete']).sort(),
  );
  for (const row of rows) {
    const disk = await store.readFile(`${layerPath(key)}/${row.path}`);
    assert.notEqual(disk, null, `${row.path} exists on disk`);
    assert.equal(await nodeSha256(disk!), row.sha256, `${row.path} disk bytes match the registry hash`);
    assert.equal(disk!.length, row.bytesDone);
  }
  assert.equal(await store.exists(stagingLayerPath(key)), false);
  assert.equal(await store.exists(`${stagingLayerPath(key)}.old`), false);
}

// The overlap rig: a fresh driver over the two-file layer, the store wired
// to signal when stops.json lands in staging, the fetch port parked on the
// audio transfer, activation A started and B requested exactly at that
// window. The optional deletion gate is wired into the deps of both
// requests before either body runs; the caller owns the gate instance and
// hands the same one to deletePackage().
async function overlapRig(
  root: string,
  gate?: DeletionGate,
): Promise<{
  driver: SqlDriver;
  deps: ActivateDeps;
  parking: { release: () => void };
  first: Promise<ActivationResult>;
  second: Promise<ActivationResult>;
  lock: unknown;
}> {
  const driver = openFresh();
  const { deps } = depsFor(root, { driver });
  if (gate) deps.cancel = gate;
  const lock = await lockFrom(GOOD);
  const stagedStops = signalOnRename(deps, `${stagingLayerPath(KEY)}/stops.json`);
  const parking = parkingFetch(deps, 'audio/story-1.m4a');
  const first = activate({ ...KEY, lock }, deps);
  await stagedStops;
  const second = activate({ ...KEY, lock }, deps);
  return { driver, deps, parking, first, second, lock };
}

test('G20.09 overlapping_same_key_activation: the second tail cannot turn a ready layer incomplete', async () => {
  const root = tmpRoot();
  try {
    // A parks on the audio fetch with stops.json already staged; B overlaps
    // A on the same layer key exactly there. On the package lane B runs only
    // after A's rename tail has settled; reverted, B's tail moves A's
    // complete final layer into the staging trash and deletes it.
    const { driver, parking, first, second } = await overlapRig(root);
    parking.release();

    const a = await first;
    const b = await second;
    assert.equal(a.status, 'complete');
    assert.equal(b.status, 'complete');
    // B saw the layer A committed: the repeated-request fast path, zero
    // fetches (the unserialized B fetched the audio file itself).
    assert.equal((b as Extract<typeof b, { status: 'complete' }>).fetched, 0);
    await assertPublishPoint(root, driver, KEY, GOOD);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G20.09 cancel_delete_overlap: a deletion mid-flight cancels the parked activation and the queued one re-downloads', async () => {
  const root = tmpRoot();
  try {
    const gate = createDeletionGate();
    const { driver, deps, parking, first, second } = await overlapRig(root, gate);
    await deletePackage({ routeId: KEY.routeId, version: KEY.version }, { store: deps.store, driver, gate });
    parking.release();

    // The parked body stopped named at the boundary after its fetch: no
    // write resurrected what the user deleted, zone-A rows went with it.
    // `fetched` stays honest — the one file transferred before the stop.
    const a = await first;
    assert.equal(a.status, 'cancelled');
    assert.equal((a as Extract<typeof a, { status: 'cancelled' }>).fetched, 1);
    assert.deepEqual(getBundleAssets(driver, KEY), []);

    // The queued activation began after the delete: the new epoch, a normal
    // fresh download — re-downloading a deleted package must work.
    const b = await second;
    assert.equal(b.status, 'complete');
    await assertPublishPoint(root, driver, KEY, GOOD);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G20.09 cancel_delete_overlap: a fetch failure parks a partial activation and the queued one resumes it', async () => {
  const root = tmpRoot();
  try {
    const driver = openFresh();
    const { deps, fetchLog } = depsFor(root, { driver });
    const lock = await lockFrom(GOOD);

    // A's audio transfer dies after stops.json is staged: partial, staging
    // keeps the verified file. The queued B resumes from it.
    const stagedStops = signalOnRename(deps, `${stagingLayerPath(KEY)}/stops.json`);
    const realFetch = deps.fetch;
    let audioFailed = false;
    deps.fetch = async (rel) => {
      if (rel === 'audio/story-1.m4a' && !audioFailed) {
        audioFailed = true;
        throw new Error('connection lost');
      }
      return realFetch(rel);
    };
    const first = activate({ ...KEY, lock }, deps);
    await stagedStops;
    const second = activate({ ...KEY, lock }, deps);

    const a = await first;
    assert.equal(a.status, 'partial');
    assert.deepEqual((a as Extract<typeof a, { status: 'partial' }>).missing, ['audio/story-1.m4a']);
    const b = await second;
    assert.equal(b.status, 'complete');
    // Exactly the failed file was re-fetched (the rejected attempt never
    // reached the counting port); the verified stop was never re-fetched.
    assert.deepEqual(fetchLog, ['stops.json', 'audio/story-1.m4a']);
    await assertPublishPoint(root, driver, KEY, GOOD);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G20.09 cancel_delete_overlap: a restart check mid-overlap derives readiness from the disk alone', async () => {
  const root = tmpRoot();
  try {
    const { driver, deps, parking, first } = await overlapRig(root);
    // The restart reads the disk while the activation is parked: nothing is
    // final yet, and staging never counts — the honest answer is not-ready.
    const mid = await recoverOnOpen({ ...KEY, lock: await lockFrom(GOOD) }, { store: deps.store, sha256: nodeSha256, driver });
    assert.equal(mid.status, 'not-ready');
    parking.release();

    const a = await first;
    assert.equal(a.status, 'complete');
    const after = await recoverOnOpen({ ...KEY, lock: await lockFrom(GOOD) }, { store: deps.store, sha256: nodeSha256, driver });
    assert.equal(after.status, 'ready');
    await assertPublishPoint(root, driver, KEY, GOOD);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G20.09 cancel_delete_overlap: a pinned version refuses deletion and the overlap finishes untouched', async () => {
  const root = tmpRoot();
  try {
    const gate = createDeletionGate();
    const { driver, deps, parking, first, second } = await overlapRig(root, gate);
    const sessionId = '11111111-1111-4111-8111-111111111111';
    startSession(driver, {
      sessionId,
      routeId: KEY.routeId,
      version: KEY.version,
      locale: KEY.locale,
      startedAt: 1_700_000_000_000,
    });
    const refusal = await deletePackage(
      { routeId: KEY.routeId, version: KEY.version },
      { store: deps.store, driver, gate },
    );
    assert.equal(refusal.status, 'refused');
    assert.equal((refusal as Extract<typeof refusal, { status: 'refused' }>).reason, 'pinned-by-unfinished-session');
    assert.deepEqual((refusal as Extract<typeof refusal, { status: 'refused' }>).sessionIds, [sessionId]);
    parking.release();

    // The protected walk content stays intact: the pinned session and the
    // full layer it walks with.
    const a = await first;
    const b = await second;
    assert.equal(a.status, 'complete');
    assert.equal(b.status, 'complete');
    assert.notEqual(getSession(driver, sessionId), null);
    await assertPublishPoint(root, driver, KEY, GOOD);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G20.09 unrelated_keys_independent: a parked download of one package never blocks another package', async () => {
  const root = tmpRoot();
  try {
    const keyA: LayerKey = { routeId: 'route-a', version: '1', locale: 'be', tier: 'base' };
    const keyB: LayerKey = { routeId: 'route-b', version: '1', locale: 'be', tier: 'base' };
    const rigA = depsFor(root, { sources: { 'stops.json': STOPS } });
    const rigB = depsFor(root, { sources: { 'stops.json': STOPS } });
    const lockA = await lockFrom({ 'stops.json': STOPS });
    const lockB = await lockFrom({ 'stops.json': STOPS });

    // A parks before its first write; B must still run to completion while A
    // is parked — the lanes are per package, not one global queue (the
    // timeout guard fails the test if a cross-package queue ever appears).
    const parkingA = parkingFetch(rigA.deps, 'stops.json');
    const first = activate({ ...keyA, lock: lockA }, rigA.deps);
    const second = activate({ ...keyB, lock: lockB }, rigB.deps);
    try {
      const b = await raceWithTimeout(second);
      assert.equal(b.status, 'complete');
      parkingA.release();
      const a = await first;
      assert.equal(a.status, 'complete');
      await assertPublishPoint(root, rigA.deps.driver, keyA, { 'stops.json': STOPS });
      await assertPublishPoint(root, rigB.deps.driver, keyB, { 'stops.json': STOPS });
    } finally {
      parkingA.release();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
