// G05.03.b — behavioral tests for the pure status mapping (AC1). Each suite
// drives the mapper with synthetic expo-audio statuses; reverting the
// interruption→focus-loss classification, the was-loaded error
// discrimination, the settled guard or the millisecond conversion makes
// them fail (implementation-rules 1). No test imports expo-audio at
// runtime — the `AudioStatus` here is only a type, erased by node
// --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createStatusMapper } from './status-mapping.ts';
import type { AudioStatus } from 'expo-audio';
import type { PlayerSourceEvent } from '../types.ts';
import { FakeAudioPlayerPort } from '../fake-port.ts';
import { AudioService } from '../service.ts';

// A fully loaded, ready, not-yet-playing status; tests override the fields
// that change. Field list mirrors expo-audio 1.1.1 AudioStatus verbatim.
function status(overrides: Partial<AudioStatus> = {}): AudioStatus {
  return {
    id: 1,
    currentTime: 0,
    playbackState: 'ready',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 62.5,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: true,
    ...overrides,
  };
}

function makeMapper() {
  const mapper = createStatusMapper();
  const events: PlayerSourceEvent[] = [];
  const play = (): void => {
    mapper.onCommand('play');
  };
  // Drive onStatus and collect the mapped events with the key the adapter
  // would attach (the port contract echoes the play command's key; focus
  // events carry none).
  const feed = (tick: AudioStatus, key = 1): void => {
    const mapped = mapper.onStatus(tick);
    if (!mapped) return;
    if (mapped.type === 'focus-loss' || mapped.type === 'focus-regain') {
      events.push(mapped);
    } else {
      events.push({ ...mapped, key } as PlayerSourceEvent);
    }
  };
  return { mapper, events, play, feed };
}

test('a launch opens without an event and the state is computed in milliseconds', () => {
  const { mapper, play, feed } = makeMapper();
  play();
  // First ticks: buffering then playing — a launch opening, not a resume.
  feed(status({ isLoaded: false, playbackState: 'buffering', timeControlStatus: 'waiting' }));
  feed(status({ playing: true, timeControlStatus: 'playing', currentTime: 1.5 }));
  const snapshot = mapper.snapshotOf(status({ playing: true, currentTime: 1.5, duration: 62.5 }));
  assert.deepEqual(snapshot, { state: 'playing', positionMs: 1500, durationMs: 62500 });
  // Not loaded yet → idle facts, never invented numbers.
  assert.deepEqual(mapper.snapshotOf(status({ isLoaded: false, playbackState: 'buffering' })), {
    state: 'idle',
    positionMs: 0,
    durationMs: 0,
  });
});

