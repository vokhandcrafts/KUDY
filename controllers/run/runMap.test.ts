// G22.07 (issue #612) — the map projection's own acceptance tests over the
// real runMapView and the real engine state (E7): marker statuses agree
// with the canonical single-stop stopStatus across all five statuses, both
// story tiers and an inaccessible story; a changed package, missing
// geometry, progress updates and Paused/Ended leave no stale coordinates or
// status; inputs are never mutated; and the input-array reads one
// projection does grow linearly over 10/30/100/200 stops (1,000 stops is
// not a valid product route). The linear check counts indexed reads through
// a Proxy over the real input arrays — no private source text is asserted
// and no status logic is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runMapView, type RunMapView } from './runMap.ts';
import { stopStatus, type RunSessionState } from '../../core/engine/state.ts';
import type { RunStopFact, RunPlaceFact } from '../../services/contentRepo/runMapFacts.ts';
import type { RunStop } from './runOrchestrator.ts';

// A synthetic active session over n base-tier stops: every stop accessible
// and unheard (pending) unless the scenario overrides the monotonic sets.
const session = (n: number, overrides: Partial<RunSessionState> = {}): RunSessionState => ({
  phase: 'Active',
  sessionId: 'session-1',
  routeId: 'route-map',
  version: '1',
  locale: 'be',
  tier: ['base'],
  stops: Array.from({ length: n }, (_, i) => ({ stopId: `stop-${i}`, storyBaseId: `story-${i}` })),
  accessibleStopIds: Array.from({ length: n }, (_, i) => `stop-${i}`),
  tierAvailable: ['base'],
  heard: [],
  autoFired: [],
  playing: null,
  queued: null,
  autoplaySuspended: false,
  lastFix: null,
  focusLostAt: null,
  playSeq: 0,
  ...overrides,
});

const idsOf = (state: RunSessionState): string[] => state.stops.map((stop) => stop.stopId);

// One stop's pinned geometry: a readable spread of coordinates so a
// projection has real work, plus the radius the RunStop contract carries.
const geometry = (ids: readonly string[]): RunStop[] =>
  ids.map((stopId, i) => ({ stopId, lat: 54.35 + i * 0.0005, lng: 18.64 + i * 0.0005, radius: 30 }));

const facts = (ids: readonly string[]): RunStopFact[] =>
  ids.map((stopId) => ({ stopId, placeId: `place-${stopId}`, name: { be: `Пункт ${stopId}` } }));

const pois = (n: number): RunPlaceFact[] =>
  Array.from({ length: n }, (_, i) => ({
    placeId: `poi-${i}`,
    lat: 54.36 + i * 0.0005,
    lng: 18.65 + i * 0.0005,
    radius: 10,
    kind: 'cafe',
  }));

const markersById = (view: RunMapView): Map<string, RunMapView['markers'][number]> =>
  new Map(view.markers.map((marker) => [marker.stopId, marker]));

test('run_map_projection_reads_scale_linearly', () => {
  // Counts indexed reads of every input array around the real function: a
  // full scan per marker shows as quadratic growth, a lookup built once per
  // projection as linear.
  let reads = 0;
  const counted = <T>(values: T[]): T[] =>
    new Proxy(values, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) reads += 1;
        return Reflect.get(target, prop, receiver);
      },
    });

  const sizes = [10, 30, 100, 200];
  const counts: number[] = [];
  for (const size of sizes) {
    reads = 0;
    const state = session(size);
    const view = runMapView(
      {
        ...state,
        stops: counted(state.stops),
        accessibleStopIds: counted(state.accessibleStopIds),
        heard: counted(state.heard),
        autoFired: counted(state.autoFired),
      },
      counted(geometry(idsOf(state))),
      counted(facts(idsOf(state))),
      counted(pois(2)),
      ['be'],
    );
    assert.equal(view.markers.length, size);
    counts.push(reads);
  }
  sizes.forEach((size, i) => console.log(`stops=${size} input_reads=${counts[i]}`));

  // Linear work: adjacent growth stays under 1.5× the size ratio. The
  // replaced per-marker scans (findStop/storyAccessible over the session
  // stops, indexOf over the geometry) read ~2n cells per marker and blow
  // past the bound at every pair.
  for (let i = 1; i < sizes.length; i += 1) {
    const ratio = sizes[i] / sizes[i - 1];
    assert.ok(
      counts[i] < 1.5 * ratio * counts[i - 1],
      `input reads must grow linearly: ${sizes[i - 1]}→${sizes[i]} stops gave ${counts[i - 1]}→${counts[i]} reads`,
    );
  }
});

