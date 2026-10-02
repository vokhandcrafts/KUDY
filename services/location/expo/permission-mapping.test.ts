// G20.07 — the scope mapping tests (G05.02.c AC1 stays: the status field is
// authoritative). The load-bearing rules: a background denial leaves the
// foreground state standing (runtime.md R4), a background grant implies the
// foreground one, and a corrupt status lands on the safe 'undetermined' side
// (implementation-rules 14). Reverting the mapping to the merged single
// state turns foreground_stands_under_background_denied red — that is the
// merge defect G20.07 fixes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapScopeAnswer } from './permission-mapping.ts';

const neither = { foreground: 'undetermined', background: 'undetermined' } as const;

test('foreground_answer_sets_foreground_only', () => {
  assert.deepEqual(mapScopeAnswer('foreground', { status: 'granted' }, neither), {
    foreground: 'granted',
    background: 'undetermined',
  });
  assert.deepEqual(mapScopeAnswer('foreground', { status: 'denied' }, neither), {
    foreground: 'denied',
    background: 'undetermined',
  });
  // A foreground answer never writes the background scope.
  assert.deepEqual(
    mapScopeAnswer('foreground', { status: 'granted' }, { foreground: 'undetermined', background: 'granted' }),
    { foreground: 'granted', background: 'granted' },
  );
});

test('foreground_stands_under_background_denied', () => {
  // The city surface granted the foreground; the Start path's background ask
  // is denied. The denial settles nothing about the foreground — merging it
  // into one state would revoke the already-granted work (runtime.md R4).
  const previous = { foreground: 'granted', background: 'undetermined' } as const;
  assert.deepEqual(mapScopeAnswer('background', { status: 'denied' }, previous), {
    foreground: 'granted',
    background: 'denied',
  });
  // An undetermined background answer settles nothing either.
  assert.deepEqual(mapScopeAnswer('background', { status: 'undetermined' }, previous), {
    foreground: 'granted',
    background: 'undetermined',
  });
});

test('background_grant_implies_foreground', () => {
  // iOS «always» subsumes «when in use»; Android grants background only
  // after the foreground one — either way the foreground capability exists.
  assert.deepEqual(mapScopeAnswer('background', { status: 'granted' }, neither), {
    foreground: 'granted',
    background: 'granted',
  });
});

test('corrupt_status_lands_undetermined', () => {
  // The OS boundary is not trusted: an unknown spelling (a future OS value,
  // a corrupt response) answers 'undetermined', never throws and never
  // reads as a grant or a denial.
  assert.deepEqual(
    mapScopeAnswer('foreground', { status: 'limited' as 'granted' }, { foreground: 'granted', background: 'denied' }),
    { foreground: 'undetermined', background: 'denied' },
  );
  assert.deepEqual(mapScopeAnswer('background', { status: undefined as unknown as 'granted' }, neither), {
    foreground: 'undetermined',
    background: 'undetermined',
  });
});
