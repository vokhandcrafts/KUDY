// G06.03 (issue #279) — the panel's story facts reader: happy path plus the
// negative facts (rule 14 — every diagnostic names itself), and the honest
// degradation per entry: an entry without a story id is skipped, an entry
// without a readable transcript carries null, never invented text.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readRunStoryFacts } from './runStoryFacts.ts';
import type { BundlesStore } from './types.ts';

function store(files: Record<string, string>, unreadable = false): BundlesStore {
  return {
    listDir: async () => null,
    readFile: async (rel) => {
      if (unreadable) return { kind: 'unreadable' };
      const data = files[rel];
      return data === undefined
        ? { kind: 'absent' }
        : { kind: 'present', bytes: new TextEncoder().encode(data) };
    },
    statSize: async () => null,
  };
}

const STOPS = JSON.stringify([
  { story_id: 'story-1', place_id: 'place-1', voice_id: 'voice-1', tier: 'base', duration_s: 60, text: 'т', transcript: 'Транскрыпт мытні', sources: ['с'] },
  { story_id: 'story-2', place_id: 'place-2', voice_id: 'voice-1', tier: 'base', duration_s: 60, text: 'т', transcript: 'Транскрыпт порта', sources: ['с'] },
]);

test('the pinned layer’s transcripts read beside the map facts', async () => {
  const facts = await readRunStoryFacts(store({ 'be/base/stops.json': STOPS }), 'be/base');
  assert.deepEqual(facts, {
    ok: true,
    stories: [
      { storyId: 'story-1', transcript: 'Транскрыпт мытні' },
      { storyId: 'story-2', transcript: 'Транскрыпт порта' },
    ],
  });
});

test('a missing stops.json is the named diagnostic, never a throw', async () => {
  assert.deepEqual(await readRunStoryFacts(store({}), 'be/base'), {
    ok: false,
    diagnostic: 'run-story#stops-json-missing',
  });
});

test('an unreadable stops.json is the named diagnostic', async () => {
  assert.deepEqual(await readRunStoryFacts(store({}, true), 'be/base'), {
    ok: false,
    diagnostic: 'run-story#stops-json-unreadable',
  });
});

test('corrupt stops.json yields the invalid diagnostic — wrong types and broken JSON included', async () => {
  assert.deepEqual(await readRunStoryFacts(store({ 'be/base/stops.json': '{not json' }), 'be/base'), {
    ok: false,
    diagnostic: 'run-story#stops-json-invalid',
  });
  assert.deepEqual(await readRunStoryFacts(store({ 'be/base/stops.json': '{"story":"object"}' }), 'be/base'), {
    ok: false,
    diagnostic: 'run-story#stops-json-invalid',
  });
});

test('entries without a story id are skipped; a story without a readable transcript is null', async () => {
  const damaged = JSON.stringify([
    null,
    { place_id: 'place-1', transcript: 'сірочы запіс' },
    { story_id: '', transcript: 'пусты ідэнтыфікатар' },
    { story_id: 'story-2', transcript: '' },
    { story_id: 'story-3' },
  ]);
  assert.deepEqual(await readRunStoryFacts(store({ 'be/base/stops.json': damaged }), 'be/base'), {
    ok: true,
    stories: [
      { storyId: 'story-2', transcript: null },
      { storyId: 'story-3', transcript: null },
    ],
  });
});
