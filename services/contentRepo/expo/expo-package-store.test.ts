// G20.20 — behavioral tests of the device stores over the fake
// File/Directory classes (fs-test-fixture.ts): the confinement refusals (a
// segment outside the root reads absent/null, never resolves), the
// round-trips the download pipeline needs, and the probe's metadata-only
// answer (implementation-rules 1: reverting the segment validation fails
// reject_unsafe).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createExpoDownloadStore } from '../../download/expo/expo-download-store.ts';
import {
  createExpoBundlesStore,
  createExpoPackageStore,
  createExpoTeaserAudioProbe,
} from './expo-package-store.ts';
import { makeFakeFs, makeFakeFsModule } from './fs-test-fixture.ts';

const fs = makeFakeFs();
const { File, Directory } = makeFakeFsModule(fs);
const root = new Directory('/root') as never;
const classes = { File: File as never, Directory: Directory as never };
const encoder = new TextEncoder();

test('package store reads and confines', async () => {
  fs.files.set('/root/a/route.json', encoder.encode('{"stops":[]}'));
  const store = createExpoPackageStore(classes, root, { routeId: 'r', version: '1' });
  const facts = await store.readFile('a/route.json');
  assert.equal(facts.kind, 'present');
  assert.deepEqual(facts.kind === 'present' ? [...facts.bytes] : [], [...encoder.encode('{"stops":[]}')]);
  assert.equal((await store.readFile('a/absent.json')).kind, 'absent');
  assert.equal(await store.exists('a/route.json'), true);
  // The confinement refusal: a traversal segment never resolves.
  assert.equal((await store.readFile('../escape.json')).kind, 'absent');
  assert.equal(await store.exists('..%2fescape'), false);
});

test('bundles store lists, sizes and refuses unsafe rels', async () => {
  fs.files.set('/root/b/1/be/base/lock.json', encoder.encode('[]'));
  fs.dirs.add('/root/b/1/be');
  fs.dirs.add('/root/b/1/be/base');
  const store = createExpoBundlesStore(classes, root);
  assert.deepEqual(await store.listDir('b/1/be'), ['base']);
  assert.equal(await store.listDir('b/1/absent'), null);
  assert.equal(await store.statSize('b/1/be/base/lock.json'), 2);
  assert.equal(await store.statSize('../x'), null);
  assert.equal(await store.listDir(''), null);
  const probe = createExpoTeaserAudioProbe(classes, root);
  assert.equal(await probe('b/1/be/base/lock.json'), true);
  fs.files.set('/root/b/1/be/base/empty.mp3', new Uint8Array(0));
  assert.equal(await probe('b/1/be/base/empty.mp3'), false);
  assert.equal(await probe('../b/1/be/base/lock.json'), false);
});

test('download store round-trip: ensure, write, rename, remove, freeBytes', async () => {
  const store = createExpoDownloadStore(
    { File: File as never, Directory: Directory as never, freeBytes: () => 1_000_000 },
    root,
  );
  await store.ensureDir('bundles/r/1/be/base.staging/x');
  const bytes = encoder.encode('audio-bytes');
  await store.writeFile('bundles/r/1/be/base.staging/x/a.mp3', bytes);
  assert.equal(await store.exists('bundles/r/1/be/base.staging/x/a.mp3'), true);
  await store.rename('bundles/r/1/be/base.staging/x/a.mp3', 'bundles/r/1/be/base/audio/a.mp3');
  assert.equal(await store.exists('bundles/r/1/be/base.staging/x/a.mp3'), false);
  assert.deepEqual([...(await store.readFile('bundles/r/1/be/base/audio/a.mp3'))!], [...bytes]);
  assert.equal(await store.statSize('bundles/r/1/be/base/audio/a.mp3'), bytes.byteLength);
  assert.equal(await store.freeBytes(), 1_000_000);
  await store.remove('bundles/r/1/be/base.staging');
  assert.equal(await store.exists('bundles/r/1/be/base.staging/x/a.mp3'), false);
  // Idempotent remove: an absent target is already the desired state.
  await store.remove('bundles/r/1/be/base.staging');
  await store.remove('bundles/r/1/be/base/audio/a.mp3');
  assert.equal(await store.readFile('../x'), null);
  await assert.rejects(() => store.writeFile('../x', bytes), /unsafe-path/);
});
