// G05.01.a — acceptance suite for the session lifecycle and the AccessReady
// boundary (issue #197, docs/agent-tasks/run/G05.01.a.md).
// Criteria:
// 1. Names verbatim from 09 §6.1, one snake_case ↔ camelCase mapping (state.ts header) —
//    the shape test pins the full session field surface.
// 2. step() is pure: no input mutation, deterministic output; arch:check covers the
//    import boundary and runs in the pre-push gate.
// 3. Lifecycle: Ended never returns to Active; Pause and End clear queued and emit
//    ClearGeofences.
// 4. Start refuses a package without a verified tier or with accessibleStopIds
//    outside the pinned package (model parity with run-model start()).
// 5. AccessReady: all six checks of ADR G01.03 §3.5; mismatch keeps the state
//    deep-equal; acceptance widens availability, recomputes the window, no Play;
//    a repeat is a no-op.
// 6. Stop status is computed (state.test.ts).
// Proof: the version-mismatch rejection test fails when the version check is
// dropped from applyAccess.
import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultEngineConfig, step } from './reducer.ts';
import { initialRunState, type RunSessionState, type RunState } from './state.ts';
import type { RunEvent } from './events.ts';

const CONFIG = defaultEngineConfig;
const NOW = 1_000_000;

// stop-gate is paid-only: its primary story is the extended one (ADR G01.01 §4.4).
const STOPS = [
  { stopId: 'stop-crane', storyBaseId: 'story-crane-base', storyExtendedId: 'story-crane-ext' },
  { stopId: 'stop-plain', storyBaseId: 'story-plain-base' },
  { stopId: 'stop-gate', storyExtendedId: 'story-gate-ext' },
];

const startEvent = (overrides: Partial<Extract<RunEvent, { type: 'Start' }>> = {}): RunEvent => ({
  type: 'Start',
  sessionId: 'session-1',
  routeId: 'route-1',
  version: 'v3',
  locale: 'be',
  tier: ['base'],
  accessibleStopIds: ['stop-crane', 'stop-plain'],
  stops: STOPS,
  ...overrides,
});

const sessionOf = (result: { state: RunState }): RunSessionState => {
  assert.ok(result.state.phase !== 'Idle', 'a session must exist after Start');
  return result.state;
};

const started = (): RunSessionState => {
  const result = step(initialRunState, startEvent(), NOW, CONFIG);
  assert.deepEqual(result.commands, [], 'Start itself emits no effect commands');
  return sessionOf(result);
};

const accessReady = (
  overrides: Partial<Extract<RunEvent, { type: 'AccessReady' }>> = {},
): RunEvent => ({
  type: 'AccessReady',
  routeId: 'route-1',
  version: 'v3',
  locale: 'be',
  tier: 'extended',
  stopIds: ['stop-crane', 'stop-gate'],
  issuer: 'services/download',
  ...overrides,
});

const withQueued = (state: RunSessionState): RunSessionState => ({
  ...state,
  queued: { stopId: 'stop-plain', radius: 30, at: NOW },
});

test('criterion 1: the session state carries the 09 §6.1 Active fields under one mapped spelling', () => {
  const state = started();
  assert.deepEqual(Object.keys(state).sort(), [
    'accessibleStopIds',
    'autoFired',
    'autoplaySuspended',
    'focusLostAt',
    'heard',
    'lastFix',
    'locale',
    'phase',
    'playSeq',
    'playing',
    'queued',
    'routeId',
    'sessionId',
    'stops',
    'tier',
    'tierAvailable',
    'version',
  ]);
});

test('criterion 2: step() does not mutate the previous state and is deterministic', () => {
  const previous = withQueued(started());
  const snapshot = structuredClone(previous);
  const first = step(previous, { type: 'Pause' }, NOW, CONFIG);
  assert.deepEqual(previous, snapshot, 'the input state stays untouched');
  const second = step(previous, { type: 'Pause' }, NOW, CONFIG);
  assert.deepEqual(first, second, 'the same input gives the same output');
});

test('criterion 2: the config surface carries the accepted engine numbers (unused in this slice)', () => {
  assert.deepEqual(defaultEngineConfig, {
    fixFreshnessMs: 30_000,
    queueDistanceMultiplier: 2,
    focusRegainWindowMs: 600_000,
  });
});

