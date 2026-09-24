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

import { activate, layerPath, rebuildBundleAssets, stagingLayerPath } from './download.ts';
import { createNodeDownloadStore, nodeSha256 } from './nodeDownloadStore.ts';
import { lockFrom } from './test-fixture.ts';
import { getBundleAssets, getSession, openDatabase, startSession } from '../db/db.ts';
import { nodeSqliteDriver } from '../db/test-fixture.ts';
import type { SqlDriver } from '../db/types.ts';
import type { ActivateDeps, FetchPort, LayerKey } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };

const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// A two-file layer: a JSON file at the root and audio inside a subdirectory —
// both shapes the lock of a real layer carries (build-bundle README).
const STOPS = utf8('{"stops":[]}\n');
const AUDIO = utf8('audio-bytes-0123456789abcdef');
const GOOD: Record<string, Uint8Array> = {
  'stops.json': STOPS,
  'audio/story-1.m4a': AUDIO,
};

// Same length as AUDIO, one byte flipped — a corrupted transfer the size
// check cannot see but the hash must.
const AUDIO_TAMPERED = (() => {
  const bytes = Uint8Array.from(AUDIO);
  bytes[3] ^= 0xff;
  return bytes;
})();

const totalBytes = (sources: Record<string, Uint8Array>) =>
  Object.values(sources).reduce((sum, bytes) => sum + bytes.length, 0);

function openFresh(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

interface DepsOptions {
  driver?: SqlDriver;
  freeBytes?: number | null;
  sources?: Record<string, Uint8Array>;
}

// Test rig: node store over a fresh tmp root, a counting fetch port over the
// given sources (the port is bound to the layer identity by the caller, as
// G04.02.b will bind it to the grant), and a fresh in-memory store driver.
function depsFor(root: string, options: DepsOptions = {}): { deps: ActivateDeps; fetchLog: string[] } {
  const sources = options.sources ?? GOOD;
  const store = createNodeDownloadStore(root);
  if (options.freeBytes !== undefined) store.freeBytes = async () => options.freeBytes ?? null;
  const fetchLog: string[] = [];
  const fetch: FetchPort = async (rel) => {
    fetchLog.push(rel);
    const bytes = sources[rel];
    if (!bytes) throw new Error(`no source bytes for ${rel}`);
    return bytes;
  };
  return { fetchLog, deps: { store, fetch, sha256: nodeSha256, driver: options.driver ?? openFresh() } };
}

// Simulates process death at a chosen rename: the wrapped store throws
// instead of performing it (a real rename is atomic — it either happened or
// it did not, and the injected crash is the "did not" side).
function crashOnRename(
  store: ActivateDeps['store'],
  target: (from: string, to: string) => boolean,
): ActivateDeps['store'] {
  return {
    ...store,
    rename: async (fromRel: string, toRel: string) => {
      if (target(fromRel, toRel)) throw new Error('injected crash');
      return store.rename(fromRel, toRel);
    },
  };
}

// Recursively reads a directory into rel-path → hex-bytes entries, so
// byte-identity of a layer before and after an operation is assertable.
function snapshotDir(root: string, rel: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else out.set(child, fs.readFileSync(path.join(root, child)).toString('hex'));
    }
  };
  if (fs.existsSync(path.join(root, rel))) walk(rel);
  return out;
}

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
    const calls: string[] = [];
    const spy = new Proxy(deps.store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            calls.push(String(prop));
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        }
        return value;
      },
    }) as ActivateDeps['store'];
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
