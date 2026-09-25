// G05.04 (issue #215) — scenario tests of the run orchestrator: the real
// pipeline, reducer and services with fake OS ports and an injected clock.
// Geometry note: 0.0001° of latitude ≈ 11.12 m (haversine, R = 6 371 000 m).
// The pipeline smooths over the last 3 accepted fixes, so confirming a stop's
// dwell from a walk takes three consecutive fixes at it (the mean must land
// inside the trigger radius); dwellMs = 0 keeps the scenarios about the queue
// and the blocking windows, not about dwell timing. The engine config is the
// real default: 30 000 ms freshness, 2 × radius deferred bound, 10 min focus.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RunOrchestrator, type RunStop } from './runOrchestrator.ts';
import { defaultEngineConfig } from '../../core/engine/reducer.ts';
import { stopStatus, type RunSessionState } from '../../core/engine/state.ts';
import type { FixInput } from '../../core/pipeline/types.ts';
import { LocationService } from '../../services/location/service.ts';
import { FakeLocationOsPort } from '../../services/location/fake-port.ts';
import { AudioService } from '../../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../../services/audio/fake-port.ts';

const RADIUS = 20;
const STOPS: RunStop[] = [
  { stopId: 'a', lat: 0, lng: 0, radius: RADIUS, storyBaseId: 'a' },
  { stopId: 'b', lat: 0.0009, lng: 0, radius: RADIUS, storyBaseId: 'b' }, // ~100 m from a
  { stopId: 'c', lat: 0.0018, lng: 0, radius: RADIUS, storyBaseId: 'c' }, // ~100 m from b
];
// The walked-away points past b: 0.00035° ≈ 38.9 m (inside the 2 × radius = 40 m
// deferred bound) and 0.00037° ≈ 41.1 m (outside it). The exact bound itself is
// the engine's unit territory (G05.01.b, distances map); here the pipeline's
// haversine feeds the same check through real geometry.
const WALKED_IN = 0.0009 + 0.00035;
const WALKED_OUT = 0.0009 + 0.00037;

class ManualClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
  schedule(): () => void {
    return () => {}; // the location watchdog ticks are irrelevant to these scenarios
  }
}

interface Harness {
  clock: ManualClock;
  locationPort: FakeLocationOsPort;
  audioPort: FakeAudioPlayerPort;
  orchestrator: RunOrchestrator;
}

function harness(): Harness {
  const clock = new ManualClock();
  const locationPort = new FakeLocationOsPort();
  const location = new LocationService({
    port: locationPort,
    clock,
    permissions: { foreground: 'fg', background: 'bg' },
  });
  const audioPort = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => audioPort });
  const orchestrator = new RunOrchestrator({
    location,
    audio,
    clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    route: { routeId: 'route-1', version: 'v1', locale: 'be', tier: ['base'] },
    stops: STOPS,
  });
  orchestrator.start('walk-1');
  return { clock, locationPort, audioPort, orchestrator };
}

const live = (h: Harness): RunSessionState => {
  const state = h.orchestrator.state;
  if (state.phase === 'Idle') throw new Error('no live session');
  return state;
};

// Narrowed reads over the session: the queue cell's stop and the audible
// guide launch's stop (a moment launch reads as none — no guide stop_id).
const queuedStop = (s: RunSessionState): string | null => s.queued?.stopId ?? null;
const playingStopId = (s: RunSessionState): string | null =>
  s.playing && s.playing.owner === 'guide' ? s.playing.stopId : null;

// The subscription the service currently holds: every arm mints the next
// generation, so a scenario that re-Starts the session must deliver on the
// fresh one (a fix of a stopped subscription is dropped by the service).
const currentSub = (h: Harness): number => {
  const starts = h.locationPort.commands.filter((command) => command.startsWith('start '));
  const last = starts[starts.length - 1];
  if (last === undefined) throw new Error('the location service never armed');
  return Number(last.slice('start '.length));
};

