// G07.02 (issue #282) — the moment facts reader suite: the manifest parse,
// the teaser audio path resolution and the damage diagnostics (rule 14 — one
// negative per rule, none thrown) over a fake BundlesStore. G22.02 (issue
// #607) extends the reader with the required teaser-audio probe: every call
// here supplies a fake probe over the same files map (true is exactly a
// present, nonempty audio file); directory/permission semantics are the real
// adapter's — nodeBundlesStore.test.ts runs those on the actual filesystem.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readMomentFacts } from './momentFacts.ts';
import type { BundlesStore, FileFacts, TeaserAudioProbe } from './types.ts';

class FakeStore implements BundlesStore {
  private readonly dirs: Map<string, string[]>;
  private readonly files: Map<string, FileFacts>;
  private readonly failList: boolean;
  constructor(
    dirs: Map<string, string[]>,
    files: Map<string, FileFacts>,
    failList = false,
  ) {
    this.dirs = dirs;
    this.files = files;
    this.failList = failList;
  }
  listDir(rel: string): Promise<string[] | null> {
    if (this.failList) return Promise.reject(new Error('store gone'));
    return Promise.resolve(this.dirs.get(rel) ?? null);
  }
  readFile(rel: string): Promise<FileFacts> {
    return Promise.resolve(this.files.get(rel) ?? { kind: 'absent' });
  }
  statSize(): Promise<number | null> {
    return Promise.resolve(null);
  }
}

// The fake teaser-audio probe over the same files map (G22.02): true is
// exactly a present, nonempty audio file — directory/permission semantics
// are the real adapter's (nodeBundlesStore.test.ts), the fake cannot
// represent them.
const probeFor = (files: Map<string, FileFacts>): TeaserAudioProbe => async (rel: string) => {
  const file = files.get(rel);
  return file?.kind === 'present' && file.bytes.length > 0;
};

const bytes = (text: string): FileFacts => ({ kind: 'present', bytes: new TextEncoder().encode(text) });
const moment = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify([{ id: 'm-1', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 60, ...overrides }]);

const demoDirs = (): Map<string, string[]> =>
  new Map<string, string[]>([
    ['bundles', ['route-a', 'staging']],
    ['bundles/route-a', ['1', 'staging']],
  ]);
const demoFiles = (): Map<string, FileFacts> =>
  new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment())],
    ['bundles/route-a/1/be/base/stops.json', bytes(JSON.stringify([{ story_id: 's-1', text: 'Тэйзер-тэкст' }]))],
    ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('audio')],
  ]);
function demoStore(): BundlesStore {
  return new FakeStore(demoDirs(), demoFiles());
}

test('the manifest of a downloaded package resolves the teaser facts and the base audio path', async () => {
  const result = await readMomentFacts(demoStore(), { locales: ['be', 'en'], audioProbe: probeFor(demoFiles()) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.moments, [
    {
      momentId: 'm-1',
      placeId: 'place-1',
      storyId: 's-1',
      kind: 'teaser',
      cooldownMin: 60,
      routeId: 'route-a',
      version: '1',
      audioPath: 'bundles/route-a/1/be/base/audio/s-1.m4a',
      teaserText: 'Тэйзер-тэкст',
    },
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test('the staging tree is never a package and a staging entry is never a version (the inventory skip)', async () => {
  const result = await readMomentFacts(demoStore(), { locales: ['be', 'en'], audioProbe: probeFor(demoFiles()) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.moments.length, 1);
  assert.ok(result.moments.every((moment) => moment.routeId !== 'staging' && moment.version !== 'staging'));
});

test('the first preferred locale without the audio file falls to the next, then to null', async () => {
  const enDirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const enFiles = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment())],
    ['bundles/route-a/1/en/base/audio/s-1.m4a', bytes('audio')],
  ]);
  const enOnly = new FakeStore(enDirs, enFiles);
  const fell = await readMomentFacts(enOnly, { locales: ['be', 'en'], audioProbe: probeFor(enFiles) });
  assert.ok(fell.ok);
  if (!fell.ok) return;
  assert.equal(fell.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-1.m4a');

  const silentDirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const silentFiles = new Map<string, FileFacts>([['bundles/route-a/1/moments.json', bytes(moment())]]);
  const silent = new FakeStore(silentDirs, silentFiles);
  const none = await readMomentFacts(silent, { locales: ['be', 'en'], audioProbe: probeFor(silentFiles) });
  assert.ok(none.ok);
  if (!none.ok) return;
  assert.equal(none.moments[0]?.audioPath, null);
  assert.equal(none.moments[0]?.teaserText, null);
});

test('a corrupt manifest is a named diagnostic; the other packages still read (rule 14)', async () => {
  const manifestDirs = new Map<string, string[]>([
    ['bundles', ['route-a', 'route-b']],
    ['bundles/route-a', ['1']],
    ['bundles/route-b', ['1']],
  ]);
  const manifestFiles = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes('{not json')],
    ['bundles/route-b/1/moments.json', bytes(moment({ id: 'm-2' }))],
    ['bundles/route-b/1/be/base/audio/s-1.m4a', bytes('audio')],
  ]);
  const manifestStore = new FakeStore(manifestDirs, manifestFiles);
  const result = await readMomentFacts(manifestStore, { locales: ['be'], audioProbe: probeFor(manifestFiles) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.diagnostics, ['moment-facts#manifest-invalid:bundles/route-a/1']);
  assert.deepEqual(result.moments.map((moment) => moment.momentId), ['m-2']);
});

test('an entry missing cooldown_min is isolated and skipped with its own diagnostic', async () => {
  const entryDirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const entryFiles = new Map<string, FileFacts>([
    [
      'bundles/route-a/1/moments.json',
      bytes(
        JSON.stringify([
          { id: 'm-bad', place_id: 'place-1', story_id: 's-1' },
          { id: 'm-ok', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 5 },
        ]),
      ),
    ],
  ]);
  const entryStore = new FakeStore(entryDirs, entryFiles);
  const result = await readMomentFacts(entryStore, { locales: ['be'], audioProbe: probeFor(entryFiles) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.diagnostics, ['moment-facts#entry-invalid:bundles/route-a/1']);
  assert.deepEqual(result.moments.map((moment) => moment.momentId), ['m-ok']);
});

test('an unsafe story_id from the manifest yields a null path with its own diagnostic, never a path (09 §7)', async () => {
  const unsafeDirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const unsafeFiles = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment({ story_id: '../escape' }))],
    ['bundles/route-a/1/be/base/audio/..%2Fescape.m4a', bytes('audio')],
  ]);
  const unsafeStore = new FakeStore(unsafeDirs, unsafeFiles);
  const result = await readMomentFacts(unsafeStore, { locales: ['be'], audioProbe: probeFor(unsafeFiles) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.moments[0]?.audioPath, null);
  assert.deepEqual(result.diagnostics, ['moment-facts#unsafe-story-id:bundles/route-a/1']);
});

