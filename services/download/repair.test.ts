// G04.04.c — acceptance suite for the re-download request (issue #195) and
// its composition with the restart presence check.
// Criteria:
// 3. missing files lead to a re-download request through services/download
//    for exactly those paths — the fetch port sees nothing else, and a
//    repaired layer verifies again on a fresh presence check;
// 4. a pinned version with missing files is never filled with files of
//    another version — the request carries the pinned key, the fetch port is
//    bound to that grant's sources, and a newer version on disk stays
//    byte-identical.
// Failure paths (fetch rejects, size/hash mismatch, lack of space, a request
// naming a path outside the lock) each stop the run: verified files are kept,
// nothing unverified is ever written, and no AccessReady is emitted — the
// activation commit stays the single emission site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { repairLayer } from './repair.ts';
import { createDeletionGate } from './delete.ts';
import { checkPresence } from '../contentRepo/presence.ts';
import { createNodeBundlesStore } from '../contentRepo/nodeBundlesStore.ts';
import { writeFlatLayer } from '../contentRepo/test-fixture.ts';
import { depsFor, snapshotDir } from './test-fixture.ts';
import { getBundleAssets } from '../db/db.ts';
import { nodeSha256 } from './nodeDownloadStore.ts';
import type { ActivateDeps, LayerKey } from './types.ts';
import type { PresenceVerdict } from '../contentRepo/types.ts';

const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const LAYER = 'bundles/route-x/1/be/base';
const STOPS = '{"stories":[]}';
const AUDIO = 'audio-bytes-0123456789abcdef';
const utf8 = (text: string) => new TextEncoder().encode(text);

// The layer as the grant source serves it: a JSON file at the root and audio
// in a subdirectory — both shapes a real lock carries.
const SOURCES: Record<string, Uint8Array> = {
  'stops.json': utf8(STOPS),
  'audio/story-1.m4a': utf8(AUDIO),
};

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g0404c-repair-'));
}

// A previously activated layer on disk: real files plus their generated
// lock.json, with the requested damage applied afterwards.
function installedLayer(root: string, files: Record<string, string>): unknown {
  writeFlatLayer(root, LAYER, files);
  return JSON.parse(fs.readFileSync(path.join(root, LAYER, 'lock.json'), 'utf8'));
}

// The common arrange of the damage tests: install the intact layer, apply the
// damage, build the rig with the grant-bound sources. tmpRoot comes back for
// the caller's try/finally.
function damagedLayer(remove: (layerDir: string) => void): {
  root: string;
  lock: unknown;
  deps: ActivateDeps;
  fetchLog: string[];
} {
  const root = tmpRoot();
  const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
  remove(path.join(root, LAYER));
  const { deps, fetchLog } = depsFor(root, { sources: SOURCES });
  return { root, lock, deps, fetchLog };
}

// The composition under test (criterion 3): a metadata presence check names
// the recovery list, the repair fetches exactly it, a fresh presence check
// verifies the layer again.
async function checkRepairCheck(
  root: string,
  lock: unknown,
  deps: ActivateDeps,
  requested?: readonly string[],
): Promise<{ missing: string[]; result: Awaited<ReturnType<typeof repairLayer>>; verified: PresenceVerdict }> {
  const digest = async (bytes: Uint8Array) => nodeSha256(bytes);
  const damaged = await checkPresence(createNodeBundlesStore(root), {
    layers: [KEY],
    trigger: 'restart',
    sha256: digest,
  });
  assert.equal(damaged[0].status, 'needs-recovery');
  const missing = (damaged[0] as Extract<PresenceVerdict, { status: 'needs-recovery' }>).missing;
  const result = await repairLayer({ ...KEY, lock }, deps, requested ?? missing);
  const [verified] = await checkPresence(createNodeBundlesStore(root), {
    layers: [KEY],
    trigger: 'restart',
    sha256: digest,
  });
  return { missing, result, verified };
}

