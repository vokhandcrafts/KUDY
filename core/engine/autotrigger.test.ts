// G05.01.b — acceptance suite for the autotrigger, the one-cell queue and the
// P01 progress rules (issue #198, docs/agent-tasks/run/G05.01.b.md).
// Criteria:
// 1. The autotrigger fires only when all six conditions of ADR G01.01 §4.8
//    hold; each condition has an isolated negative test.
// 2. auto_fired and heard are monotonic; a manual replay after played is
//    allowed; an interrupted replay keeps heard (11 C7).
// 3. The queue is one cell: the newest other stop wins, the displaced stop
//    goes to auto_fired, a stop never displaces itself; the deferred play
//    re-checks freshness ≤ 30 000 ms, accuracy ≤ radius and distance
//    ≤ 2 × radius — bounds inclusive.
// 4. The three not-played outcomes stay distinct (busy / suspended / ignored).
// 5. AudioFinished is accepted only on the matching (session_id, play_id)
//    pair and the matching story_id when present; a late callback from a
//    previous session is ignored (11 C10); play_seq grows by 1 per PlayStory.
// 6. P01: a heard base never credits extended; extended plays only through
//    UserSelectedStory; locked never plays and never enters auto_fired or
//    «Яшчэ можна адкрыць» (11 C33, C36–C37).
// 7. All six permutations of three stops pass (11 C31).
// Proof: dropping the `primary ∉ heard` condition from autoEligible turns the
// criterion-1 C12 test red.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accessReady,
  CONFIG,
  NOW,
  sessionOf,
  startEvent,
  started,
  STOPS,
} from './fixtures.ts';
import { step } from './reducer.ts';
import { initialRunState, missedStories, stopStatus, type RunSessionState } from './state.ts';
import type { RunEvent } from './events.ts';

// A fix the pipeline could have accepted: 5 m inside the 30 m radius of every
// stop, accepted right now — a case overrides the numbers it stresses.
const fix = (
  overrides: { age?: number; accuracy?: number; distance?: number } = {},
): RunEvent => ({
  type: 'LocationAccepted',
  fix: {
    lat: 54.35,
    lng: 18.65,
    accuracy: overrides.accuracy ?? 5,
    at: NOW - (overrides.age ?? 0),
    distances: new Map(STOPS.map((stop) => [stop.stopId, overrides.distance ?? 5])),
  },
});

const dwell = (stopId: string, radius = 30): RunEvent => ({ type: 'DwellCompleted', stopId, radius });

// Completes the live guide launch with its own identity — the accepted
// AudioFinished of the flow, not a forged one.
const finished = (state: RunSessionState): RunSessionState => {
  assert.ok(state.playing && state.playing.owner === 'guide', 'a guide launch must be live');
  return sessionOf(
    step(
      state,
      { type: 'AudioFinished', sessionId: state.sessionId, playId: state.playing.playId },
      NOW,
      CONFIG,
    ),
  );
};

const plays = (result: { commands: { type: string }[] }): boolean =>
  result.commands.some((command) => command.type === 'PlayStory');

test('criterion 1 (§4.8.1): a dwell in a Paused session is ignored entirely — and fires after Resume (11 C9)', () => {
  const paused = sessionOf(step(started(), { type: 'Pause' }, NOW, CONFIG));
  const withFix = sessionOf(step(paused, fix(), NOW, CONFIG));
  const ignored = step(withFix, dwell('stop-plain'), NOW + 1, CONFIG);
  const state = sessionOf(ignored);
  assert.deepEqual(state.autoFired, [], 'no automatic attempt while the walk is paused');
  assert.equal(state.queued, null);
  assert.deepEqual(ignored.commands, [], 'nothing plays by itself');
  const resumed = sessionOf(step(state, { type: 'Resume' }, NOW + 2, CONFIG));
  const fired = step(resumed, dwell('stop-plain'), NOW + 3, CONFIG);
  assert.equal(plays(fired), true, 'the same zone entry plays after Resume');
  assert.deepEqual(sessionOf(fired).autoFired, ['stop-plain']);
});