test('a damaged stops.json never blocks the teaser — the honest null text, no manifest diagnostics (rule 14)', async () => {
  const stopsDirs = new Map<string, string[]>([
    ['bundles', ['route-a', 'route-b']],
    ['bundles/route-a', ['1']],
    ['bundles/route-b', ['1']],
  ]);
  const stopsFiles = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment())],
    // Broken JSON: the parse-throw branch of the teaser-text read.
    ['bundles/route-a/1/be/base/stops.json', bytes('{broken')],
    ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('audio')],
    ['bundles/route-b/1/moments.json', bytes(moment({ id: 'm-2' }))],
    // Valid JSON that is not an array: the shape branch of the same read.
    ['bundles/route-b/1/be/base/stops.json', bytes('{"story_id": "s-1"}')],
    ['bundles/route-b/1/be/base/audio/s-1.m4a', bytes('audio')],
  ]);
  const stopsStore = new FakeStore(stopsDirs, stopsFiles);
  const result = await readMomentFacts(stopsStore, { locales: ['be'], audioProbe: probeFor(stopsFiles) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.moments.map((moment) => [moment.momentId, moment.teaserText, moment.audioPath !== null]), [
    ['m-1', null, true],
    ['m-2', null, true],
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test('an absent manifest is the honest empty; a gone store is the named refusal', async () => {
  const empty = await readMomentFacts(new FakeStore(new Map(), new Map()), {
    locales: ['be'],
    audioProbe: probeFor(new Map<string, FileFacts>()),
  });
  assert.ok(empty.ok);
  if (!empty.ok) return;
  assert.deepEqual(empty.moments, []);
  assert.deepEqual(empty.diagnostics, []);

  const gone = await readMomentFacts(new FakeStore(new Map(), new Map(), true), {
    locales: ['be'],
    audioProbe: probeFor(new Map<string, FileFacts>()),
  });
  assert.ok(!gone.ok);
  if (gone.ok) return;
  assert.equal(gone.diagnostic, 'moment-facts#list-failed');
});

test('G22.02 (AC2): an empty teaser media is not a playable path — the fallback continues to the next locale', async () => {
  const files = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment())],
    ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('')],
    ['bundles/route-a/1/en/base/audio/s-1.m4a', bytes('audio')],
  ]);
  const store = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a']],
      ['bundles/route-a', ['1']],
    ]),
    files,
  );
  const result = await readMomentFacts(store, { locales: ['be', 'en'], audioProbe: probeFor(files) });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-1.m4a');
});

test('G22.02: a missing probe is the named configuration error — refused before any store call', async () => {
  // The failList store would answer moment-facts#list-failed if the guard
  // were missing: this diagnostic proves the reader refuses before listDir.
  const refused = await readMomentFacts(new FakeStore(new Map(), new Map(), true), {
    locales: ['be'],
    audioProbe: undefined as unknown as TeaserAudioProbe,
  });
  assert.ok(!refused.ok);
  if (refused.ok) return;
  assert.equal(refused.diagnostic, 'moment-facts#probe-missing');
});
