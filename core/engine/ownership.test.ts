// G05.01.c — acceptance suite for the audio-ownership transitions (issue #199,
// docs/agent-tasks/run/G05.01.c.md, ADR G01.02 §3).
// Criteria:
// 1. `playing` has guide | moment variants and the token is {kind, ref, seq};
//    a callback with a non-matching token is ignored entirely (no heard, no
//    stop, no queue start) — one test per callback kind.
// 2. An explicit PlayMoment stops the guide by command (not as finished),
//    clears the queue and suspends automation until GuideResume;
//    MomentFinished never mutates heard.
// 3. FocusLoss is never AudioFinished; FocusRegain more than 10 min after
//    focus_lost_at closes the play, within 10 min ResumeAudio continues the
//    same token; a manual pause has no threshold.
// 4. autoplay_suspended is set and cleared only by the events of invariant 7;
//    ResumeAudio on a moment does not clear it.
// 5. Session Pause and End stop only guide audio; Start while a moment plays
//    injects playingNow and waits for the player to be free.
// Proof: making MomentFinished credit the story turns the teaser test red.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG, NOW, sessionOf, startEvent, started, STOPS } from './fixtures.ts';
import { step } from './reducer.ts';
import { initialRunState, missedStories, stopStatus, type PlayToken, type RunSessionState } from './state.ts';
import type { RunEvent } from './events.ts';

// The synthetic moment of ADR G01.02 §4: teaser story story-m9, the controller
// mints the token (here: process-wide counter at an arbitrary seq).
const MOMENT = { momentId: 'moment-9', storyId: 'story-m9' };
const momentToken = (seq: number): PlayToken => ({ kind: 'moment', ref: MOMENT.momentId, seq });
const playMoment = (seq = 1): RunEvent => ({
  type: 'PlayMoment',
  ...MOMENT,
  token: momentToken(seq),
});
const momentFinished = (seq = 1): RunEvent => ({
  type: 'MomentFinished',
  token: momentToken(seq),
  ...MOMENT,
});
const resumeAudio = (token: PlayToken): RunEvent => ({ type: 'ResumeAudio', token });
const guideToken = (playId: number): PlayToken => ({ kind: 'guide', ref: 'session-1', seq: playId });

const commandOf = (
  result: { commands: { type: string }[] },
  type: string,
): { type: string } | undefined => result.commands.find((entry) => entry.type === type);

