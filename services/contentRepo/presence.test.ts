// G04.04.c — acceptance suite for the restart presence check (issue #195).
// Criteria:
// 1. after a restart every ready layer gets the level-2 check of 09 §4 — JSON
//    entries parse, media entries get presence and size from lock.json; a
//    missing or short file moves the layer to needs-recovery, never to Play;
// 2. the full re-hash runs only on the three contract conditions; an ordinary
//    restart never hashes;
// 3. the recovery list names exactly the lock paths that are gone — the
//    repair request consumes it (services/download/repair.test.ts);
// 4. the check reads only the pinned layer's own lock and directory: another
//    version on disk never contributes paths or files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkPresence } from './presence.ts';
import { createNodeBundlesStore } from './nodeBundlesStore.ts';
import { sha256Hex, writeFlatLayer } from './test-fixture.ts';
import type { BundlesStore, LayerKey, PresenceVerdict, RecheckTrigger, Sha256 } from './types.ts';

const LAYER = 'bundles/route-x/1/be/base';
const KEY: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
const AUDIO = 'audio-bytes-0123456789abcdef';
const STOPS = '{"stories":[]}';

// A counting digest: the tests assert how often the full re-hash ran.
function spySha256(): { sha256: Sha256; calls: () => number } {
  let count = 0;
  return {
    sha256: async (bytes) => {
      count += 1;
      return sha256Hex(Buffer.from(bytes));
    },
    calls: () => count,
  };
}

// A read-counting wrapper: input validation must precede any filesystem call.
function countingStore(store: BundlesStore): { store: BundlesStore; calls: () => number } {
  let count = 0;
  const track = <T>(promise: Promise<T>): Promise<T> => {
    count += 1;
    return promise;
  };
  return {
    store: {
      listDir: (rel) => track(store.listDir(rel)),
      readFile: (rel) => track(store.readFile(rel)),
      statSize: (rel) => track(store.statSize(rel)),
    },
    calls: () => count,
  };
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g0404c-'));
}