const deliver = (h: Harness, lat: number, lng: number): void => {
  const raw: FixInput = { lat, lng, accuracy: 5, at: h.clock.now() };
  h.locationPort.emitFix(currentSub(h), raw);
};

// Three consecutive fixes at one point: the smoothing window then averages to
// that point, so the pipeline confirms its dwell (dwellMs = 0 confirms at once).
const dwellAt = (h: Harness, lat: number, lng: number, startMs: number): void => {
  for (const offset of [0, 1_000, 2_000]) {
    h.clock.set(startMs + offset);
    deliver(h, lat, lng);
  }
};

test('criterion 1: the newest other stop displaces the queue; after A finishes C plays and B keeps manual access', () => {
  const h = harness();
  deliver(h, 0, 0); // window [a] → mean a → A plays at once
  assert.equal(live(h).playing?.owner ?? null, 'guide');
  dwellAt(h, 0.0009, 0, 35_000); // B triggers while A plays → one-cell queue
  assert.equal(queuedStop(live(h)), 'b');
  dwellAt(h, 0.0018, 0, 72_000); // C triggers → newest wins, B leaves to auto_fired
  assert.equal(queuedStop(live(h)), 'c');
  assert.deepEqual([...live(h).autoFired], ['a', 'b']);
  h.clock.set(74_500);
  h.audioPort.finish(1); // A finishes end to end: service tag → AudioFinished → deferred play
  const session = live(h);
  assert.deepEqual([...session.heard], ['a']);
  assert.equal(session.queued, null);
  assert.ok(session.playing && session.playing.owner === 'guide' && session.playing.stopId === 'c');
  assert.deepEqual(h.audioPort.commands, ['play 1:be/base/audio/a.m4a', 'play 2:be/base/audio/c.m4a']);
});

test('criterion 1: a repeated trigger of the playing stop displaces nothing; the queued stop never evicts itself', () => {
  const h = harness();
  deliver(h, 0, 0); // A plays
  dwellAt(h, 0.0009, 0, 35_000); // B queues
  dwellAt(h, 0, 0, 72_000); // the person walks back into A's radius → pipeline re-fires A
  assert.equal(queuedStop(live(h)), 'b'); // the repeat displaced nothing
  assert.deepEqual([...live(h).autoFired], ['a']); // A is not re-fired either (one automatic attempt)
  dwellAt(h, 0.00045, 0, 107_000); // out of B's radius — the queue accumulator resets
  dwellAt(h, 0.0009, 0, 144_000); // back into B's radius → B re-triggers while queued
  assert.equal(queuedStop(live(h)), 'b'); // the cell keeps its own stop
  assert.deepEqual([...live(h).autoFired], ['a']);
});

test('criterion 2: the deferred play re-checks the latest accepted fix — freshness bound is inclusive on both sides', () => {
  const fresh = harness();
  deliver(fresh, 0, 0);
  dwellAt(fresh, 0.0009, 0, 35_000); // last accepted fix at 37 000 ms
  fresh.clock.set(67_000); // age exactly 30 000 ms — the bound is inclusive
  fresh.audioPort.finish(1);
  assert.equal(playingStopId(live(fresh)), 'b');

  const stale = harness();
  deliver(stale, 0, 0);
  dwellAt(stale, 0.0009, 0, 35_000);
  stale.clock.set(67_001); // one millisecond past the bound
  stale.audioPort.finish(1);
  assert.equal(live(stale).playing, null);
  assert.deepEqual([...live(stale).autoFired], ['a', 'b']);
  assert.equal(stale.audioPort.commands.some((command) => command.startsWith('play 2')), false);
});

