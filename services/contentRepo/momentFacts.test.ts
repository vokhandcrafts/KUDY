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

// G22.05 (issue #610) — the measured-read harness: the meter wraps a fake
// store and records every readFile rel; the recording probe records every
// audio availability question. Media/text work is counted, never assumed.
class MeterStore implements BundlesStore {
  readonly reads: string[] = [];
  private readonly inner: FakeStore;
  constructor(inner: FakeStore) {
    this.inner = inner;
  }
  listDir(rel: string): Promise<string[] | null> {
    return this.inner.listDir(rel);
  }
  async readFile(rel: string): Promise<FileFacts> {
    this.reads.push(rel);
    return this.inner.readFile(rel);
  }
  statSize(): Promise<number | null> {
    return this.inner.statSize();
  }
}

const recordingProbe = (files: Map<string, FileFacts>, calls: string[]): TeaserAudioProbe => async (rel: string) => {
  calls.push(rel);
  const file = files.get(rel);
  return file?.kind === 'present' && file.bytes.length > 0;
};

test('G22.05 (AC1): a supplied empty or non-string placeId is refused by name before any store or probe call', async () => {
  const probeCalls: string[] = [];
  const bad: readonly unknown[] = ['', 5, null, false];
  for (const value of bad) {
    const refused = await readMomentFacts(new MeterStore(new FakeStore(new Map(), new Map(), true)), {
      locales: ['be'],
      audioProbe: recordingProbe(new Map<string, FileFacts>(), probeCalls),
      placeId: value as string,
    });
    assert.ok(!refused.ok);
    if (refused.ok) return;
    assert.equal(refused.diagnostic, 'moment-facts#place-id-invalid');
  }
  // Not one listDir/readFile happened (the failList store would have thrown
  // into moment-facts#list-failed) and not one probe question was asked.
  assert.deepEqual(probeCalls, []);

  // An explicitly undefined scope is not a malformed identifier: it keeps
  // the general-reader mode and reaches the store (the failList refusal).
  const general = await readMomentFacts(new FakeStore(new Map(), new Map(), true), {
    locales: ['be'],
    audioProbe: probeFor(new Map<string, FileFacts>()),
    placeId: undefined,
  });
  assert.ok(!general.ok);
  if (general.ok) return;
  assert.equal(general.diagnostic, 'moment-facts#list-failed');
});