test('criterion 1 (§4.8.2): a trigger under a suspended automation gives manual access, not a play', () => {
  // The setter events of invariant 7 (UserPausedAudio, FocusLoss, …) belong
  // to G05.01.c — the flag is arranged on the session state directly here.
  const suspended: RunSessionState = { ...started(), autoplaySuspended: true };
  const fixed = sessionOf(step(suspended, fix(), NOW, CONFIG));
  const result = step(fixed, dwell('stop-plain'), NOW + 1, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.autoFired, ['stop-plain'], 'the attempt is over — manual access (11 C5)');
  assert.equal(state.queued, null, 'the suspension outcome is not the queue outcome');
  assert.deepEqual(result.commands, [], 'nothing plays by itself');
  assert.equal(stopStatus(state, 'stop-plain'), 'available', 'available immediately (11 C5)');
});

test('criterion 1 (§4.8.3): a trigger while the player is busy goes to the queue, not auto_fired (11 C8)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const result = step(playing, dwell('stop-crane'), NOW + 1, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.queued, { stopId: 'stop-crane', radius: 30, at: NOW + 1 }, 'queued for after the launch');
  assert.deepEqual(state.autoFired, [], 'queueing touches no auto_fired entry');
  assert.equal(plays(result), false, 'the new trigger does not interrupt the launch');
});

test('criterion 1 (§4.8.4): a stop with a burned attempt is ignored — the invariant «never twice»', () => {
  const suspended: RunSessionState = { ...started(), autoplaySuspended: true };
  const fixed = sessionOf(step(suspended, fix(), NOW, CONFIG));
  const fired = sessionOf(step(fixed, dwell('stop-plain'), NOW + 1, CONFIG));
  assert.deepEqual(fired.autoFired, ['stop-plain']);
  const result = step(fired, dwell('stop-plain'), NOW + 2, CONFIG);
  assert.deepEqual(sessionOf(result).autoFired, ['stop-plain'], 'no second entry, no second attempt');
  assert.deepEqual(result.commands, []);
});

test('criterion 1 (§4.8.4, proof): a primary heard by hand beforehand never auto-replays (11 C12)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const heard = finished(playing);
  assert.deepEqual(heard.heard, ['story-plain-base']);
  const result = step(heard, dwell('stop-plain'), NOW + 2, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.autoFired, [], 'the primary is in heard — no automatic attempt');
  assert.deepEqual(result.commands, [], 'automation stays silent');
  assert.equal(stopStatus(state, 'stop-plain'), 'played');
});

test('criterion 1 (§4.8.4): an additional story in heard does not block the primary autotrigger', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const unlocked = sessionOf(step(fixed, accessReady({ stopIds: ['stop-crane'] }), NOW, CONFIG));
  const ext = sessionOf(
    step(unlocked, { type: 'UserSelectedStory', stopId: 'stop-crane', storyId: 'story-crane-ext' }, NOW, CONFIG),
  );
  const heard = finished(ext);
  assert.deepEqual(heard.heard, ['story-crane-ext']);
  const result = step(heard, dwell('stop-crane'), NOW + 1, CONFIG);
  const command = result.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(command && 'storyId' in command && command.storyId === 'story-crane-base', 'the primary base story plays');
});

test('criterion 1 (§4.8.5): a stale fix, an over-accurate fix and a lost fix give no automatic play', () => {
  const stale = sessionOf(step(started(), fix({ age: 30_001 }), NOW, CONFIG));
  const staleResult = step(stale, dwell('stop-plain'), NOW, CONFIG);
  assert.deepEqual(sessionOf(staleResult).autoFired, [], 'a fix older than 30 s is no evidence');
  assert.deepEqual(staleResult.commands, []);

  const inaccurate = sessionOf(step(started(), fix({ accuracy: 31 }), NOW, CONFIG));
  const inaccurateResult = step(inaccurate, dwell('stop-plain'), NOW, CONFIG);
  assert.deepEqual(inaccurateResult.commands, [], 'accuracy 31 m over a 30 m radius is no evidence');

  const lostResult = step(started(), dwell('stop-plain'), NOW, CONFIG);
  assert.deepEqual(lostResult.commands, [], 'no fix at all — nothing may play');
});