test('criterion 2: the deferred play re-checks the latest accepted fix — distance bound on both sides', () => {
  const near = harness();
  deliver(near, 0, 0);
  dwellAt(near, 0.0009, 0, 35_000);
  dwellAt(near, WALKED_IN, 0, 52_000); // ~38.9 m past B — still within 2 × radius
  near.clock.set(54_500);
  near.audioPort.finish(1);
  assert.equal(playingStopId(live(near)), 'b');

  const far = harness();
  deliver(far, 0, 0);
  dwellAt(far, 0.0009, 0, 35_000);
  dwellAt(far, WALKED_OUT, 0, 52_000); // ~41.1 m past B — outside the bound
  far.clock.set(54_500);
  far.audioPort.finish(1);
  assert.equal(live(far).playing, null);
  assert.deepEqual([...live(far).autoFired], ['a', 'b']);
});

test('criterion 3: a fix the pipeline rejects never refreshes last_fix — a spike cannot unlock a deferred play', () => {
  const h = harness();
  deliver(h, 0, 0); // A plays
  dwellAt(h, 0.0009, 0, 35_000); // B queues
  dwellAt(h, WALKED_OUT, 0, 52_000); // the person walks away — accepted fixes move last_fix
  h.clock.set(54_500);
  deliver(h, 0.0009, 0); // a 41 m jump in 0.5 s — spike-speed rejected, last_fix unmoved
  h.audioPort.finish(1);
  assert.equal(live(h).playing, null); // the rejected fix did not unlock the deferred play
  assert.deepEqual([...live(h).autoFired], ['a', 'b']);
  const last = live(h).lastFix;
  assert.ok(last !== null);
  assert.ok(Math.abs(last.lat - WALKED_OUT) < 1e-9); // still the last ACCEPTED position
  assert.ok(Math.abs((last.distances.get('b') ?? Infinity) - 41.14) < 0.5);
});

test('criterion 4: after a manual pause, a call or an explicit Moment play a trigger only buys manual access', () => {
  // Manual audio pause: the trigger lands in auto_fired, the stop stays available.
  const paused = harness();
  deliver(paused, 0, 0);
  paused.orchestrator.pauseAudio();
  assert.ok(paused.audioPort.commands.includes('pause'));
  dwellAt(paused, 0.0009, 0, 35_000);
  assert.deepEqual([...live(paused).autoFired], ['a', 'b']);
  assert.equal(live(paused).queued, null);
  assert.equal(stopStatus(live(paused), 'b'), 'available');
  // Invariant 7: the explicit resume re-arms automation — the next trigger queues again.
  paused.orchestrator.resumeAudio({ kind: 'guide', ref: 'walk-1', seq: 1 });
  assert.ok(paused.audioPort.commands.includes('resume'));
  dwellAt(paused, 0.0018, 0, 72_000);
  assert.equal(queuedStop(live(paused)), 'c');

  // A call: FocusLoss arrives from the audio service as a physical fact.
  const call = harness();
  deliver(call, 0, 0);
  call.audioPort.focusLoss();
  dwellAt(call, 0.0009, 0, 35_000);
  assert.deepEqual([...live(call).autoFired], ['a', 'b']);
  assert.equal(live(call).queued, null);

  // An explicit Moment play suspends the guide automation the same way.
  const moment = harness();
  deliver(moment, 0, 0);
  moment.orchestrator.playMoment('moment-9', 'story-m9');
  assert.deepEqual(moment.audioPort.commands.slice(-2), ['stop', 'play 2:']);
  dwellAt(moment, 0.0009, 0, 35_000);
  assert.deepEqual([...live(moment).autoFired], ['a', 'b']);
  assert.equal(live(moment).queued, null);
});

test('criterion 4: a finished Moment frees the player — after GuideResume the next GPS trigger plays, not queues', () => {
  const h = harness();
  deliver(h, 0, 0); // A plays (guide, key 1)
  h.orchestrator.playMoment('moment-9', 'story-m9'); // takes the player (key 2)
  h.audioPort.finish(2); // the moment finishes end to end
  assert.equal(live(h).playing, null); // the mirror freed — MomentFinished was dispatched
  h.orchestrator.guideResume(); // «Працягнуць гід» — the single way back to automation
  dwellAt(h, 0.0009, 0, 35_000); // the next GPS trigger
  assert.equal(playingStopId(live(h)), 'b'); // plays — not queued behind a dead launch
});

