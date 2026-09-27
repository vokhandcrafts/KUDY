// G07.02 (issue #282) — the moment play controller suite over the real
// AudioService with the fake port (the G05.03.a harness idiom) and, for the
// proof, the real run orchestrator: the takeover of a sounding guide launch
// is the engine's own PlayMoment transition (§3.4) routed through the
// session port — the takeover test fails if the routing is reverted
// (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';

import { RunOrchestrator, type RunStop } from '../run/runOrchestrator.ts';
import { defaultEngineConfig } from '../../core/engine/reducer.ts';
import { AudioService } from '../../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../../services/audio/fake-port.ts';
import { FakeLocationOsPort } from '../../services/location/fake-port.ts';
import { LocationService } from '../../services/location/service.ts';
import { createMomentPlayController, type MomentPlayState } from './momentPlayController.ts';

const MOMENT_PATH = 'bundles/route-a/1/be/base/audio/s-1.m4a';
const STOPS: RunStop[] = [{ stopId: 'a', lat: 0, lng: 0, radius: 20, storyBaseId: 'a' }];

class ManualClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
  // The location watchdog's tick handle — irrelevant to these scenarios.
  schedule(): () => void {
    return () => {};
  }
}

// One process-wide moment counter (ADR G01.02 §3.2) the test hands to BOTH
// the controller and the orchestrator — the seq assertions below prove the
// sharing.
function sharedCounter(): { next: () => number; value: () => number } {
  let seq = 0;
  return { next: () => ++seq, value: () => seq };
}

function momentHarness(
  audio: AudioService,
  counter: { next: () => number },
  clock: ManualClock,
  sessionMoment?: { playMoment: (momentId: string, storyId: string) => boolean },
) {
  return createMomentPlayController({ audio, nextSeq: counter.next, sessionMoment, now: () => clock.now() });
}

function playOutcome(binding: ReturnType<typeof momentHarness>, momentId = 'm-1'): MomentPlayState {
  const outcome = binding.play({ momentId, storyId: 's-1', path: MOMENT_PATH });
  assert.ok(!('refused' in outcome), `unexpected refusal: ${JSON.stringify(outcome)}`);
  if ('refused' in outcome) throw new Error('unreachable');
  return binding.store.getState();
}

test('the idle play mints a moment token and drives the one player; finish releases', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const counter = sharedCounter();
  const controller = momentHarness(audio, counter, clock);

  const state = playOutcome(controller);
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`]);
  assert.deepEqual(state, {
    kind: 'playing',
    momentId: 'm-1',
    storyId: 's-1',
    token: { kind: 'moment', ref: 'm-1', seq: 1 },
    paused: false,
  });

  port.finish(1);
  assert.deepEqual(controller.store.getState(), { kind: 'idle' });
});

test('a failed launch is a visible failed state; foreign tokens are ignored entirely (§3.5)', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  playOutcome(controller, 'm-1');

  // A rogue late event of a replaced launch — the controller's own token is
  // the only accepted identity.
  port.fail(1, 'file gone');
  assert.deepEqual(controller.store.getState(), { kind: 'failed', reason: 'file gone' });

  // A foreign moment token (never minted here) changes nothing.
  playOutcome(controller, 'm-2');
  port.finish(99);
  const state = controller.store.getState();
  assert.ok(state.kind === 'playing');
  if (state.kind !== 'playing') return;
  assert.equal(state.momentId, 'm-2');
});

test('FocusLoss is a live pause; FocusRegain within 10 min offers Resume of the same token', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  playOutcome(controller);

  port.focusLoss();
  let state = controller.store.getState();
  assert.ok(state.kind === 'playing' && state.paused);
  if (state.kind !== 'playing') return;
  const token = state.token;

  clock.set(9 * 60 * 1000);
  port.focusRegain();
  state = controller.store.getState();
  assert.ok(state.kind === 'playing' && state.paused);

  controller.resume();
  // The physical fact the port reports — the service's resume command does
  // not emit; the port's report is the player's reality.
  port.reportResumed(1);
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`, 'resume']);
  state = controller.store.getState();
  assert.ok(state.kind === 'playing' && !state.paused);
  assert.ok(state.token && token && state.token.seq === token.seq);
});