test('criterion 1 (§4.8.5): the inclusive freshness and accuracy bounds pass a boundary fix', () => {
  const boundary = sessionOf(step(started(), fix({ age: 30_000, accuracy: 30 }), NOW, CONFIG));
  const result = step(boundary, dwell('stop-plain'), NOW, CONFIG);
  assert.equal(plays(result), true, 'age exactly 30 000 ms and accuracy exactly the radius hold');
});

test('criterion 1 (§4.8.6): a locked stop is ignored with no auto_fired entry (11 C33)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const gate = step(fixed, dwell('stop-gate'), NOW + 1, CONFIG);
  assert.deepEqual(sessionOf(gate).autoFired, [], 'the paid-only locked stop stays out of auto_fired');
  assert.deepEqual(gate.commands, [], 'a locked stop never plays by automation');
  const control = step(fixed, dwell('stop-crane'), NOW + 1, CONFIG);
  assert.equal(plays(control), true, 'the accessible stop fires — the negative is the locked one only');
});

test('criterion 2: auto_fired and heard are monotonic across outcomes', () => {
  const suspended: RunSessionState = { ...started(), autoplaySuspended: true };
  const fixed = sessionOf(step(suspended, fix(), NOW, CONFIG));
  const afterFired = sessionOf(step(fixed, dwell('stop-plain'), NOW + 1, CONFIG));
  assert.deepEqual(afterFired.autoFired, ['stop-plain'], 'the suspension outcome — manual access');

  const unlocked = sessionOf(step(afterFired, accessReady({ stopIds: ['stop-gate'] }), NOW + 2, CONFIG));
  assert.deepEqual(unlocked.autoFired, ['stop-plain'], 'the unlock removes nothing');

  const playing = sessionOf(step(unlocked, { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW + 2, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-gate'), NOW + 3, CONFIG));
  assert.deepEqual(queued.autoFired, ['stop-plain'], 'queueing adds nothing');

  const deferred = sessionOf(
    step(queued, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 3, CONFIG),
  );
  assert.deepEqual(
    deferred.autoFired,
    ['stop-plain', 'stop-gate'],
    'the deferred play registers its automatic attempt',
  );
  assert.ok(deferred.playing && deferred.playing.owner === 'guide' && deferred.playing.storyId === 'story-gate-ext');

  const heardGate = finished(deferred);
  assert.deepEqual(heardGate.heard, ['story-crane-base', 'story-gate-ext'], 'the manual launch was finished by the same completion');
  assert.deepEqual(heardGate.autoFired, ['stop-plain', 'stop-gate'], 'both attempts survive');
});

test('criterion 2: a manual replay after played is allowed and credits nothing new (R03)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const heard = finished(playing);
  assert.deepEqual(heard.heard, ['story-plain-base']);

  const replay = step(heard, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW + 1, CONFIG);
  const command = replay.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(command && 'playId' in command && command.playId === 2, 'a fresh launch, play_seq +1');
  const state = sessionOf(replay);
  assert.deepEqual(state.heard, ['story-plain-base'], 'no second heard entry before a real completion');
  assert.equal(state.playSeq, 2);

  const again = finished(state);
  assert.deepEqual(again.heard, ['story-plain-base'], 'the same story is never listed twice');
  assert.equal(stopStatus(again, 'stop-plain'), 'played');
});

test('criterion 2 (11 C7): an interrupted replay keeps the heard fact', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const heard = finished(playing);
  const replay = sessionOf(step(heard, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW + 1, CONFIG));
  assert.equal(replay.playSeq, 2, 'the replay launch is live');

  const interrupted = step(replay, { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW + 2, CONFIG);
  const state = sessionOf(interrupted);
  assert.deepEqual(state.heard, ['story-plain-base'], 'the interruption is not a completion');
  assert.equal(stopStatus(state, 'stop-plain'), 'played', 'the fact survives');
  assert.ok(
    state.playing && state.playing.owner === 'guide' && state.playing.stopId === 'stop-crane',
    'the new launch sounds',
  );
  assert.equal(
    interrupted.commands.filter((command) => command.type === 'StopAudio').length,
    1,
    'one physical player: the replay is stopped by command',
  );
});

test('criterion 3: the queue is one cell — the newest other stop wins, the displaced goes to auto_fired (11 C21)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const unlocked = sessionOf(step(fixed, accessReady({ stopIds: ['stop-gate'] }), NOW, CONFIG));
  const playing = sessionOf(step(unlocked, { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW, CONFIG));

  const first = sessionOf(step(playing, dwell('stop-plain'), NOW + 1, CONFIG));
  assert.deepEqual(first.queued, { stopId: 'stop-plain', radius: 30, at: NOW + 1 });

  const second = sessionOf(step(first, dwell('stop-gate'), NOW + 2, CONFIG));
  assert.deepEqual(second.queued, { stopId: 'stop-gate', radius: 30, at: NOW + 2 }, 'the newest trigger holds the cell');
  assert.deepEqual(second.autoFired, ['stop-plain'], 'the displaced attempt is over — manual access');
  assert.equal(stopStatus(second, 'stop-plain'), 'available', 'the status is computed per 11 §3.1');
});

test('criterion 3: a stop never displaces itself in the queue cell', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-crane'), NOW + 1, CONFIG));
  const repeated = sessionOf(step(queued, dwell('stop-crane'), NOW + 2, CONFIG));
  assert.deepEqual(repeated.queued, { stopId: 'stop-crane', radius: 30, at: NOW + 1 }, 'the first record holds');
  assert.deepEqual(repeated.autoFired, [], 'no displacement happened');
});

test('criterion 3: after AudioFinished the queued stop plays when the contract still holds', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-crane'), NOW + 1, CONFIG));

  const result = step(queued, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 2, CONFIG);
  const command = result.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(
    command && 'storyId' in command && 'playId' in command && command.storyId === 'story-crane-base' && command.playId === 2,
    'the deferred trigger plays its primary with a fresh play_id',
  );
  const state = sessionOf(result);
  assert.deepEqual(state.autoFired, ['stop-crane'], 'the deferred play registers its attempt');
  assert.equal(state.queued, null);
  assert.deepEqual(state.heard, ['story-plain-base']);
});