test('criterion 5: a manual tap and a GPS trigger enter step() through the same path — identical command streams', () => {
  const byGps = harness();
  deliver(byGps, 0, 0);
  byGps.clock.set(5_000);
  byGps.audioPort.finish(1);

  const byHand = harness();
  byHand.clock.set(5_000);
  byHand.orchestrator.selectStop('a');
  byHand.audioPort.finish(1);

  assert.deepEqual(byHand.audioPort.commands, byGps.audioPort.commands);
  const gpsSession = live(byGps);
  const handSession = live(byHand);
  assert.deepEqual([...handSession.heard], [...gpsSession.heard]);
  assert.deepEqual(handSession.playing, gpsSession.playing);
  // The same command stream, one deliberate engine difference: the GPS trigger
  // spent the stop's automatic attempt (auto_fired), the manual tap never
  // touches it (ADR G01.01 §4.8.4 — a manual play is not an automatic attempt).
  assert.deepEqual([...gpsSession.autoFired], ['a']);
  assert.deepEqual([...handSession.autoFired], []);
});

test('criterion 6: a late audio callback from before a Pause, an End or a new Start is ignored end to end', () => {
  // After a session Pause the stopped source's late finished reaches nobody.
  const pausedLate = harness();
  deliver(pausedLate, 0, 0);
  pausedLate.orchestrator.pauseSession();
  const commandsAtPause = pausedLate.audioPort.commands.length;
  pausedLate.audioPort.finish(1);
  assert.deepEqual([...live(pausedLate).heard], []);
  assert.equal(live(pausedLate).queued, null);
  assert.equal(pausedLate.audioPort.commands.length, commandsAtPause);

  // A replay after the explicit resume re-arms a new source; the pre-pause
  // callback must not credit the replay.
  const replay = harness();
  deliver(replay, 0, 0);
  replay.orchestrator.pauseSession();
  replay.orchestrator.resumeSession(); // Paused ignores a tap — the explicit resume first
  replay.orchestrator.selectStop('a');
  replay.audioPort.finish(1); // the source from before the pause — wrong tag
  assert.deepEqual([...live(replay).heard], []);
  replay.audioPort.finish(2); // the live source credits
  assert.deepEqual([...live(replay).heard], ['a']);

  // After End and a new Start the old tag belongs to a dead session — and the
  // new Start really opens one (19 §4.3: a fresh session_id, not a no-op).
  const afterEnd = harness();
  deliver(afterEnd, 0, 0);
  afterEnd.orchestrator.end();
  afterEnd.orchestrator.start('walk-2');
  afterEnd.audioPort.finish(1);
  const state = afterEnd.orchestrator.state;
  if (state.phase === 'Idle') throw new Error('no session after Start');
  assert.equal(state.phase, 'Active');
  assert.equal(state.sessionId, 'walk-2');
  assert.deepEqual([...state.heard], []);
  assert.equal(state.queued, null);
});

test('criterion 6: a Start after End inherits a still-sounding moment into the fresh session', () => {
  const h = harness();
  deliver(h, 0, 0); // A plays (guide, key 1)
  h.orchestrator.playMoment('moment-9', 'story-m9'); // the moment takes the player (key 2)
  h.orchestrator.end(); // the moment keeps sounding through End (ADR G01.02 §3.8)
  h.orchestrator.start('walk-2');
  const state = h.orchestrator.state;
  if (state.phase === 'Idle') throw new Error('no session after Start');
  assert.equal(state.phase, 'Active');
  // The occupied player is injected as playingNow — the fresh session waits
  // for it instead of stealing it with a guide launch.
  assert.deepEqual(state.playing, {
    owner: 'moment',
    momentId: 'moment-9',
    storyId: 'story-m9',
    seq: 1,
    paused: false,
  });
  dwellAt(h, 0.0009, 0, 35_000);
  assert.equal(queuedStop(live(h)), 'b'); // the trigger queues behind the moment
  assert.equal(playingStopId(live(h)), null);
});