test('criterion 3: Start pins the session identity and starts from clean progress', () => {
  const state = started();
  assert.equal(state.phase, 'Active');
  assert.equal(state.sessionId, 'session-1');
  assert.equal(state.routeId, 'route-1');
  assert.equal(state.version, 'v3');
  assert.equal(state.locale, 'be');
  assert.deepEqual(state.tier, ['base'], 'the informational start record of verified layers');
  assert.deepEqual(state.tierAvailable, ['base']);
  assert.deepEqual(state.accessibleStopIds, ['stop-crane', 'stop-plain']);
  assert.deepEqual(state.heard, []);
  assert.deepEqual(state.autoFired, []);
  assert.equal(state.playing, null);
  assert.equal(state.queued, null);
  assert.equal(state.autoplaySuspended, false);
  assert.equal(state.playSeq, 0);
});

test('criterion 3: Pause retires the queued stop to auto_fired, suspends and clears geofences', () => {
  const result = step(withQueued(started()), { type: 'Pause' }, NOW, CONFIG);
  const state = sessionOf(result);
  assert.equal(state.phase, 'Paused');
  assert.equal(state.queued, null);
  assert.deepEqual(state.autoFired, ['stop-plain']);
  assert.equal(state.autoplaySuspended, true);
  assert.deepEqual(result.commands, [{ type: 'ClearGeofences' }]);
});

test('criterion 3: End retires the queue, clears geofences and finishes the session', () => {
  const result = step(withQueued(started()), { type: 'End' }, NOW, CONFIG);
  const state = sessionOf(result);
  assert.equal(state.phase, 'Ended');
  assert.equal(state.queued, null);
  assert.deepEqual(state.autoFired, ['stop-plain']);
  assert.deepEqual(result.commands, [{ type: 'ClearGeofences' }]);
});

test('criterion 3: Resume exists only from Paused, clears the suspension and rebuilds the window', () => {
  const paused = sessionOf(step(started(), { type: 'Pause' }, NOW, CONFIG));
  const result = step(paused, { type: 'Resume' }, NOW, CONFIG);
  const state = sessionOf(result);
  assert.equal(state.phase, 'Active');
  assert.equal(state.autoplaySuspended, false);
  assert.deepEqual(result.commands, [
    { type: 'SetGeofenceWindow', stopIds: ['stop-crane', 'stop-plain'] },
  ]);
});

test('criterion 3: Resume from Active is a no-op', () => {
  const active = started();
  const result = step(active, { type: 'Resume' }, NOW, CONFIG);
  assert.deepEqual(result.state, active);
  assert.deepEqual(result.commands, []);
});

test('criterion 3: Ended never returns to Active — Resume and Start are ignored there', () => {
  const ended = sessionOf(step(started(), { type: 'End' }, NOW, CONFIG));
  const resumed = step(ended, { type: 'Resume' }, NOW, CONFIG);
  assert.deepEqual(resumed.state, ended, 'Resume does not revive the session');
  assert.deepEqual(resumed.commands, []);
  const restarted = step(ended, startEvent({ sessionId: 'session-2' }), NOW, CONFIG);
  assert.deepEqual(restarted.state, ended, 'a repeat walk starts a fresh session, not this one');
  assert.deepEqual(restarted.commands, []);
});

test('criterion 3: a live session ignores a second Start', () => {
  const active = started();
  const result = step(active, startEvent({ sessionId: 'session-2' }), NOW, CONFIG);
  assert.deepEqual(result.state, active);
  assert.deepEqual(result.commands, []);
});

test('criterion 3: with no session only Start exists — other events are ignored', () => {
  const paused = step(initialRunState, { type: 'Pause' }, NOW, CONFIG);
  assert.deepEqual(paused.state, initialRunState);
  assert.deepEqual(paused.commands, []);
  const access = step(initialRunState, accessReady(), NOW, CONFIG);
  assert.deepEqual(access.state, initialRunState);
  assert.deepEqual(access.commands, []);
});

test('criterion 4: Start refuses a package without a verified tier', () => {
  assert.throws(
    () => step(initialRunState, startEvent({ tier: [] }), NOW, CONFIG),
    /at least one verified layer/,
  );
});

test('criterion 4: Start refuses an unknown layer', () => {
  assert.throws(
    () => step(initialRunState, startEvent({ tier: ['premium' as 'base'] }), NOW, CONFIG),
    /at least one verified layer/,
  );
});

test('criterion 4: Start refuses accessibleStopIds outside the pinned package', () => {
  assert.throws(
    () =>
      step(
        initialRunState,
        startEvent({ accessibleStopIds: ['stop-crane', 'stop-unknown'] }),
        NOW,
        CONFIG,
      ),
    /stops of the pinned package/,
  );
});