// A live guide launch of the plain stop's primary, reached through the
// production manual-play path (play_seq 1).
const guidePlaying = (): RunSessionState => {
  const state = sessionOf(
    step(started(), { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG),
  );
  assert.ok(state.playing && state.playing.owner === 'guide');
  return state;
};

// A live moment launch (over a playing guide — the ownership switch of §3.4).
const momentPlaying = (): RunSessionState => {
  const state = sessionOf(step(guidePlaying(), playMoment(7), NOW, CONFIG));
  assert.ok(state.playing && state.playing.owner === 'moment');
  return state;
};

const fixEvent = (): RunEvent => ({
  type: 'LocationAccepted',
  fix: {
    lat: 54.35,
    lng: 18.65,
    accuracy: 5,
    at: NOW,
    distances: new Map(STOPS.map((stop) => [stop.stopId, 5])),
  },
});

const dwellEvent = (stopId: string): RunEvent => ({ type: 'DwellCompleted', stopId, radius: 30 });

test('criterion 1: the guide token is the (session_id, play_id) pair and rides the command', () => {
  const result = step(started(), { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG);
  const command = commandOf(result, 'PlayStory');
  assert.ok(command && 'token' in command);
  assert.deepEqual((command as { token: PlayToken }).token, guideToken(1));
  assert.equal(sessionOf(result).playSeq, 1);
});

test('criterion 1: a moment launch echoes the controller token, never mints one', () => {
  const result = step(started(), playMoment(7), NOW, CONFIG);
  const command = commandOf(result, 'PlayMoment');
  assert.ok(command && 'token' in command);
  assert.deepEqual((command as { token: PlayToken }).token, momentToken(7), 'the seq is echoed, not re-counted');
  const state = sessionOf(result);
  assert.deepEqual(state.playing, { owner: 'moment', ...MOMENT, seq: 7, paused: false });
});

test('criterion 1 (finished, guide): a late AudioFinished of a replaced launch is rejected entirely', () => {
  // The guide launch is replaced by a moment: its token is dead from the stop
  // command on — a late completion may not credit the story or start anything.
  const state = momentPlaying();
  const late = step(state, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 1, CONFIG);
  const after = sessionOf(late);
  assert.deepEqual(after.heard, [], 'no heard credit from a stopped launch');
  assert.deepEqual(after.autoFired, [], 'no queue start from a foreign completion');
  assert.ok(after.playing && after.playing.owner === 'moment', 'the moment launch is untouched');
  assert.deepEqual(late.commands, []);
});

test('criterion 1 (finished, moment): a MomentFinished with a stale token is ignored', () => {
  const state = momentPlaying();
  const stale = step(state, momentFinished(6), NOW + 1, CONFIG);
  assert.deepEqual(stale.state, state, 'an old moment token frees nothing, changes nothing');
  assert.deepEqual(stale.commands, []);
});

test('criterion 1 (error): an AudioFailed with a stale token is ignored', () => {
  const state = momentPlaying();
  const stale = step(state, { type: 'AudioFailed', token: momentToken(6), reason: 'decode' }, NOW + 1, CONFIG);
  assert.deepEqual(stale.state, state, 'a foreign failure neither frees the player nor suspends');
  assert.deepEqual(stale.commands, []);
});

test('criterion 1 (resume): a ResumeAudio with a stale token is a refusal, not a resume', () => {
  const paused = sessionOf(step(guidePlaying(), { type: 'UserPausedAudio' }, NOW, CONFIG));
  const stale = step(paused, resumeAudio(guideToken(2)), NOW + 1, CONFIG);
  const state = sessionOf(stale);
  assert.ok(state.playing && state.playing.paused, 'the launch stays paused');
  assert.deepEqual(stale.commands, [], 'no resume command for a token that was never minted');
  assert.equal(state.autoplaySuspended, true, 'the suspension is not lifted by a refusal');
});

test('criterion 1 (focus): a FocusLoss is a physical event — it is never token-gated', () => {
  const state = sessionOf(step(momentPlaying(), { type: 'FocusLoss' }, NOW, CONFIG));
  assert.ok(state.playing && state.playing.paused, 'the launch survives as a live pause');
  assert.equal(state.focusLostAt, NOW);
});

test('criterion 2 (P02): an explicit PlayMoment stops the guide by command and retires the queue', () => {
  // Arrange: guide playing with a queued stop (busy outcome of the autotrigger).
  const fixed = sessionOf(step(started(), fixEvent(), NOW, CONFIG));
  const playing = sessionOf(step(fixed, { type: 'UserSelectedStop', stopId: 'stop-plain' }, NOW, CONFIG));
  const queued = sessionOf(step(playing, dwellEvent('stop-crane'), NOW + 1, CONFIG));
  assert.ok(queued.queued, 'the trigger waits in the cell');

  const result = step(queued, playMoment(7), NOW + 2, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(
    result.commands.map((entry) => entry.type),
    ['StopAudio', 'PlayMoment'],
    'the guide is stopped by command — never as finished',
  );
  assert.deepEqual(state.heard, [], 'the interrupted guide story is not credited');
  assert.deepEqual(state.autoFired, ['stop-crane'], 'the queue retires: the attempt is over (§3.6.2)');
  assert.equal(state.queued, null);
  assert.equal(state.autoplaySuspended, true);
  assert.ok(state.playing && state.playing.owner === 'moment');
});

test('criterion 2 (proof): MomentFinished never mutates heard and never restores automation', () => {
  const state = momentPlaying();
  const result = step(state, momentFinished(7), NOW + 1, CONFIG);
  const after = sessionOf(result);
  assert.equal(after.playing, null, 'the player is free');
  assert.deepEqual(after.heard, [], 'a moment launch never credits guide history (story-m9 teaser)');
  assert.equal(after.autoplaySuspended, true, 'the automation is not restored by the moment end');
  assert.deepEqual(result.commands, [], 'nothing sounds and no queue starts (§3.6.3)');
  assert.deepEqual(
    missedStories(after),
    ['story-crane-base', 'story-plain-base'],
    'story-m9 is not part of the route stories',
  );
});

test('criterion 2: GuideResume is the single way back and sounds nothing by itself', () => {
  const endedMoment = sessionOf(step(momentPlaying(), momentFinished(7), NOW + 1, CONFIG));
  const resumed = step(endedMoment, { type: 'GuideResume' }, NOW + 2, CONFIG);
  const state = sessionOf(resumed);
  assert.equal(state.autoplaySuspended, false);
  assert.deepEqual(resumed.commands, [], '«Працягнуць гід» itself is silent');
  // The next trigger runs the general conditions again — and plays.
  const fixed = sessionOf(step(state, fixEvent(), NOW + 3, CONFIG));
  const fired = step(fixed, dwellEvent('stop-plain'), NOW + 4, CONFIG);
  assert.equal(commandOf(fired, 'PlayStory') !== undefined, true, 'the automation works after the resume');
});

test('criterion 3: FocusLoss is a live pause of any owner — never AudioFinished', () => {
  const state = sessionOf(step(guidePlaying(), { type: 'FocusLoss' }, NOW, CONFIG));
  assert.ok(state.playing && state.playing.paused, 'the same token and offset live on');
  assert.equal(state.focusLostAt, NOW, 'the threshold is armed');
  assert.equal(state.autoplaySuspended, true);
  assert.deepEqual(state.heard, [], 'a physical interruption is not a completion');
  assert.equal(stopStatus(state, 'stop-plain'), 'pending', 'the marker follows the audible state');
});

test('criterion 3: within the window the launch stays live — ResumeAudio continues the same token', () => {
  const lost = sessionOf(step(guidePlaying(), { type: 'FocusLoss' }, NOW, CONFIG));
  // Exactly at the threshold the launch is still live (the comparison is >).
  const regained = sessionOf(step(lost, { type: 'FocusRegain' }, NOW + CONFIG.focusRegainWindowMs, CONFIG));
  assert.ok(regained.playing && regained.playing.paused, 'boundary: the pause survives');
  const resumed = step(regained, resumeAudio(guideToken(1)), NOW + CONFIG.focusRegainWindowMs + 1, CONFIG);
  const state = sessionOf(resumed);
  assert.ok(state.playing && !state.playing.paused, 'the same launch continues');
  assert.deepEqual(
    resumed.commands,
    [{ type: 'ResumeAudio', token: guideToken(1) }],
    'the resume rides the same token',
  );
  assert.equal(state.autoplaySuspended, false, 'a guide resume lifts the suspension');
});

test('criterion 3: past the 10-minute threshold the launch is closed — resume is a refusal', () => {
  const lost = sessionOf(step(guidePlaying(), { type: 'FocusLoss' }, NOW, CONFIG));
  const regained = sessionOf(step(lost, { type: 'FocusRegain' }, NOW + CONFIG.focusRegainWindowMs + 1, CONFIG));
  assert.equal(regained.playing, null, 'the player gave the file back');
  const refused = step(regained, resumeAudio(guideToken(1)), NOW + CONFIG.focusRegainWindowMs + 2, CONFIG);
  assert.deepEqual(refused.commands, [], 'a closed token is a refused command, not a resume');
  assert.equal(sessionOf(refused).focusLostAt, null);
  // A later listen is a fresh launch with a new token.
  const replay = step(
    regained,
    { type: 'UserSelectedStop', stopId: 'stop-plain' },
    NOW + CONFIG.focusRegainWindowMs + 3,
    CONFIG,
  );
  const command = commandOf(replay, 'PlayStory');
  assert.ok(command && 'token' in command && 'playId' in command);
  assert.deepEqual((command as { token: PlayToken }).token, guideToken(2), 'new launch, new token');
});

test('criterion 3: a manual pause has no threshold', () => {
  const paused = sessionOf(step(guidePlaying(), { type: 'UserPausedAudio' }, NOW, CONFIG));
  const resumed = step(paused, resumeAudio(guideToken(1)), NOW + 3_600_000, CONFIG);
  const state = sessionOf(resumed);
  assert.ok(
    state.playing && !state.playing.paused,
    'the human chose the pause — it lives until their next action',
  );
  assert.equal(state.autoplaySuspended, false);
});

test('criterion 3: a manual stop closes the launch and suspends automation', () => {
  const result = step(guidePlaying(), { type: 'UserStoppedAudio' }, NOW + 1, CONFIG);
  const state = sessionOf(result);
  assert.deepEqual(result.commands, [{ type: 'StopAudio', token: guideToken(1) }]);
  assert.equal(state.playing, null);
  assert.equal(state.focusLostAt, null);
  assert.equal(state.autoplaySuspended, true);
});

test('criterion 4: the suspension is set and cleared only by the invariant-7 events', () => {
  let state = sessionOf(step(started(), playMoment(7), NOW, CONFIG));
  assert.equal(state.autoplaySuspended, true, 'Play Moment sets the flag');
  state = sessionOf(step(state, momentFinished(7), NOW + 1, CONFIG));
  assert.equal(state.autoplaySuspended, true, 'the moment end does not clear it');
  // A fresh moment launch: a paused moment resumed by tap — the launch
  // continues, the flag stays; its clearing belongs to «Працягнуць гід».
  state = sessionOf(step(state, playMoment(8), NOW + 2, CONFIG));
  state = sessionOf(step(state, { type: 'UserPausedAudio' }, NOW + 3, CONFIG));
  state = sessionOf(step(state, resumeAudio(momentToken(8)), NOW + 4, CONFIG));
  assert.ok(state.playing && !state.playing.paused, 'the moment launch continues');
  assert.equal(state.autoplaySuspended, true, 'a moment resume never clears the flag');
  state = sessionOf(step(state, { type: 'GuideResume' }, NOW + 5, CONFIG));
  assert.equal(state.autoplaySuspended, false, '«Працягнуць гід» is the single clearing after a Moment');
  // A failed launch suspends again: sound that never started gives the next
  // sound no start of its own (§3.5, story_play_failed).
  const failing = sessionOf(
    step(guidePlaying(), { type: 'AudioFailed', token: guideToken(1), reason: 'decode' }, NOW + 6, CONFIG),
  );
  assert.equal(failing.playing, null);
  assert.equal(failing.autoplaySuspended, true, 'story_play_failed suspends');
  assert.deepEqual(failing.heard, [], 'a launch that never sounded is not heard');
});

test('criterion 5: session Pause and End stop only guide audio', () => {
  const guidePaused = step(guidePlaying(), { type: 'Pause' }, NOW + 1, CONFIG);
  assert.equal(
    guidePaused.commands.some((entry) => entry.type === 'StopAudio'),
    true,
    'the guide launch is session property — it stops',
  );
  assert.equal(sessionOf(guidePaused).playing, null);

  const momentPaused = step(momentPlaying(), { type: 'Pause' }, NOW + 1, CONFIG);
  assert.equal(
    momentPaused.commands.some((entry) => entry.type === 'StopAudio'),
    false,
    'the moment is not session property — Pause does not touch it',
  );
  const momentState = sessionOf(momentPaused);
  assert.ok(momentState.playing && momentState.playing.owner === 'moment' && !momentState.playing.paused);
  assert.deepEqual(momentPaused.commands, [{ type: 'ClearGeofences' }]);
});

test('criterion 5: End during a moment keeps it live — its callbacks work, guide ones are rejected', () => {
  const ended = sessionOf(step(momentPlaying(), { type: 'End' }, NOW + 1, CONFIG));
  assert.equal(ended.phase, 'Ended');
  assert.ok(ended.playing && ended.playing.owner === 'moment', 'the moment keeps sounding');
  // A late guide completion has no live addressee — the pair is dead.
  const lateGuide = step(ended, { type: 'AudioFinished', sessionId: 'session-1', playId: 1 }, NOW + 2, CONFIG);
  assert.deepEqual(lateGuide.state, ended, 'no field mutates');
  // The moment still owns the player: its finish frees it even after End.
  const finished = step(ended, momentFinished(7), NOW + 3, CONFIG);
  const state = sessionOf(finished);
  assert.equal(state.phase, 'Ended', 'the session is not revived');
  assert.equal(state.playing, null, 'the player is freed');
  assert.deepEqual(state.heard, []);
});

test('criterion 5: Start injects a playing moment and the autotrigger waits for a free player', () => {
  const state = sessionOf(
    step(
      initialRunState,
      startEvent({ playingNow: { momentId: 'moment-9', storyId: 'story-m9', seq: 42 } }),
      NOW,
      CONFIG,
    ),
  );
  assert.deepEqual(state.playing, {
    owner: 'moment',
    momentId: 'moment-9',
    storyId: 'story-m9',
    seq: 42,
    paused: false,
  });
  assert.equal(state.playSeq, 0, 'Start mints no guide launch');
  // The player is busy: a trigger goes to the queue, not auto_fired (§3.3).
  const fixed = sessionOf(step(state, fixEvent(), NOW + 1, CONFIG));
  const queued = sessionOf(step(fixed, dwellEvent('stop-plain'), NOW + 2, CONFIG));
  assert.ok(queued.queued, 'the trigger waits for the player to become free');
  assert.deepEqual(queued.autoFired, []);
  // The moment ends — the queue drains on a completion, not by itself.
  const freed = sessionOf(step(queued, momentFinished(42), NOW + 3, CONFIG));
  assert.equal(freed.playing, null);
  assert.ok(freed.queued, 'the queued stop stays queued — nothing sounds by itself');
  const fired = step(freed, dwellEvent('stop-plain'), NOW + 4, CONFIG);
  assert.equal(commandOf(fired, 'PlayStory') !== undefined, true, 'the next trigger plays by the general conditions');
});

test('criterion 5: a malformed playingNow is refused at the boundary', () => {
  for (const playingNow of [
    { momentId: '', storyId: 'story-m9', seq: 1 },
    { momentId: 'moment-9', storyId: '', seq: 1 },
    { momentId: 'moment-9', storyId: 'story-m9', seq: 0 },
    { momentId: 'moment-9', storyId: 'story-m9', seq: 1.5 },
  ]) {
    assert.throws(
      () => step(initialRunState, startEvent({ playingNow }), NOW, CONFIG),
      /playingNow must be a moment launch/,
      `refused: ${JSON.stringify(playingNow)}`,
    );
  }
});

test('criterion 5: a malformed PlayMoment event is refused without mutation', () => {
  const state = started();
  const snapshot = structuredClone(state);
  const foreignRef = step(
    state,
    { type: 'PlayMoment', ...MOMENT, token: { kind: 'moment', ref: 'moment-8', seq: 1 } },
    NOW + 1,
    CONFIG,
  );
  assert.deepEqual(foreignRef.state, snapshot, 'a token of another moment is not this launch');
  const badSeq = step(
    state,
    { type: 'PlayMoment', ...MOMENT, token: { kind: 'moment', ref: 'moment-9', seq: 0 } },
    NOW + 1,
    CONFIG,
  );
  assert.deepEqual(badSeq.state, snapshot, 'a non-positive seq is not a launch');
  const guideShape = step(state, { type: 'PlayMoment', ...MOMENT, token: guideToken(1) }, NOW + 1, CONFIG);
  assert.deepEqual(guideShape.state, snapshot, 'a guide token cannot start a moment');
});