test('criterion 3: the deferred re-check bounds are inclusive — exactly 30 000 ms, the radius, 2 × radius', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-crane'), NOW, CONFIG));
  // The human walked away: the newest evidence sits exactly at every bound,
  // accepted at the same injected `now` the completion arrives at.
  const boundary = sessionOf(
    step(queued, fix({ age: 30_000, accuracy: 30, distance: 60 }), NOW, CONFIG),
  );
  const result = step(boundary, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW, CONFIG);
  assert.equal(plays(result), true, 'every bound holds at equality');
});

test('criterion 3: past any deferred bound the stop does not play and retires to auto_fired (11 C22)', () => {
  const cases = [
    { name: 'stale fix', override: { age: 30_001 } },
    { name: 'accuracy past the radius', override: { accuracy: 31 } },
    { name: 'distance past 2 × radius', override: { distance: 61 } },
  ];
  for (const { name, override } of cases) {
    const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
    const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
    const queued = sessionOf(step(playing, dwell('stop-crane'), NOW, CONFIG));
    const drifted = sessionOf(step(queued, fix(override), NOW, CONFIG));

    const result = step(drifted, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW, CONFIG);
    assert.equal(plays(result), false, `${name}: the deferred trigger does not play`);
    const state = sessionOf(result);
    assert.deepEqual(state.autoFired, ['stop-crane'], `${name}: the attempt is over — manual access`);
    assert.equal(state.queued, null, `${name}: the cell is empty`);
    assert.deepEqual(state.heard, ['story-plain-base'], `${name}: the finished story is still credited`);
  }
});