test('a pause command maps to paused and a resume command to resumed', () => {
  const { mapper, events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  mapper.onCommand('pause');
  feed(status({ playing: false, timeControlStatus: 'paused' }));
  mapper.onCommand('resume');
  feed(status({ playing: true, timeControlStatus: 'playing', currentTime: 7.25 }));
  assert.deepEqual(events, [
    { type: 'paused', key: 1 },
    { type: 'resumed', key: 1 },
  ]);
});

test('an interruption maps to focus-loss, never finished, and the launch survives a regain', () => {
  const { events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  // No pause command was issued — the OS took the output (a call).
  feed(status({ playing: false, timeControlStatus: 'paused' }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'focus-loss');
  assert.notEqual(events[0]!.type, 'finished');
  // The output comes back (regain), nothing sounds by itself — then the
  // file reaches its natural end and still finishes.
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  feed(status({ playing: true, didJustFinish: true, playbackState: 'ended' }));
  assert.deepEqual(events, [
    { type: 'focus-loss' },
    { type: 'focus-regain' },
    { type: 'finished', key: 1 },
  ]);
});

test('a source loaded and then unloaded is a failure with a reason, never finished', () => {
  const { events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  feed(status({ isLoaded: false, playbackState: 'idle', playing: false }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'failed');
  assert.notEqual(events[0]!.type, 'finished');
  assert.match((events[0] as { reason: string }).reason, /playbackState "idle"/);
  // The launch is settled: further ticks of the dead player produce no
  // second failure and no finished (Android re-sends didJustFinish on
  // every ENDED tick; a failed player keeps ticking too).
  feed(status({ isLoaded: false, playbackState: 'idle', playing: false }));
  feed(status({ didJustFinish: true, playbackState: 'ended' }));
  feed(status({ playing: true, didJustFinish: true, playbackState: 'ended' }));
  assert.equal(events.length, 1);
});

test('a natural end fires finished exactly once and settled ticks stay silent', () => {
  const { events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  feed(status({ playing: false, didJustFinish: true, playbackState: 'ended', currentTime: 62.5 }));
  feed(status({ playing: false, didJustFinish: true, playbackState: 'ended', currentTime: 62.5 }));
  assert.deepEqual(events, [{ type: 'finished', key: 1 }]);
});

test('each new launch echoes its own key and stop drops the late statuses', () => {
  const { mapper, events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  feed(status({ playing: false, didJustFinish: true, playbackState: 'ended' })); // natural end
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }), 2);
  feed(status({ playing: false, didJustFinish: true, playbackState: 'ended' }), 2);
  assert.deepEqual(events, [
    { type: 'finished', key: 1 },
    { type: 'finished', key: 2 },
  ]);
  // After a command stop the removed player's late ticks map to nothing.
  mapper.onCommand('stop');
  feed(status({ playing: false, didJustFinish: true, playbackState: 'ended' }), 2);
  assert.equal(events.length, 2);
});

test('a focus loss revokes a pending resume; a denied resume does not leak into the next pause', () => {
  const { mapper, events, play, feed } = makeMapper();
  play();
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  // Resume issued but the OS denies it; then a real interruption arrives.
  mapper.onCommand('resume');
  feed(status({ playing: false, timeControlStatus: 'paused' }));
  assert.deepEqual(events, [{ type: 'focus-loss' }]);
  // After the regain, a normal pause command still maps to paused.
  feed(status({ playing: true, timeControlStatus: 'playing' }));
  assert.deepEqual(events, [{ type: 'focus-loss' }, { type: 'focus-regain' }]);
  mapper.onCommand('pause');
  feed(status({ playing: false, timeControlStatus: 'paused' }));
  assert.deepEqual(events, [
    { type: 'focus-loss' },
    { type: 'focus-regain' },
    { type: 'paused', key: 1 },
  ]);
});

test('NaN and zero durations pass through the mapping; the service guard fails non-finite', async () => {
  const { mapper, play } = makeMapper();
  play();
  const nanDuration = mapper.snapshotOf(status({ playing: true, currentTime: 2.5, duration: Number.NaN }));
  assert.equal(nanDuration.state, 'playing');
  assert.equal(nanDuration.positionMs, 2500);
  assert.equal(nanDuration.durationMs, Number.NaN);
  const zeroDuration = mapper.snapshotOf(status({ playing: true, currentTime: 0, duration: 0 }));
  assert.deepEqual(zeroDuration, { state: 'playing', positionMs: 0, durationMs: 0 });

  // The service computes its state from the port snapshot on every read
  // (G05.03.a guard): fed the mapped snapshots through the fake port, a
  // NaN duration becomes a failed state with a reason, never a number,
  // while a zero duration stays an honest playing state.
  const port = new FakeAudioPlayerPort();
  const service = new AudioService({ createPort: () => port });
  await service.play({ token: { kind: 'guide', ref: 'session-1', seq: 1 }, path: '/tmp/a.m4a' });
  port.snapshotValue = nanDuration;
  const failed = service.playbackState();
  assert.equal(failed.kind, 'failed');
  assert.match(failed.kind === 'failed' ? failed.reason : '', /durationMs/);
  port.snapshotValue = zeroDuration;
  const zero = service.playbackState();
  assert.equal(zero.kind, 'playing');
  assert.equal(zero.kind === 'playing' ? zero.durationMs : -1, 0);
});