// The orphaned-subdirectory scenario of 09 §7: the whole audio/ subtree is
// gone from the final layer — the rename target's parent must be created,
// not turned into an ENOENT throw.
test('criterion 3: a repair restores a whole orphaned subdirectory of the final layer', async () => {
  const { root, lock, deps, fetchLog } = damagedLayer((dir) =>
    fs.rmSync(path.join(dir, 'audio'), { recursive: true, force: true }));
  try {
    const { missing, result, verified } = await checkRepairCheck(root, lock, deps);
    assert.deepEqual(missing, ['audio/story-1.m4a']);
    assert.deepEqual(result, { status: 'repaired', key: KEY, repaired: missing });
    assert.equal(verified.status, 'verified');
    assert.deepEqual(fetchLog, ['audio/story-1.m4a']);
    assert.equal(fs.readFileSync(path.join(root, LAYER, 'audio/story-1.m4a'), 'utf8'), AUDIO);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The shared deletion gate (G04.04.b): a package marked deleted while the
// repair is in flight stops named — writing files or zone-A rows would
// resurrect it. (A repair that STARTS after the delete takes the new epoch
// and runs like a fresh download — the same rule activate() follows.)
test('criterion 3: a package deleted mid-repair stops the repair as cancelled, writing nothing', async () => {
  const { root, lock, deps, fetchLog } = damagedLayer((dir) => fs.rmSync(path.join(dir, 'audio/story-1.m4a')));
  try {
    const gate = createDeletionGate();
    deps.cancel = gate;
    const realFetch = deps.fetch;
    deps.fetch = async (rel) => {
      gate.markCancelled({ routeId: KEY.routeId, version: KEY.version });
      return realFetch(rel);
    };

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.deepEqual(result, { status: 'cancelled', key: KEY, repaired: [] });
    assert.deepEqual(fetchLog, ['audio/story-1.m4a'], 'the fetch raced the delete; the write did not happen');
    assert.equal(fs.existsSync(path.join(root, LAYER, 'audio/story-1.m4a')), false);
    // The staging layer the pre-loop ensureDir created holds no leftovers —
    // a cancelled repair writes nothing and leaves no .part to mistake for
    // progress (the empty directory chain itself stays, as in activate()).
    assert.deepEqual(fs.readdirSync(path.join(root, 'bundles/route-x/staging/1/be/base')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: the presence verdict drives a repair that fetches exactly the missing paths', async () => {
  const { root, lock, deps, fetchLog } = damagedLayer((dir) => fs.rmSync(path.join(dir, 'audio/story-1.m4a')));
  try {
    const { missing, result, verified } = await checkRepairCheck(root, lock, deps);
    assert.deepEqual(missing, ['audio/story-1.m4a']);
    assert.deepEqual(result, { status: 'repaired', key: KEY, repaired: missing });
    assert.deepEqual(fetchLog, ['audio/story-1.m4a'], 'only the missing path crosses the wire');
    assert.equal(verified.status, 'verified');

    // The registry reflects the restored file (zone A, derived from disk).
    const rows = getBundleAssets(deps.driver, KEY);
    const row = rows.find((entry) => entry.path === 'audio/story-1.m4a');
    assert.equal(row?.status, 'complete');
    assert.equal(row?.bytesDone, AUDIO.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a repair touches nothing beyond the requested files', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    const before = snapshotDir(root, 'bundles');
    const { deps, fetchLog } = depsFor(root, { sources: SOURCES });

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.equal(result.status, 'repaired');

    const after = snapshotDir(root, 'bundles');
    for (const [rel, hex] of before) {
      assert.equal(after.get(rel), hex, `${rel} must stay byte-identical`);
    }
    assert.equal(after.get(`${LAYER}/audio/story-1.m4a`), Buffer.from(AUDIO).toString('hex'));
    assert.deepEqual(fetchLog, ['audio/story-1.m4a']);
    // The repair's staging layer is gone (same scope activate() cleans — the
    // empty staging parent chain stays, the inventory skips it as not-a-version).
    assert.equal(fs.existsSync(path.join(root, 'bundles/route-x/staging/1/be/base')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: a pinned damaged version is repaired from its own lock, never from a newer one', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    // A newer version of the same route beside it — complete, and with a
    // file the pinned version's lock does not even declare.
    const newer = 'bundles/route-x/2/be/base';
    writeFlatLayer(root, newer, {
      'stops.json': STOPS,
      'audio/story-1.m4a': AUDIO,
      'audio/extra.m4a': 'newer-version-only',
    });
    const newerBefore = snapshotDir(root, 'bundles/route-x/2');
    const { deps, fetchLog } = depsFor(root, { sources: SOURCES });

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.equal(result.status, 'repaired');
    assert.deepEqual(fetchLog, ['audio/story-1.m4a'], 'the newer version is never a fetch source');
    assert.equal(
      fs.readFileSync(path.join(root, LAYER, 'audio/story-1.m4a'), 'utf8'),
      AUDIO,
      'the pinned version is filled with its own bytes',
    );
    assert.deepEqual(snapshotDir(root, 'bundles/route-x/2'), newerBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a request naming a path outside the lock is rejected before any fetch', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    const { deps, fetchLog } = depsFor(root, { sources: SOURCES });

    const foreign = await repairLayer({ ...KEY, lock }, deps, ['audio/other-version.m4a']);
    assert.equal(foreign.status, 'invalid-input');
    assert.ok(
      (foreign as Extract<typeof foreign, { status: 'invalid-input' }>).diagnostics.includes(
        'repair#not-in-lock:audio/other-version.m4a',
      ),
    );

    const empty = await repairLayer({ ...KEY, lock }, deps, []);
    assert.equal(empty.status, 'invalid-input');
    assert.ok(
      (empty as Extract<typeof empty, { status: 'invalid-input' }>).diagnostics.includes(
        'repair#empty-request',
      ),
    );
    assert.deepEqual(fetchLog, [], 'a rejected request fetches nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a corrupt lock input stays invalid-input with diagnostics, never a throw', async () => {
  const root = tmpRoot();
  try {
    const { deps } = depsFor(root, { sources: SOURCES });
    const result = await repairLayer({ ...KEY, lock: [null] }, deps, ['stops.json']);
    assert.equal(result.status, 'invalid-input');
    assert.deepEqual(
      (result as Extract<typeof result, { status: 'invalid-input' }>).diagnostics,
      ['lock.json[0]#type'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a truncated transfer yields hash-mismatch and writes nothing', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    const short: Record<string, Uint8Array> = {
      'stops.json': SOURCES['stops.json'],
      'audio/story-1.m4a': utf8('trunc'),
    };
    const { deps } = depsFor(root, { sources: short });

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.equal(result.status, 'hash-mismatch');
    const mismatch = result as Extract<typeof result, { status: 'hash-mismatch' }>;
    assert.deepEqual(mismatch.paths, ['audio/story-1.m4a']);
    assert.deepEqual(mismatch.missing, ['audio/story-1.m4a']);
    assert.deepEqual(mismatch.diagnostics, ['audio/story-1.m4a#size-mismatch']);
    assert.equal(fs.existsSync(path.join(root, LAYER, 'audio/story-1.m4a')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a same-size wrong-bytes transfer fails the sha256 check, the old file survives', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    // Present but corrupt (a flipped byte) — the size check alone passes it.
    const tampered = Buffer.from(AUDIO);
    tampered[3] ^= 0xff;
    fs.writeFileSync(path.join(root, LAYER, 'audio/story-1.m4a'), tampered);
    const wrong: Record<string, Uint8Array> = {
      'stops.json': SOURCES['stops.json'],
      'audio/story-1.m4a': utf8('audio-bytes-0123456789abcdeg'),
    };
    const { deps } = depsFor(root, { sources: wrong });

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.equal(result.status, 'hash-mismatch');
    const mismatch = result as Extract<typeof result, { status: 'hash-mismatch' }>;
    assert.deepEqual(mismatch.diagnostics, ['audio/story-1.m4a#sha256-mismatch']);
    assert.equal(
      fs.readFileSync(path.join(root, LAYER, 'audio/story-1.m4a')).toString('hex'),
      tampered.toString('hex'),
      'a failed repair never overwrites the old file',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: an interrupted transfer yields partial with the failure surfaced', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'stops.json'));
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    const { deps } = depsFor(root, { sources: SOURCES });
    const realFetch = deps.fetch;
    deps.fetch = async (rel) => {
      if (rel === 'stops.json') throw new Error('connection lost');
      return realFetch(rel);
    };

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a', 'stops.json']);
    assert.equal(result.status, 'partial');
    const partial = result as Extract<typeof result, { status: 'partial' }>;
    // Lock order (audio first), not request order: the audio repairs fine,
    // then the transfer dies on stops.json.
    assert.deepEqual(partial.repaired, ['audio/story-1.m4a']);
    assert.deepEqual(partial.missing, ['stops.json']);
    assert.deepEqual(partial.diagnostics, ['stops.json#fetch-failed', 'connection lost']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: lack of space yields insufficient-space and fetches nothing', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    const { deps, fetchLog } = depsFor(root, { sources: SOURCES, freeBytes: 1 });

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.deepEqual(result, {
      status: 'insufficient-space',
      key: KEY,
      needed: AUDIO.length,
      free: 1,
    });
    assert.deepEqual(fetchLog, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 3: a successful repair emits no AccessReady — activation stays the single site', async () => {
  const root = tmpRoot();
  try {
    const lock = installedLayer(root, { 'stops.json': STOPS, 'audio/story-1.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-1.m4a'));
    const { deps } = depsFor(root, { sources: SOURCES });
    const emitted: string[] = [];
    deps.access.onAccessReady((event) => emitted.push(event.type));

    const result = await repairLayer({ ...KEY, lock }, deps, ['audio/story-1.m4a']);
    assert.equal(result.status, 'repaired');
    assert.deepEqual(emitted, [], 'repair restores an already-committed layer, it grants nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