test('criterion 3: a primary heard by hand while queued stops the deferred play — the stop retires (11 §5.3)', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-crane'), NOW + 1, CONFIG));

  const byHand = sessionOf(step(queued, { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW + 2, CONFIG));
  assert.ok(
    byHand.playing && byHand.playing.owner === 'guide' && byHand.playing.stopId === 'stop-crane',
    'the human took the stop by hand',
  );
  const result = step(byHand, { type: 'AudioFinished', sessionId: 'session-1', playId: 2 }, NOW + 3, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.heard, ['story-crane-base'], 'heard by hand to the end');
  assert.deepEqual(state.autoFired, ['stop-crane'], 'the queue does not replay it');
  assert.equal(state.queued, null);
  assert.equal(stopStatus(state, 'stop-crane'), 'played', 'the status stays computed');
});

test('criterion 4: the three not-played outcomes stay distinct (11 §5.1.1)', () => {
  const arrange = (): RunSessionState => {
    const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
    return sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  };

  const busy = sessionOf(step(arrange(), dwell('stop-crane'), NOW + 1, CONFIG));
  assert.ok(busy.queued, 'player busy: the trigger waits in the cell');
  assert.deepEqual(busy.autoFired, [], '…and auto_fired is untouched');

  const suspended: RunSessionState = { ...arrange(), autoplaySuspended: true };
  const manualAccess = sessionOf(step(suspended, dwell('stop-crane'), NOW + 1, CONFIG));
  assert.deepEqual(manualAccess.autoFired, ['stop-crane'], 'suspended: manual access, checked before the occupancy');
  assert.equal(manualAccess.queued, null, '…never the queue branch');

  const paused = sessionOf(step(arrange(), { type: 'Pause' }, NOW + 1, CONFIG));
  const snapshot = structuredClone(paused);
  const ignored = step(paused, dwell('stop-crane'), NOW + 2, CONFIG);
  assert.deepEqual(ignored.state, snapshot, 'inactive session: the trigger is ignored entirely');

  const active = arrange();
  const activeSnapshot = structuredClone(active);
  const stale = step(active, dwell('stop-crane'), NOW + 31_000, CONFIG);
  assert.deepEqual(stale.state, activeSnapshot, 'stale position: the trigger is ignored entirely');
});

test('criterion 4: a suspended automation keeps the queue from playing after a completion', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwell('stop-crane'), NOW + 1, CONFIG));
  // The suspension setters (UserPausedAudio, FocusLoss) are G05.01.c events;
  // the flag is arranged on the queued state directly here.
  const suspended: RunSessionState = { ...queued, autoplaySuspended: true };
  const result = step(suspended, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 2, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.autoFired, ['stop-crane'], 'the attempt is over, no longer queued');
  assert.equal(plays(result), false, 'nothing plays while the automation is suspended');
});

test('criterion 5: AudioFinished is accepted on the matching pair and credits the launch story', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const result = step(
    playing,
    { type: 'AudioFinished', sessionId: 'session-1', playId: 1, storyId: 'story-plain-base' },
    NOW + 1,
    CONFIG,
  );
  const state = sessionOf(result);
  assert.deepEqual(state.heard, ['story-plain-base']);
  assert.equal(state.playing, null);
});

test('criterion 5: a story_id present in the event must be the one playing', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const mismatch = step(
    playing,
    { type: 'AudioFinished', sessionId: 'session-1', playId: 1, storyId: 'story-crane-base' },
    NOW + 1,
    CONFIG,
  );
  const state = sessionOf(mismatch);
  assert.deepEqual(state.heard, [], 'a foreign story is not credited');
  assert.ok(state.playing, 'the launch is not finished by a foreign completion');
  assert.deepEqual(mismatch.commands, [], 'no queue start from a rejected completion');
});

