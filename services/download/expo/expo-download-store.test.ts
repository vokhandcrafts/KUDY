// G20.31 (#793) — the device adapter's exists() classification and the
// reactivation of a damaged layer over a filesystem stand-in with the
// installed Expo 19.0.24 semantics (File.exists is isFile; Directory.move
// into an existing directory nests inside it). Criteria:
// 1. exists answers for existing files and directories, false for absent and
//    unsafe paths, with the same containment boundary;
// 2. a complete first activation followed by corruption and reactivation
//    restores the bytes at the original final path, creates no nested layer
//    and returns complete only for a valid final layer (the repeat takes the
//    zero-fetch level-2 fast path);
// 3. the stand-in preserves those native semantics — reverting the fixture
//    to Node rename semantics or the adapter to file-only exists fails this
//    suite (implementation-rules 1);
// 4. the suite rides the existing services/**/*.test.ts npm-test glob; no
//    shared E2E runner changes.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createExpoDownloadStore } from './expo-download-store.ts';
import { createAccessPort } from '../access.ts';
import { activate } from '../download.ts';
import { nodeSha256 } from '../nodeDownloadStore.ts';
import { GOOD, lockFrom, openFresh, utf8 } from '../test-fixture.ts';
import type { ActivateDeps, LayerKey } from '../types.ts';
import { makeFakeFs, makeFakeFsModule } from '../../contentRepo/expo/fs-test-fixture.ts';

const KEY: LayerKey = { routeId: 'r', version: '1', locale: 'be', tier: 'base' };

// The expo adapter over the in-memory stand-in and the activation rig around
// it: the production store and activate() run together, the way the device
// composition wires them.
function expoRig(): { fs: ReturnType<typeof makeFakeFs>; deps: ActivateDeps } {
  const fs = makeFakeFs();
  const { File, Directory } = makeFakeFsModule(fs);
  const root = new Directory('/root') as never;
  const store = createExpoDownloadStore(
    { File: File as never, Directory: Directory as never, freeBytes: () => 1_000_000 },
    root,
  );
  const deps: ActivateDeps = {
    store,
    fetch: async (rel) => {
      const bytes = GOOD[rel];
      if (bytes === undefined) throw new Error(`no source bytes for ${rel}`);
      return bytes;
    },
    sha256: nodeSha256,
    driver: openFresh(),
    access: createAccessPort(),
  };
  return { fs, deps };
}

test('criterion 1: exists answers for files and directories, false for absent and unsafe paths', async () => {
  const fs = makeFakeFs();
  const { File, Directory } = makeFakeFsModule(fs);
  const store = createExpoDownloadStore(
    { File: File as never, Directory: Directory as never, freeBytes: () => null },
    new Directory('/root') as never,
  );
  fs.dirs.add('/root/dir');
  fs.dirs.add('/root/dir/nested');
  fs.files.set('/root/dir/nested/stops.json', utf8('{"stops":[]}'));

  assert.equal(await store.exists('dir'), true);
  assert.equal(await store.exists('dir/nested'), true);
  assert.equal(await store.exists('dir/nested/stops.json'), true);
  assert.equal(await store.exists('dir/absent.json'), false);
  assert.equal(await store.exists('absent'), false);
  // Same containment boundary as the other methods (G20.20 refusals).
  assert.equal(await store.exists('../escape'), false);
  assert.equal(await store.exists('..%2fescape'), false);
});

test('criterion 3: the stand-in keeps Expo semantics — File.exists is isFile, Directory.move nests', () => {
  const fs = makeFakeFs();
  const { File, Directory } = makeFakeFsModule(fs);
  fs.files.set('/root/a/x/stops.json', utf8('x-bytes'));
  fs.dirs.add('/root/a');
  fs.dirs.add('/root/a/x');
  fs.dirs.add('/root/b');

  assert.equal(new File('/root/a/x').exists, false, 'a directory reads false through File.exists');
  assert.equal(new Directory('/root/a/x').exists, true);

  // A move into an existing destination directory nests inside it (unix
  // `mv a b` → `b/a`), never a replace-style rename of Node.
  new Directory('/root/a/x').move(new Directory('/root/b'));
  assert.equal(new File('/root/a/x/stops.json').exists, false);
  assert.deepEqual([...fs.files.get('/root/b/x/stops.json')!], [...utf8('x-bytes')]);
  assert.equal(new Directory('/root/b/x').exists, true);

  // An absent destination is the whole rename the activation tail relies on.
  new Directory('/root/b/x').move(new Directory('/root/b/y'));
  assert.deepEqual([...fs.files.get('/root/b/y/stops.json')!], [...utf8('x-bytes')]);
  assert.equal(new Directory('/root/b/x').exists, false);

  // Neither does it merge into an existing nested target: the native move
  // runs without REPLACE_EXISTING and refuses (`c/y` already there).
  fs.dirs.add('/root/c');
  fs.dirs.add('/root/c/y');
  fs.files.set('/root/c/y/stale.json', utf8('stale'));
  assert.throws(() => new Directory('/root/b/y').move(new Directory('/root/c')), /exists/);
  assert.deepEqual([...fs.files.get('/root/b/y/stops.json')!], [...utf8('x-bytes')], 'a refused move leaves the source in place');
  assert.deepEqual([...fs.files.get('/root/c/y/stale.json')!], [...utf8('stale')], 'the existing target keeps its bytes');
});

test('criterion 2: reactivating a corrupted layer replaces it at the final path, never nests', async () => {
  const { fs, deps } = expoRig();
  const lock = await lockFrom(GOOD);
  const input = { ...KEY, lock };

  const first = await activate(input, deps);
  assert.equal(first.status, 'complete');
  const finalAbs = `/root/bundles/r/1/be/base`;
  assert.deepEqual([...fs.files.get(`${finalAbs}/stops.json`)!], [...GOOD['stops.json']]);

  // The damage the audit reproduced: the final stops.json is overwritten.
  fs.files.set(`${finalAbs}/stops.json`, utf8('x'));

  const resumed = await activate(input, deps);
  assert.equal(resumed.status, 'complete');
  // The expected bytes are back at the original final path...
  assert.deepEqual([...fs.files.get(`${finalAbs}/stops.json`)!], [...GOOD['stops.json']]);
  assert.deepEqual([...fs.files.get(`${finalAbs}/audio/story-1.m4a`)!], [...GOOD['audio/story-1.m4a']]);
  // ...no new layer nested inside the damaged directory...
  const under = [...fs.files.keys()].filter((path) => path.startsWith(`${finalAbs}/`)).sort();
  assert.deepEqual(under, [`${finalAbs}/audio/story-1.m4a`, `${finalAbs}/stops.json`]);
  // ...and the replacement trash is gone.
  assert.equal(fs.dirs.has('/root/bundles/r/staging/1/be/base.old'), false);

  // Complete means a valid final layer: the repeated request takes the
  // level-2 fast path with zero fetches.
  const repeat = await activate(input, deps);
  assert.equal(repeat.status, 'complete');
  assert.equal(repeat.status === 'complete' ? repeat.fetched : -1, 0);
});
