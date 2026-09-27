// G07.02 (issue #282) — the moment facts reader suite: the manifest parse,
// the teaser audio path resolution and the damage diagnostics (rule 14 — one
// negative per rule, none thrown) over a fake BundlesStore.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readMomentFacts } from './momentFacts.ts';
import type { BundlesStore, FileFacts } from './types.ts';

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

const bytes = (text: string): FileFacts => ({ kind: 'present', bytes: new TextEncoder().encode(text) });
const moment = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify([{ id: 'm-1', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 60, ...overrides }]);

function demoStore(): BundlesStore {
  return new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a', 'staging']],
      ['bundles/route-a', ['1', 'staging']],
    ]),
    new Map<string, FileFacts>([
      ['bundles/route-a/1/moments.json', bytes(moment())],
      ['bundles/route-a/1/be/base/stops.json', bytes(JSON.stringify([{ story_id: 's-1', text: 'Тэйзер-тэкст' }]))],
      ['bundles/route-a/1/be/base/audio/s-1.m4a', bytes('audio')],
    ]),
  );
}

test('the manifest of a downloaded package resolves the teaser facts and the base audio path', async () => {
  const result = await readMomentFacts(demoStore(), { locales: ['be', 'en'] });
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
  const result = await readMomentFacts(demoStore(), { locales: ['be', 'en'] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.moments.length, 1);
  assert.ok(result.moments.every((moment) => moment.routeId !== 'staging' && moment.version !== 'staging'));
});

test('the first preferred locale without the audio file falls to the next, then to null', async () => {
  const enOnly = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a']],
      ['bundles/route-a', ['1']],
    ]),
    new Map<string, FileFacts>([
      ['bundles/route-a/1/moments.json', bytes(moment())],
      ['bundles/route-a/1/en/base/audio/s-1.m4a', bytes('audio')],
    ]),
  );
  const fell = await readMomentFacts(enOnly, { locales: ['be', 'en'] });
  assert.ok(fell.ok);
  if (!fell.ok) return;
  assert.equal(fell.moments[0]?.audioPath, 'bundles/route-a/1/en/base/audio/s-1.m4a');

  const silent = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a']],
      ['bundles/route-a', ['1']],
    ]),
    new Map<string, FileFacts>([['bundles/route-a/1/moments.json', bytes(moment())]]),
  );
  const none = await readMomentFacts(silent, { locales: ['be', 'en'] });
  assert.ok(none.ok);
  if (!none.ok) return;
  assert.equal(none.moments[0]?.audioPath, null);
  assert.equal(none.moments[0]?.teaserText, null);
});

test('a corrupt manifest is a named diagnostic; the other packages still read (rule 14)', async () => {
  const store = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a', 'route-b']],
      ['bundles/route-a', ['1']],
      ['bundles/route-b', ['1']],
    ]),
    new Map<string, FileFacts>([
      ['bundles/route-a/1/moments.json', bytes('{not json')],
      ['bundles/route-b/1/moments.json', bytes(moment({ id: 'm-2' }))],
      ['bundles/route-b/1/be/base/audio/s-1.m4a', bytes('audio')],
    ]),
  );
  const result = await readMomentFacts(store, { locales: ['be'] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.diagnostics, ['moment-facts#manifest-invalid:bundles/route-a/1']);
  assert.deepEqual(result.moments.map((moment) => moment.momentId), ['m-2']);
});

test('an entry missing cooldown_min is isolated and skipped with its own diagnostic', async () => {
  const store = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a']],
      ['bundles/route-a', ['1']],
    ]),
    new Map<string, FileFacts>([
      [
        'bundles/route-a/1/moments.json',
        bytes(
          JSON.stringify([
            { id: 'm-bad', place_id: 'place-1', story_id: 's-1' },
            { id: 'm-ok', place_id: 'place-1', story_id: 's-1', kind: 'teaser', cooldown_min: 5 },
          ]),
        ),
      ],
    ]),
  );
  const result = await readMomentFacts(store, { locales: ['be'] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.diagnostics, ['moment-facts#entry-invalid:bundles/route-a/1']);
  assert.deepEqual(result.moments.map((moment) => moment.momentId), ['m-ok']);
});

test('an unsafe story_id from the manifest yields no audio path, never a path (09 §7)', async () => {
  const store = new FakeStore(
    new Map<string, string[]>([
      ['bundles', ['route-a']],
      ['bundles/route-a', ['1']],
    ]),
    new Map<string, FileFacts>([
      ['bundles/route-a/1/moments.json', bytes(moment({ story_id: '../escape' }))],
      ['bundles/route-a/1/be/base/audio/..%2Fescape.m4a', bytes('audio')],
    ]),
  );
  const result = await readMomentFacts(store, { locales: ['be'] });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.moments[0]?.audioPath, null);
  assert.deepEqual(result.diagnostics, []);
});

test('an absent manifest is the honest empty; a gone store is the named refusal', async () => {
  const empty = await readMomentFacts(new FakeStore(new Map(), new Map()), { locales: ['be'] });
  assert.ok(empty.ok);
  if (!empty.ok) return;
  assert.deepEqual(empty.moments, []);
  assert.deepEqual(empty.diagnostics, []);

  const gone = await readMomentFacts(new FakeStore(new Map(), new Map(), true), { locales: ['be'] });
  assert.ok(!gone.ok);
  if (gone.ok) return;
  assert.equal(gone.diagnostic, 'moment-facts#list-failed');
});