test('G22.05 (AC1): a valid scope with no manifest matches returns no facts and performs no media or text work', async () => {
  const store = new MeterStore(new FakeStore(demoDirs(), demoFiles()));
  const probeCalls: string[] = [];
  const result = await readMomentFacts(store, {
    locales: ['be', 'en'],
    audioProbe: recordingProbe(demoFiles(), probeCalls),
    placeId: 'place-none',
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.moments, []);
  assert.deepEqual(result.diagnostics, []);
  // The manifest read is the allowed discovery cost; the stops.json and the
  // audio probe of the one non-matching teaser are never touched.
  assert.deepEqual(store.reads, ['bundles/route-a/1/moments.json']);
  assert.deepEqual(probeCalls, []);
});

test('G22.05 selected_place_reads_only_matching_media: five packages with twenty stories each — media and text resolve for the one match per package only', async () => {
  const routes = ['a', 'b', 'c', 'd', 'e'];
  const dirs = new Map<string, string[]>([['bundles', routes.map((route) => `route-${route}`)]]);
  const files = new Map<string, FileFacts>();
  for (const route of routes) {
    dirs.set(`bundles/route-${route}`, ['1']);
    const stories = Array.from({ length: 20 }, (_, i) => ({
      id: `m-${route}-${i}`,
      place_id: i === 0 ? 'place-9' : `place-${route}-${i}`,
      story_id: `s-${route}-${i}`,
      kind: 'teaser',
      cooldown_min: 60,
    }));
    files.set(`bundles/route-${route}/1/moments.json`, bytes(JSON.stringify(stories)));
    files.set(
      `bundles/route-${route}/1/be/base/stops.json`,
      bytes(JSON.stringify([{ story_id: `s-${route}-0`, text: `Тэкст ${route}` }])),
    );
    files.set(`bundles/route-${route}/1/be/base/audio/s-${route}-0.m4a`, bytes('audio'));
  }
  const store = new MeterStore(new FakeStore(dirs, files));
  const probeCalls: string[] = [];
  const result = await readMomentFacts(store, {
    locales: ['be'],
    audioProbe: recordingProbe(files, probeCalls),
    placeId: 'place-9',
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.moments.every((moment) => moment.placeId === 'place-9'));
  assert.deepEqual(result.moments.map((moment) => [moment.routeId, moment.momentId, moment.teaserText]), [
    ['route-a', 'm-a-0', 'Тэкст a'],
    ['route-b', 'm-b-0', 'Тэкст b'],
    ['route-c', 'm-c-0', 'Тэкст c'],
    ['route-d', 'm-d-0', 'Тэкст d'],
    ['route-e', 'm-e-0', 'Тэкст e'],
  ]);
  assert.ok(result.moments.every((moment) => moment.audioPath !== null));
  // Manifests (5, the allowed discovery) + the matching teasers' stops.json
  // (5) — nothing else; the probe asked only about the matching stories.
  assert.equal(store.reads.length, 10);
  assert.ok(store.reads.every((rel) => rel.endsWith('/moments.json') || rel.endsWith('/be/base/stops.json')));
  assert.equal(probeCalls.length, 5);
  assert.ok(probeCalls.every((rel) => /^bundles\/route-[a-e]\/1\/be\/base\/audio\/s-[a-e]-0\.m4a$/.test(rel)));
});

test('G22.05 stops_text_read_once_per_package_locale: two teasers of one package share a single stops read; the preference order is unchanged', async () => {
  const dirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const files = new Map<string, FileFacts>([
    [
      'bundles/route-a/1/moments.json',
      bytes(
        JSON.stringify([
          { id: 'm-1', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 60 },
          { id: 'm-2', place_id: 'place-1', story_id: 's-2', kind: 'teaser', cooldown_min: 60 },
          { id: 'm-other', place_id: 'place-2', story_id: 's-3', kind: 'teaser', cooldown_min: 60 },
        ]),
      ),
    ],
    // be carries s-1 only; s-2 falls through to en — the first preferred
    // locale is still asked first for every moment.
    [
      'bundles/route-a/1/be/base/stops.json',
      bytes(JSON.stringify([{ story_id: 's-1', text: 'Тэкст be' }])),
    ],
    [
      'bundles/route-a/1/en/base/stops.json',
      bytes(JSON.stringify([{ story_id: 's-2', text: 'Тэкст en' }])),
    ],
    ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('audio')],
    ['bundles/route-a/1/en/base/audio/s-2.m4a', bytes('audio')],
  ]);
  const store = new MeterStore(new FakeStore(dirs, files));
  const probeCalls: string[] = [];
  const result = await readMomentFacts(store, {
    locales: ['be', 'en'],
    audioProbe: recordingProbe(files, probeCalls),
    placeId: 'place-1',
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.moments.map((moment) => [moment.momentId, moment.teaserText, moment.audioPath]), [
    ['m-1', 'Тэкст be', 'bundles/route-a/1/be/base/audio/s-1.m4a'],
    ['m-2', 'Тэкст en', 'bundles/route-a/1/en/base/audio/s-2.m4a'],
  ]);
  // One read of the be document serves both moments; en is read once for the
  // s-2 fall-through; the non-matching s-3 costs nothing at all.
  assert.deepEqual(store.reads, [
    'bundles/route-a/1/moments.json',
    'bundles/route-a/1/be/base/stops.json',
    'bundles/route-a/1/en/base/stops.json',
  ]);
  assert.deepEqual(probeCalls, [
    'bundles/route-a/1/be/base/audio/s-1.m4a',
    'bundles/route-a/1/be/base/audio/s-2.m4a',
    'bundles/route-a/1/en/base/audio/s-2.m4a',
  ]);
});

test('G22.05 reopen_observes_new_package_and_locale: the text cache lives inside one call — the next open re-reads a changed package', async () => {
  const dirs = new Map<string, string[]>([
    ['bundles', ['route-a']],
    ['bundles/route-a', ['1']],
  ]);
  const files = new Map<string, FileFacts>([
    ['bundles/route-a/1/moments.json', bytes(moment())],
    ['bundles/route-a/1/be/base/stops.json', bytes(JSON.stringify([{ story_id: 's-1', text: 'Стары тэкст' }]))],
    ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('audio')],
  ]);
  const locales = ['be', 'en'] as const;
  const first = await readMomentFacts(new MeterStore(new FakeStore(dirs, files)), {
    locales: [...locales],
    audioProbe: probeFor(files),
  });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.moments[0]?.teaserText, 'Стары тэкст');
  assert.equal(first.moments[0]?.audioPath, 'bundles/route-a/1/be/base/audio/s-1.m4a');

  // The package is replaced between the opens: a new teaser story, its text
  // and an audio file that only en carries. No cross-call cache survives.
  files.set('bundles/route-a/1/moments.json', bytes(moment({ id: 'm-2', story_id: 's-2' })));
  files.set('bundles/route-a/1/be/base/stops.json', bytes(JSON.stringify([{ story_id: 's-2', text: 'Новы тэкст' }])));
  files.delete('bundles/route-a/1/be/base/audio/s-1.m4a');
  files.set('bundles/route-a/1/en/base/audio/s-2.m4a', bytes('audio'));
  const second = await readMomentFacts(new MeterStore(new FakeStore(dirs, files)), {
    locales: [...locales],
    audioProbe: probeFor(files),
  });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.moments[0]?.momentId, 'm-2');
  assert.equal(second.moments[0]?.teaserText, 'Новы тэкст');
  assert.equal(second.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-2.m4a');
  // The earlier answer keeps its own snapshot — a reopened call never
  // rewrites a returned result.
  assert.equal(first.moments[0]?.teaserText, 'Стары тэкст');
});