test('criterion 4: Start refuses a duplicated accessibleStopIds entry', () => {
  assert.throws(
    () =>
      step(
        initialRunState,
        startEvent({ accessibleStopIds: ['stop-crane', 'stop-crane'] }),
        NOW,
        CONFIG,
      ),
    /stops of the pinned package/,
  );
});

test('criterion 5: AccessReady of the same identity widens availability, rebuilds the window and plays nothing', () => {
  const state = started();
  const before = structuredClone(state);
  const result = step(state, accessReady(), NOW, CONFIG);
  const accepted = sessionOf(result);
  assert.deepEqual(accepted.tierAvailable, ['base', 'extended']);
  assert.deepEqual(accepted.accessibleStopIds, ['stop-crane', 'stop-plain', 'stop-gate']);
  assert.deepEqual(accepted.heard, before.heard, 'heard is untouched');
  assert.deepEqual(accepted.autoFired, before.autoFired, 'auto_fired is untouched');
  assert.deepEqual(result.commands, [
    { type: 'SetGeofenceWindow', stopIds: ['stop-crane', 'stop-plain', 'stop-gate'] },
  ]);
  assert.ok(!result.commands.some((command) => command.type === 'PlayStory'), 'no Play');
});

test('criterion 5 (proof): an AccessReady of another version is ignored entirely', () => {
  const state = started();
  const snapshot = structuredClone(state);
  const result = step(state, accessReady({ version: 'v4' }), NOW, CONFIG);
  assert.deepEqual(result.state, snapshot, 'no field mutates on a version mismatch');
  assert.deepEqual(result.commands, []);
});

test('criterion 5: another route, another locale and a foreign issuer are each ignored entirely', () => {
  for (const event of [
    accessReady({ routeId: 'route-2' }),
    accessReady({ locale: 'en' }),
    accessReady({ issuer: 'ui' as 'services/download' }),
  ]) {
    const state = started();
    const snapshot = structuredClone(state);
    const result = step(state, event, NOW, CONFIG);
    assert.deepEqual(result.state, snapshot, `${event.type} with a mismatched identity is a full ignore`);
    assert.deepEqual(result.commands, []);
  }
});

test('criterion 5: unknown stop ids and a wrong runtime tier value open nothing', () => {
  const state = started();
  const snapshot = structuredClone(state);
  const unknownStop = step(state, accessReady({ stopIds: ['stop-gate', 'stop-unknown'] }), NOW, CONFIG);
  assert.deepEqual(unknownStop.state, snapshot, 'unknown stop_id opens no content');
  assert.deepEqual(unknownStop.commands, []);
  const badTier = step(state, accessReady({ tier: 'paid' as 'extended' }), NOW, CONFIG);
  assert.deepEqual(badTier.state, snapshot, 'an unknown layer is not a verified layer');
  assert.deepEqual(badTier.commands, []);
});

test('criterion 5: a repeat of the same identity is a no-op', () => {
  const once = sessionOf(step(started(), accessReady(), NOW, CONFIG));
  const before = structuredClone(once);
  const repeat = step(once, accessReady(), NOW, CONFIG);
  assert.deepEqual(repeat.state, before, 'the second identical event mutates nothing');
  assert.deepEqual(repeat.commands, [], 'the second identical event emits no command');
});

test('criterion 5: a tier-only payload widens the tier (run-model applyAccess parity)', () => {
  const result = step(started(), accessReady({ stopIds: [], tier: 'extended' }), NOW, CONFIG);
  const accepted = sessionOf(result);
  assert.deepEqual(accepted.tierAvailable, ['base', 'extended']);
  assert.deepEqual(accepted.accessibleStopIds, ['stop-crane', 'stop-plain']);
  assert.deepEqual(result.commands, [
    { type: 'SetGeofenceWindow', stopIds: ['stop-crane', 'stop-plain'] },
  ]);
});

test('criterion 5: a paused session is a live addressee — AccessReady applies there too', () => {
  const paused = sessionOf(step(started(), { type: 'Pause' }, NOW, CONFIG));
  const result = step(paused, accessReady(), NOW, CONFIG);
  const accepted = sessionOf(result);
  assert.deepEqual(accepted.tierAvailable, ['base', 'extended']);
  assert.deepEqual(accepted.accessibleStopIds, ['stop-crane', 'stop-plain', 'stop-gate']);
  assert.deepEqual(result.commands, [
    { type: 'SetGeofenceWindow', stopIds: ['stop-crane', 'stop-plain', 'stop-gate'] },
  ]);
});