test('FocusRegain past 10 min closes the launch — the player is released, the next Play is fresh (§3.7)', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  playOutcome(controller);
  port.focusLoss();
  // The physical fact after the interruption: the player holds a live pause.
  port.snapshotValue = { state: 'paused', positionMs: 1000, durationMs: 9000 };

  clock.set(10 * 60 * 1000 + 1);
  port.focusRegain();
  assert.deepEqual(controller.store.getState(), { kind: 'idle' });
  // The closed launch keeps no physical hold: the player is stopped by
  // command (otherwise the next Play would see a foreign launch and refuse).
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`, 'stop']);

  port.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 9000 };
  playOutcome(controller, 'm-1');
  const state = controller.store.getState();
  assert.ok(state.kind === 'playing');
  if (state.kind !== 'playing') return;
  assert.equal(state.token.seq, 2);
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`, 'stop', `play 2:${MOMENT_PATH}`]);
});

test('a repeat of the own launch is stopped by command and re-launched with a fresh token', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  playOutcome(controller);
  playOutcome(controller);
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`, 'stop', `play 2:${MOMENT_PATH}`]);
  assert.deepEqual(port.violations, []);
});

test('a launch without a published file is refused before any player command', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  const outcome = controller.play({ momentId: 'm-1', storyId: 's-1', path: null });
  assert.deepEqual(outcome, { refused: 'moment#audio-unpublished' });
  assert.deepEqual(port.commands, []);
  assert.deepEqual(controller.store.getState(), { kind: 'idle' });
});

test('a session-owned player without the session port is a named refusal — no second player', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock);
  // The physical state of a live walk: a guide launch sounds (the fake's
  // snapshot is scripted — the port's documented test contract).
  void audio.play({ token: { kind: 'guide', ref: 'walk-1', seq: 1 }, path: 'be/base/audio/a.m4a' });
  port.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 9000 };
  const outcome = controller.play({ momentId: 'm-1', storyId: 's-1', path: MOMENT_PATH });
  assert.deepEqual(outcome, { refused: 'moment#session-unroutable' });
  assert.deepEqual(port.commands, ['play 1:be/base/audio/a.m4a']);
  assert.deepEqual(port.violations, []);
});

test('a session port that declines leaves the state untouched (the named session-refused)', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const controller = momentHarness(audio, sharedCounter(), clock, { playMoment: () => false });
  void audio.play({ token: { kind: 'guide', ref: 'walk-1', seq: 1 }, path: 'be/base/audio/a.m4a' });
  port.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 9000 };
  const outcome = controller.play({ momentId: 'm-1', storyId: 's-1', path: MOMENT_PATH });
  assert.deepEqual(outcome, { refused: 'moment#session-refused' });
  assert.deepEqual(port.commands, ['play 1:be/base/audio/a.m4a']);
});

// --- the proof (criterion 1): the takeover of a sounding guide launch -------

interface ProofHarness {
  clock: ManualClock;
  port: FakeAudioPlayerPort;
  audio: AudioService;
  orchestrator: RunOrchestrator;
  controller: ReturnType<typeof momentHarness>;
}

// The live-walk builder over the ONE shared audio instance: the same shape
// the proof and the Start-inheritance scenarios use (a sibling copy is a
// jscpd clone).
function buildOrchestrator(
  audio: AudioService,
  clock: ManualClock,
  counter: { next: () => number },
  currentMomentPlay?: () => {
    readonly momentId: string;
    readonly storyId: string;
    readonly seq: number;
    readonly paused: boolean;
  } | null,
): RunOrchestrator {
  const location = new LocationService({
    port: new FakeLocationOsPort(),
    clock,
    permissions: { foreground: 'fg', background: 'bg' },
  });
  return new RunOrchestrator({
    location,
    audio,
    clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    route: { routeId: 'route-1', version: 'v1', locale: 'be', tier: ['base'] },
    stops: STOPS,
    nextMomentSeq: counter.next,
    currentMomentPlay,
  });
}

function proofHarness(withRouting: boolean): ProofHarness {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const counter = sharedCounter();
  // The idle controller over the ONE shared audio instance — the same
  // instance the orchestrator's session will hold.
  const controller = momentHarness(
    audio,
    counter,
    clock,
    withRouting
      ? {
          // The session entry the composition root wires (the live
          // session's orchestrator accepts the launch through its engine).
          playMoment: (momentId, storyId) => {
            orchestrator.playMoment(momentId, storyId);
            return true;
          },
        }
      : undefined,
  );
  const orchestrator = buildOrchestrator(audio, clock, counter);
  return { clock, port, audio, orchestrator, controller };
}

test('PROOF: a manual Play Moment over a sounding guide launch takes the player in one transition', () => {
  const h = proofHarness(true);
  h.orchestrator.start('walk-1');
  h.orchestrator.selectStop('a');
  // The guide story sounds: the engine's mirror is a guide launch and the
  // port's scripted snapshot reports the physical playing fact.
  h.port.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 9000 };
  // The orchestrator's state view is the live session (assert.ok narrows
  // the union the same way the runOrchestrator suite's live() helper does).
  const guideState = h.orchestrator.state;
  assert.ok(guideState.phase !== 'Idle');
  assert.equal(guideState.playing?.owner, 'guide');
  assert.deepEqual(h.port.commands, ['play 1:be/base/audio/a.m4a']);

  // The manual Play Moment from the place detail: routed through the live
  // session's engine — ONE transition, no intermediate silence-mirror state.
  const outcome = h.controller.play({ momentId: 'm-1', storyId: 's-1', path: MOMENT_PATH });
  assert.deepEqual(outcome, { outcome: 'routed' });

  // The physical player: the guide stopped by command, then the moment —
  // the one-player discipline held (no play-while-active violation).
  assert.deepEqual(h.port.commands, ['play 1:be/base/audio/a.m4a', 'stop', 'play 2:']);
  assert.deepEqual(h.port.violations, []);
  const physical = h.audio.playbackState();
  assert.ok(physical.kind === 'playing');
  if (physical.kind !== 'playing') return;
  // The shared process-wide counter's first use in this scenario.
  assert.deepEqual(physical.token, { kind: 'moment', ref: 'm-1', seq: 1 });

  // The engine mirror: the moment variant; the interrupted guide story is
  // NOT credited (a command stop is never finished, §3.4); the queue is
  // retired into auto_fired; the automation is suspended until «Працягнуць гід».
  const state = h.orchestrator.state;
  assert.ok(state.phase !== 'Idle');
  assert.deepEqual(state.playing, { owner: 'moment', momentId: 'm-1', storyId: 's-1', seq: 1, paused: false });
  assert.deepEqual(state.heard, []);
  assert.equal(state.autoplaySuspended, true);
  assert.equal(state.queued, null);

  // The controller released its own idle view — the mirror is the engine's.
  assert.deepEqual(h.controller.store.getState(), { kind: 'idle' });
});

test('the revert guard: without the session routing the same play is a named refusal', () => {
  const h = proofHarness(false);
  h.orchestrator.start('walk-1');
  h.orchestrator.selectStop('a');
  h.port.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 9000 };
  const outcome = h.controller.play({ momentId: 'm-1', storyId: 's-1', path: MOMENT_PATH });
  assert.deepEqual(outcome, { refused: 'moment#session-unroutable' });
  // No second player, no physical takeover.
  assert.deepEqual(h.port.commands, ['play 1:be/base/audio/a.m4a']);
});

test('Start inherits the sounding no-session Moment (ADR §3.8) instead of stopping it', () => {
  const clock = new ManualClock();
  const port = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => port });
  const counter = sharedCounter();
  const controller = momentHarness(audio, counter, clock);
  playOutcome(controller); // the no-session Moment sounds

  const orchestrator = buildOrchestrator(audio, clock, counter, () => {
    const state = controller.store.getState();
    return state.kind === 'playing'
      ? { momentId: state.momentId, storyId: state.storyId, seq: state.token.seq, paused: state.paused }
      : null;
  });
  orchestrator.start('walk-2');
  // The fresh session's mirror carries the moment variant — the first
  // autoplay waits for the player instead of stopping the teaser (§3.3).
  const inherited = orchestrator.state;
  assert.ok(inherited.phase !== 'Idle');
  assert.deepEqual(inherited.playing, {
    owner: 'moment',
    momentId: 'm-1',
    storyId: 's-1',
    seq: 1,
    paused: false,
  });
  assert.deepEqual(port.commands, [`play 1:${MOMENT_PATH}`]);
});