test('criterion 5 (11 C10): a late callback from the previous walk is ignored entirely', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const heard = finished(playing);
  sessionOf(step(heard, { type: 'End' }, NOW + 1, CONFIG));

  const second = sessionOf(step(initialRunState, startEvent({ sessionId: 'session-2' }), NOW + 2, CONFIG));
  const relaunch = sessionOf(step(second, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW + 2, CONFIG));
  assert.equal(relaunch.playSeq, 1, 'play_id restarts per session — the pair, not the value, identifies');

  const staleSession = step(relaunch, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 3, CONFIG);
  assert.ok(sessionOf(staleSession).playing, 'the previous walk may not finish the new launch');
  const unminted = step(relaunch, { type: 'AudioFinished', sessionId: 'session-2', playId: 2 }, NOW + 3, CONFIG);
  assert.ok(sessionOf(unminted).playing, 'a play_id that was never minted finishes nothing');
  const accepted = finished(relaunch);
  assert.deepEqual(accepted.heard, ['story-plain-base']);
});

test('criterion 5: a stale play_id of a manual replay does not finish the current launch', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const first = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const heard = finished(first);
  const replay = sessionOf(step(heard, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW + 1, CONFIG));

  const stale = step(replay, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 2, CONFIG);
  const state = sessionOf(stale);
  assert.ok(
    state.playing && state.playing.owner === 'guide' && state.playing.playId === 2,
    'the replay launch is not finished by the first play_id',
  );
  assert.deepEqual(state.heard, ['story-plain-base'], 'no change from the stale callback');
  const accepted = finished(replay);
  assert.deepEqual(accepted.heard, ['story-plain-base'], 'the story is never listed twice');
});

test('criterion 5: play_seq grows by one per PlayStory and rides every command', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const first = step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  const firstCommand = first.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(firstCommand && 'playId' in firstCommand && firstCommand.playId === 1);

  const second = step(sessionOf(first), { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW + 1, CONFIG);
  const secondCommand = second.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(secondCommand && 'playId' in secondCommand && secondCommand.playId === 2, 'a replacement launch is still +1');
  assert.equal(sessionOf(second).playSeq, 2);
});

test('criterion 6 (P01, 11 C36): the same-version unlock credits nothing and starts nothing', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-crane' }, NOW, CONFIG));
  const heard = finished(playing);
  assert.deepEqual(heard.heard, ['story-crane-base']);

  const result = step(heard, accessReady({ stopIds: ['stop-crane'] }), NOW + 1, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(state.heard, ['story-crane-base'], 'the extended story is not credited by the unlock');
  assert.equal(plays(result), false, 'audio is never started by the unlock');
  assert.deepEqual(
    state.autoFired,
    heard.autoFired,
    'the progress sets are untouched by the unlock',
  );
  assert.deepEqual(
    missedStories(state),
    ['story-crane-ext', 'story-plain-base'],
    'the additional story appears in «Яшчэ можна адкрыць» beside the untouched stop',
  );
  assert.equal(stopStatus(state, 'stop-crane'), 'played', 'the marker follows the primary story');
});