// Installs the intact two-file layer, applies the optional damage to the
// layer directory, runs the metadata-level restart check and cleans up.
async function metadataCheck(
  damage?: (layerDir: string) => void,
): Promise<{ verdict: PresenceVerdict; hashes: () => number }> {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
    damage?.(path.join(root, LAYER));
    const digest = spySha256();
    const [verdict] = await checkPresence(createNodeBundlesStore(root), {
      layers: [KEY],
      trigger: 'restart',
      sha256: digest.sha256,
    });
    return { verdict, hashes: digest.calls };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function asRecovery(verdict: PresenceVerdict): Extract<PresenceVerdict, { status: 'needs-recovery' }> {
  assert.equal(verdict.status, 'needs-recovery');
  return verdict as Extract<PresenceVerdict, { status: 'needs-recovery' }>;
}

test('criterion 1+2: an intact ready layer verifies at the metadata level, an ordinary restart hashes nothing', async () => {
  const { verdict, hashes } = await metadataCheck();
  assert.deepEqual(verdict, { status: 'verified', layer: KEY, checked: 'metadata' });
  assert.equal(hashes(), 0, 'an ordinary restart must not hash a single byte');
});

test('criterion 1: a short media file moves the layer to needs-recovery, never to Play', async () => {
  // The orphaned/truncated file: present, non-empty, but short of the size
  // lock.json declares — the case the presence check exists for.
  const { verdict } = await metadataCheck((dir) => fs.writeFileSync(path.join(dir, 'audio/story-b.m4a'), 'trunc'));
  const recovery = asRecovery(verdict);
  assert.deepEqual(recovery.missing, ['audio/story-b.m4a']);
});

test('criterion 1: an absent media file is a recovery path with its lock name', async () => {
  const { verdict } = await metadataCheck((dir) => fs.rmSync(path.join(dir, 'audio/story-b.m4a')));
  const recovery = asRecovery(verdict);
  assert.deepEqual(recovery.missing, ['audio/story-b.m4a']);
});

test('criterion 1: a size-intact JSON that no longer parses is a recovery path too', async () => {
  // Same length as STOPS — the size check passes, the parse must still catch
  // the corruption (09 §4 level 2: JSON files are parsed).
  const { verdict } = await metadataCheck((dir) => fs.writeFileSync(path.join(dir, 'stops.json'), '{"stories":[]x'));
  const recovery = asRecovery(verdict);
  assert.deepEqual(recovery.missing, ['stops.json']);
  assert.ok(recovery.diagnostics.includes('stops.json#invalid-json'));
});

for (const trigger of ['app-version-changed', 'decode-error', 'user-requested'] as const) {
  test(`criterion 2: the ${trigger} trigger runs the full re-hash`, async () => {
    const root = tmpRoot();
    try {
      writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
      const digest = spySha256();
      const [verdict] = await checkPresence(createNodeBundlesStore(root), {
        layers: [KEY],
        trigger,
        sha256: digest.sha256,
      });
      assert.deepEqual(verdict, { status: 'verified', layer: KEY, checked: 'full' });
      assert.equal(digest.calls(), 2, 'every lock entry is hashed once');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('criterion 2: only the full re-hash sees a same-size corruption', async () => {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
    // Same length, one byte flipped — invisible to the size check.
    const tampered = Buffer.from(AUDIO);
    tampered[3] ^= 0xff;
    fs.writeFileSync(path.join(root, LAYER, 'audio/story-b.m4a'), tampered);
    const store = createNodeBundlesStore(root);
    const digest = spySha256();

    const [restart] = await checkPresence(store, { layers: [KEY], trigger: 'restart', sha256: digest.sha256 });
    assert.equal(restart.status, 'verified', 'the metadata level must stay cheap, not blind-report damage');

    const [full] = await checkPresence(store, { layers: [KEY], trigger: 'user-requested', sha256: digest.sha256 });
    const recovery = asRecovery(full);
    assert.deepEqual(recovery.checked, 'full');
    assert.deepEqual(recovery.missing, ['audio/story-b.m4a']);
    assert.ok(recovery.diagnostics.includes('audio/story-b.m4a#sha256-mismatch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a corrupt or empty lock leaves the layer needs-recovery with an unknowable file set', async () => {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS }, 'not-json');
    const store = createNodeBundlesStore(root);
    const [corrupt] = await checkPresence(store, { layers: [KEY], trigger: 'restart', sha256: spySha256().sha256 });
    assert.deepEqual(asRecovery(corrupt).missing, []);
    assert.deepEqual(asRecovery(corrupt).diagnostics, ['lock.json#invalid-json']);

    fs.rmSync(path.join(root, LAYER), { recursive: true, force: true });
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS }, []);
    const [empty] = await checkPresence(store, { layers: [KEY], trigger: 'restart', sha256: spySha256().sha256 });
    assert.ok(asRecovery(empty).diagnostics.includes('lock.json#empty'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: unsafe segments are rejected on input before any filesystem call', async () => {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
    const tracked = countingStore(createNodeBundlesStore(root));
    const [verdict] = await checkPresence(tracked.store, {
      layers: [{ ...KEY, routeId: '../evil' }],
      trigger: 'restart',
      sha256: spySha256().sha256,
    });
    assert.equal(verdict.status, 'invalid-input');
    assert.ok(
      (verdict as Extract<PresenceVerdict, { status: 'invalid-input' }>).diagnostics.some((entry) =>
        entry.startsWith('route_id#unsafe-path:'),
      ),
    );
    assert.equal(tracked.calls(), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 4: the check reads only the pinned layer — another version never contributes', async () => {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
    fs.rmSync(path.join(root, LAYER, 'audio/story-b.m4a'));
    // A newer version of the same route sits beside it, intact.
    writeFlatLayer(root, 'bundles/route-x/2/be/base', {
      'stops.json': STOPS,
      'audio/story-b.m4a': AUDIO,
    });
    const before = fs.readFileSync(path.join(root, 'bundles/route-x/2/be/base/audio/story-b.m4a')).toString('hex');

    const [verdict] = await checkPresence(createNodeBundlesStore(root), {
      layers: [KEY],
      trigger: 'restart',
      sha256: spySha256().sha256,
    });
    const recovery = asRecovery(verdict);
    // The recovery list comes from the pinned version's lock only.
    assert.deepEqual(recovery.missing, ['audio/story-b.m4a']);
    assert.equal(
      fs.readFileSync(path.join(root, 'bundles/route-x/2/be/base/audio/story-b.m4a')).toString('hex'),
      before,
      'the newer version files are never touched',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('criterion 1: a batch checks every ready layer and keeps the input order', async () => {
  const root = tmpRoot();
  try {
    writeFlatLayer(root, LAYER, { 'stops.json': STOPS, 'audio/story-b.m4a': AUDIO });
    fs.writeFileSync(path.join(root, LAYER, 'audio/story-b.m4a'), 'trunc');
    writeFlatLayer(root, 'bundles/route-x/1/be/extended', {
      'stops.json': STOPS,
      'audio/story-e.m4a': AUDIO,
    });
    const extended: LayerKey = { ...KEY, tier: 'extended' };
    const digest = spySha256();
    const verdicts = await checkPresence(createNodeBundlesStore(root), {
      layers: [extended, KEY],
      trigger: 'restart' satisfies RecheckTrigger,
      sha256: digest.sha256,
    });
    assert.deepEqual(
      verdicts.map((verdict) => [verdict.status, verdict.layer.tier]),
      [
        ['verified', 'extended'],
        ['needs-recovery', 'base'],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
