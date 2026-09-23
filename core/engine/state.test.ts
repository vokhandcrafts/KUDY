// G05.01.a — the computed stop status (issue #197, criterion 6; ADR G01.01
// §4.5): locked → playing → played → available → pending, first match wins,
// nothing stored. The paid-only stop stays locked until the same-version
// AccessReady widens the tier (ADR G01.01 §4.4).
import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEngineConfig, step } from './reducer.ts';
import { initialRunState, primaryStoryOf, stopStatus, type RunSessionState } from './state.ts';

const NOW = 1_000_000;

const STOPS = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
  { stopId: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];

const state = (overrides: Partial<RunSessionState> = {}): RunSessionState => ({
  phase: 'Active',
  sessionId: 'session-1',
  routeId: 'route-1',
  version: 'v3',
  locale: 'be',
  tier: ['base'],
  stops: STOPS,
  accessibleStopIds: ['stop-plain'],
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

test('criterion 6: the primary story of a paid-only stop is its extended story', () => {
  assert.equal(primaryStoryOf(STOPS[0]), 'story-crane-base');
  assert.equal(primaryStoryOf(STOPS[2]), 'story-gate-ext');
});

test('criterion 6: pending — accessible, not fired, not heard', () => {
  assert.equal(stopStatus(state(), 'stop-plain'), 'pending');
});

test('criterion 6: locked — the primary story is not accessible', () => {
  assert.equal(stopStatus(state(), 'stop-crane'), 'locked', 'outside accessible_stop_ids');
  assert.equal(
    stopStatus(state({ accessibleStopIds: ['stop-gate'] }), 'stop-gate'),
    'locked',
    'paid-only: the extended tier is not available yet',
  );
  assert.equal(stopStatus(state(), 'stop-unknown'), 'locked', 'outside the pinned package');
});

test('criterion 6: available — fired, primary not heard; played — primary heard', () => {
  assert.equal(stopStatus(state({ autoFired: ['stop-plain'] }), 'stop-plain'), 'available');
  assert.equal(stopStatus(state({ heard: ['story-plain-base'] }), 'stop-plain'), 'played');
});

test('criterion 6: playing wins over played while the guide launch is live', () => {
  const playing = state({
    heard: ['story-plain-base'],
    playing: { owner: 'guide', stopId: 'stop-plain', storyId: 'story-plain-base', playId: 1 },
  });
  assert.equal(stopStatus(playing, 'stop-plain'), 'playing');
});

test('criterion 6: a moment launch never marks its teaser stop as playing', () => {
  const moment = state({
    playing: { owner: 'moment', momentId: 'moment-9', storyId: 'story-plain-base', seq: 3 },
  });
  assert.equal(stopStatus(moment, 'stop-plain'), 'pending');
});

test('criterion 6: the status is derived through the reducer flow — locked until the unlock', () => {
  const startResult = step(initialRunState, {
    type: 'Start',
    sessionId: 'session-1',
    routeId: 'route-1',
    version: 'v3',
    locale: 'be',
    tier: ['base'],
    accessibleStopIds: ['stop-plain'],
    stops: STOPS,
  }, NOW, defaultEngineConfig);
  assert.ok(startResult.state.phase !== 'Idle');
  assert.equal(stopStatus(startResult.state, 'stop-gate'), 'locked');
  const unlocked = step(startResult.state, {
    type: 'AccessReady',
    routeId: 'route-1',
    version: 'v3',
    locale: 'be',
    tier: 'extended',
    stopIds: ['stop-gate'],
    issuer: 'services/download',
  }, NOW, defaultEngineConfig);
  assert.ok(unlocked.state.phase !== 'Idle');
  assert.equal(stopStatus(unlocked.state, 'stop-gate'), 'pending');
});