test('projected_markers_match_engine_status', () => {
  // All five canonical statuses in one walk (ADR G01.01 §4.5): stop-0
  // pending, stop-1 available (auto-fired), stop-2 playing (the audible
  // guide launch), stop-3 played (primary heard), stop-4 locked by tier
  // (extended-only stop on a base walk) and stop-5 locked by access (its id
  // never entered accessible_stop_ids).
  const state: RunSessionState = {
    ...session(6),
    stops: [
      { stopId: 'stop-0', storyBaseId: 'story-0' },
      { stopId: 'stop-1', storyBaseId: 'story-1' },
      { stopId: 'stop-2', storyBaseId: 'story-2' },
      { stopId: 'stop-3', storyBaseId: 'story-3' },
      { stopId: 'stop-4', storyExtendedId: 'story-4' },
      { stopId: 'stop-5', storyBaseId: 'story-5' },
    ],
    accessibleStopIds: ['stop-0', 'stop-1', 'stop-2', 'stop-3', 'stop-4'],
    autoFired: ['stop-1'],
    heard: ['story-3'],
    playing: { owner: 'guide', stopId: 'stop-2', storyId: 'story-2', playId: 1, paused: false },
  };
  const ids = idsOf(state);
  const geo = geometry(ids);
  const fac = facts(ids);
  const poi = pois(1);

  const view = runMapView(state, geo, fac, poi, ['be']);
  for (const stop of state.stops) {
    assert.equal(markersById(view).get(stop.stopId)?.status, stopStatus(state, stop.stopId));
  }
  assert.deepEqual(
    [...markersById(view)].map(([stopId, marker]) => [stopId, marker.status]),
    [
      ['stop-0', 'pending'],
      ['stop-1', 'available'],
      ['stop-2', 'playing'],
      ['stop-3', 'played'],
      ['stop-4', 'locked'],
      ['stop-5', 'locked'],
    ],
  );

  // A live pause keeps the launch but the marker follows the audible state:
  // no stale «playing» anywhere, every marker still the engine's own answer.
  const paused: RunSessionState = {
    ...state,
    phase: 'Paused',
    playing: { owner: 'guide', stopId: 'stop-2', storyId: 'story-2', playId: 1, paused: true },
  };
  const pausedView = runMapView(paused, geo, fac, poi, ['be']);
  assert.equal(pausedView.markers.length, 6);
  for (const marker of pausedView.markers) {
    assert.notEqual(marker.status, 'playing');
    assert.equal(marker.status, stopStatus(paused, marker.stopId));
  }

  // Ended keeps rendering the session truth — only Idle empties the map.
  const ended: RunSessionState = { ...paused, phase: 'Ended' };
  const endedView = runMapView(ended, geo, fac, poi, ['be']);
  assert.equal(endedView.markers.length, 6);
  for (const marker of endedView.markers) {
    assert.equal(marker.status, stopStatus(ended, marker.stopId));
  }

  // A progress update (a fresh engine state with more heard) is visible on
  // the next projection — the derived status table never outlives its state.
  const progressed: RunSessionState = { ...state, heard: ['story-3', 'story-1'] };
  const progressedView = runMapView(progressed, geo, fac, poi, ['be']);
  assert.equal(markersById(progressedView).get('stop-1')?.status, 'played');
  assert.equal(markersById(progressedView).get('stop-1')?.status, stopStatus(progressed, 'stop-1'));

  // Inputs are not mutated: the same structures in, the same structures out.
  const snapshot = structuredClone({ state, geo, fac, poi });
  runMapView(state, geo, fac, poi, ['be']);
  assert.deepEqual({ state, geo, fac, poi }, snapshot);
});

test('package_change_invalidates_geometry', () => {
  // The session is pinned to version 1's three stops; version 2 moved its
  // surviving stop and carries the others no more.
  const state = session(3);
  const ids = idsOf(state);
  const v1 = geometry(ids);
  const v2: RunStop[] = [{ stopId: 'stop-0', lat: 54.4, lng: 18.7, radius: 30 }];
  const fac = facts(ids);
  const poi = pois(1);

  const v1View = runMapView(state, v1, fac, poi, ['be']);
  const v2View = runMapView(state, v2, fac, poi, ['be']);

  // Missing geometry renders the honest center — never the old coordinates.
  for (const stopId of ['stop-1', 'stop-2']) {
    assert.equal(markersById(v2View).get(stopId)?.nx, 0.5);
    assert.equal(markersById(v2View).get(stopId)?.ny, 0.5);
  }
  // The surviving stop takes version 2's own projection, not a stale fit.
  assert.notDeepEqual(
    { nx: markersById(v2View).get('stop-0')?.nx, ny: markersById(v2View).get('stop-0')?.ny },
    { nx: markersById(v1View).get('stop-0')?.nx, ny: markersById(v1View).get('stop-0')?.ny },
  );
  // Status stays the engine's own answer after the geometry change.
  for (const stop of state.stops) {
    assert.equal(markersById(v2View).get(stop.stopId)?.status, stopStatus(state, stop.stopId));
  }

  // A changed version identity is only another input set: two projections
  // over the same inputs agree, and no call mutates what it was given.
  assert.deepEqual(runMapView(state, v2, fac, poi, ['be']), v2View);
  const snapshot = structuredClone({ state, v1, v2, fac, poi });
  runMapView(state, v1, fac, poi, ['be']);
  runMapView(state, v2, fac, poi, ['be']);
  assert.deepEqual({ state, v1, v2, fac, poi }, snapshot);
});
