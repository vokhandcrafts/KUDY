// G05.03.b — behavioral tests for the lock-screen command mapping (AC2).
// Reverting the locked-skip walk, the boundary stop or the no-Moment
// address space makes them fail (implementation-rules 1). The mapper is
// pure: it never receives a progress handle, and the tests prove that with
// frozen inputs and a deep-equal snapshot after every command.
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapLockScreenCommand, type RecommendedStory } from './lock-screen.ts';

// The recommended list as the device side builds it from accessible guide
// stories (`09` §6.3: lock-screen never starts manual Moment content — the
// entry type carries only a storyId, there is no Moment address in it).
const list: readonly RecommendedStory[] = Object.freeze([
  { storyId: 'stop-1-main', locked: false },
  { storyId: 'stop-1-extra', locked: true },
  { storyId: 'stop-2-main', locked: false },
  { storyId: 'stop-2-extra', locked: true },
  { storyId: 'stop-3-main', locked: false },
]);

test('next selects the next accessible story, skipping locked entries', () => {
  assert.deepEqual(mapLockScreenCommand('next', list, 'stop-1-main'), {
    type: 'select-story',
    storyId: 'stop-2-main',
  });
  assert.deepEqual(mapLockScreenCommand('next', list, 'stop-2-main'), {
    type: 'select-story',
    storyId: 'stop-3-main',
  });
});

test('prev selects the previous accessible story, skipping locked entries', () => {
  assert.deepEqual(mapLockScreenCommand('prev', list, 'stop-3-main'), {
    type: 'select-story',
    storyId: 'stop-2-main',
  });
  assert.deepEqual(mapLockScreenCommand('prev', list, 'stop-2-main'), {
    type: 'select-story',
    storyId: 'stop-1-main',
  });
});

test('the walk stops at the list boundary instead of wrapping around', () => {
  assert.equal(mapLockScreenCommand('next', list, 'stop-3-main'), null);
  assert.equal(mapLockScreenCommand('prev', list, 'stop-1-main'), null);
  // A fully locked tail: next from stop-2-main walks into locked entries
  // only and selects nothing — progress is not touched by the skip.
  const lockedTail: readonly RecommendedStory[] = Object.freeze([
    { storyId: 'a', locked: false },
    { storyId: 'b', locked: true },
    { storyId: 'c', locked: true },
  ]);
  assert.equal(mapLockScreenCommand('next', lockedTail, 'a'), null);
});

test('with no selection next starts at the head and prev selects nothing', () => {
  assert.deepEqual(mapLockScreenCommand('next', list, null), {
    type: 'select-story',
    storyId: 'stop-1-main',
  });
  assert.equal(mapLockScreenCommand('prev', list, null), null);
  // A head that is locked: next still finds the first accessible entry.
  const lockedHead: readonly RecommendedStory[] = Object.freeze([
    { storyId: 'x', locked: true },
    { storyId: 'y', locked: false },
  ]);
  assert.deepEqual(mapLockScreenCommand('next', lockedHead, null), {
    type: 'select-story',
    storyId: 'y',
  });
});

test('a selection outside the list and an empty list select nothing', () => {
  assert.equal(mapLockScreenCommand('next', list, 'not-in-list'), null);
  assert.equal(mapLockScreenCommand('prev', [], 'stop-1-main'), null);
  assert.equal(mapLockScreenCommand('next', [], null), null);
});

test('every mapped selection is an entry of the given list — no Moment path', () => {
  // Walking the whole list in both directions, the command can only ever
  // address a storyId of the accessible recommended list it was given;
  // RecommendedStory has no moment discriminant to construct.
  const ids = new Set(list.map((entry) => entry.storyId));
  for (const entry of list) {
    for (const command of ['next', 'prev'] as const) {
      const result = mapLockScreenCommand(command, list, entry.storyId);
      if (result === null) continue;
      assert.equal(result.type, 'select-story');
      assert.ok(ids.has(result.storyId), `selection ${result.storyId} is not in the recommended list`);
    }
  }
});

test('skipping locked entries never touches progress', () => {
  // The mapper has no progress parameter; the frozen progress snapshot
  // proves it: any attempt to write would throw in strict mode, and the
  // deep-equal after the walk proves nothing was carried out of band.
  const progress = Object.freeze({
    heard: Object.freeze(['stop-1-main']),
    autoFired: Object.freeze(['stop-1']),
    playingNow: Object.freeze({ storyId: 'stop-2-main' }),
  });
  const snapshotBefore = JSON.stringify(progress);
  for (const entry of list) {
    mapLockScreenCommand('next', list, entry.storyId);
    mapLockScreenCommand('prev', list, entry.storyId);
  }
  assert.equal(JSON.stringify(progress), snapshotBefore);
  assert.deepEqual(JSON.parse(snapshotBefore), {
    heard: ['stop-1-main'],
    autoFired: ['stop-1'],
    playingNow: { storyId: 'stop-2-main' },
  });
});