test('criterion 6 (P01, 11 C37): the extended story plays only through UserSelectedStory', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const unlocked = sessionOf(step(fixed, accessReady({ stopIds: ['stop-crane'] }), NOW, CONFIG));

  const firstDwell = step(unlocked, dwell('stop-crane'), NOW + 1, CONFIG);
  const command = firstDwell.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(
    command && 'storyId' in command && command.storyId === 'story-crane-base',
    'dwell launches the primary, never the additional story',
  );
  const baseHeard = finished(sessionOf(firstDwell));

  const secondDwell = step(baseHeard, dwell('stop-crane'), NOW + 2, CONFIG);
  assert.equal(
    plays(secondDwell),
    false,
    'the heard base is not replayed and the additional story never self-starts',
  );

  const manual = step(baseHeard, { type: 'UserSelectedStory', stopId: 'stop-crane', storyId: 'story-crane-ext' }, NOW + 2, CONFIG);
  const manualCommand = manual.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(
    manualCommand && 'storyId' in manualCommand && manualCommand.storyId === 'story-crane-ext',
    'the explicit button is the only way',
  );
  const done = finished(sessionOf(manual));
  assert.deepEqual(done.heard, ['story-crane-base', 'story-crane-ext'], 'heard separately from the primary');
  assert.equal(stopStatus(done, 'stop-crane'), 'played', 'the marker stays with the primary');
  assert.deepEqual(
    missedStories(done),
    ['story-plain-base'],
    'only the untouched stop still has an open story',
  );
});

test('criterion 6 (11 C33): a locked stop never plays by hand or automation and never enters the lists', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const snapshot = structuredClone(fixed);

  const byStop = step(fixed, { type: 'UserSelectedStop', stopId: 'stop-gate' }, NOW + 1, CONFIG);
  assert.deepEqual(byStop.state, snapshot, 'a locked primary refuses the manual play');
  const byStory = step(fixed, { type: 'UserSelectedStory', stopId: 'stop-gate', storyId: 'story-gate-ext' }, NOW + 1, CONFIG);
  assert.deepEqual(byStory.state, snapshot, 'a locked story refuses the named play');
  const byDwell = step(fixed, dwell('stop-gate'), NOW + 1, CONFIG);
  assert.deepEqual(byDwell.state, snapshot, 'a locked stop ignores the trigger with no auto_fired entry');
  assert.deepEqual(
    missedStories(fixed),
    ['story-crane-base', 'story-plain-base'],
    'locked stories are excluded from «Яшчэ можна адкрыць»',
  );
});

test('criterion 6 (§4.4): a paid-only stop becomes a normal eligible stop after the unlock', () => {
  const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
  const unlocked = sessionOf(step(fixed, accessReady({ stopIds: ['stop-gate'] }), NOW, CONFIG));
  const result = step(unlocked, dwell('stop-gate'), NOW + 1, CONFIG);
  const command = result.commands.find((entry) => entry.type === 'PlayStory');
  assert.ok(
    command && 'storyId' in command && command.storyId === 'story-gate-ext',
    'the primary extended story auto-plays by the general rules',
  );
});

test('criterion 7 (11 C31): all six permutations of three stops play without an order check', () => {
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
          permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
        );
  const stops = ['stop-crane', 'stop-plain', 'stop-gate'];
  const primaries: Record<string, string> = {
    'stop-crane': 'story-crane-base',
    'stop-plain': 'story-plain-base',
    'stop-gate': 'story-gate-ext',
  };

  for (const order of permutations(stops)) {
    const fixed = sessionOf(step(started(), fix(), NOW, CONFIG));
    const unlocked = sessionOf(step(fixed, accessReady({ stopIds: ['stop-gate'] }), NOW, CONFIG));
    let state = unlocked;
    for (const [index, stopId] of order.entries()) {
      const fired = step(state, dwell(stopId), NOW + index + 1, CONFIG);
      const command = fired.commands.find((entry) => entry.type === 'PlayStory');
      assert.ok(
        command && 'storyId' in command && command.storyId === primaries[stopId],
        `${order.join(' → ')}: ${stopId} plays its primary`,
      );
      state = finished(sessionOf(fired));
    }
    assert.deepEqual(
      [...state.heard].sort(),
      Object.values(primaries).sort(),
      `${order.join(' → ')}: all three heard`,
    );
    assert.deepEqual(
      [...state.autoFired].sort(),
      [...stops].sort(),
      `${order.join(' → ')}: all three attempts registered`,
    );
    assert.equal(state.phase, 'Active', `${order.join(' → ')}: the last number does not end the session`);
    assert.equal(state.playSeq, 3, `${order.join(' → ')}: one launch per stop`);
  }
});
