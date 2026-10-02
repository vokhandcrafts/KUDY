// G20.02 — behavioral tests of the production expo adapter itself (audit
// A26-02: the adapter created the physical player and subscribed to it but
// never invoked player.play — physicalPlayCalls=0). The only mock is the
// `expo-audio` module, replaced with node:test module mocks before the
// adapter import; the npm test node invocation passes
// --experimental-test-module-mocks (only this file uses mock.module).
// Reverting the adapter's created.play() fails
// physical_play_called, and removing the stale-owner guard fails the
// late-tick assertions of replaced_player_released (implementation-rules 1).
// Physical sound on a device stays a separate acceptance proof — no mock
// test here claims it (criterion 4).
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

import type { AudioPlayer, AudioStatus } from 'expo-audio';
import type { AudioPlayerPort, PlayerSourceEvent } from '../types.ts';
import { status } from './status-fixture.ts';

// --- the expo-audio module stand-in -----------------------------------------
// createAudioPlayer builds a recording fake the test reads and drives
// (emit() delivers a status tick by hand). remove() does not stop
// deliveries — a removed player's late tick is exactly what the
// stale-owner guard under test must survive.

interface RecordingPlayer {
  source: { uri: string };
  updateInterval: number | undefined;
  playCalls: number;
  pauseCalls: number;
  removeCalls: number;
  // Process-wide order stamps: the test asserts listener setup precedes
  // the physical start (R1: identity and subscriptions first).
  listenOrder: number;
  playOrder: number;
  addListener(event: string, listener: (status: AudioStatus) => void): void;
  play(): void;
  pause(): void;
  remove(): void;
  emit(status: AudioStatus): void;
}

const created: RecordingPlayer[] = [];
let createError: Error | null = null;
let nextPlayError: Error | null = null;
let opCounter = 0;

mock.module('expo-audio', {
  namedExports: {
    createAudioPlayer: (source: { uri: string }, options?: { updateInterval?: number }): AudioPlayer => {
      if (createError) throw createError;
      let listener: ((status: AudioStatus) => void) | null = null;
      const player: RecordingPlayer = {
        source,
        updateInterval: options?.updateInterval,
        playCalls: 0,
        pauseCalls: 0,
        removeCalls: 0,
        listenOrder: 0,
        playOrder: 0,
        addListener(event, callback) {
          assert.equal(event, 'playbackStatusUpdate');
          player.listenOrder = ++opCounter;
          listener = callback;
        },
        play() {
          player.playOrder = ++opCounter;
          player.playCalls += 1;
          if (nextPlayError) {
            const error = nextPlayError;
            nextPlayError = null;
            throw error;
          }
        },
        pause() {
          player.pauseCalls += 1;
        },
        remove() {
          player.removeCalls += 1;
        },
        emit(status) {
          listener?.(status);
        },
      };
      created.push(player);
      return player as unknown as AudioPlayer;
    },
    setAudioModeAsync: async () => {},
  },
});

const { createExpoAudioPlayerPort } = await import('./expo-audio-port.ts');

// A fresh port per test: the stand-in state is module-global, so each test
// resets it and attaches the event collector the production service would.
function setup(): { port: AudioPlayerPort; events: PlayerSourceEvent[] } {
  created.length = 0;
  createError = null;
  nextPlayError = null;
  const port = createExpoAudioPlayerPort();
  const events: PlayerSourceEvent[] = [];
  port.onSourceEvent((event) => events.push(event));
  return { port, events };
}

test('physical_play_called: play starts the physical player exactly once, after identity and listener setup', () => {
  const { port, events } = setup();
  port.play({ key: 7, path: 'guide-1.m4a' });

  assert.equal(created.length, 1, 'one physical player per play');
  const physical = created[0];
  assert.equal(physical.source.uri, 'guide-1.m4a');
  assert.ok(physical.listenOrder < physical.playOrder, 'the physical start comes after identity/listener setup');
  assert.equal(physical.playCalls, 1, 'the physical play is invoked exactly once');
  assert.deepEqual(events, [], 'a launch opens without an event');
});

test('replaced_player_released: replacing removes the old player once and its late ticks cannot reach the new owner', () => {
  const { port, events } = setup();
  port.play({ key: 1, path: 'a.m4a' });
  const first = created[0];
  port.play({ key: 2, path: 'b.m4a' });
  const second = created[1];

  assert.equal(first.removeCalls, 1, 'the replaced player is removed exactly once');
  assert.equal(second.playCalls, 1);

  // Late ticks of the removed player — completion, then error — delivered
  // despite the removal. The stale-owner guard drops both before they can
  // settle the shared mapper ledger or be credited to source 2.
  first.emit(status({ didJustFinish: true }));
  first.emit(status({ isLoaded: false, playbackState: 'idle' }));
  assert.deepEqual(events, [], 'no late tick of the removed player reaches the handler');

  // The new owner still reports — its finished arrives keyed to source 2.
  // With the guard reverted, the late ticks above settle the shared mapper
  // and swallow exactly this event.
  second.emit(status({ didJustFinish: true }));
  assert.deepEqual(events, [{ type: 'finished', key: 2 }]);
});

test('play_failure_cleanup: creation failure reaches the failed path and leaves the port valid', () => {
  const { port, events } = setup();
  createError = new Error('decoder missing');
  port.play({ key: 3, path: 'c.m4a' });
  createError = null;

  assert.equal(created.length, 0, 'no player object exists after a failed creation');
  assert.deepEqual(events, [
    { type: 'failed', key: 3, reason: 'player creation failed: decoder missing' },
  ]);
  assert.deepEqual(port.snapshot(), { state: 'idle', positionMs: 0, durationMs: 0 });
  port.pause();
  port.stop();

  // The next play re-creates: a failed launch never wedges the port.
  port.play({ key: 4, path: 'd.m4a' });
  assert.equal(created[0].playCalls, 1);
  assert.equal(events.length, 1, 'the recovery play opens without an event');
});

test('play_failure_cleanup: start failure removes the player exactly once and reports the failure once', () => {
  const { port, events } = setup();
  nextPlayError = new Error('audio focus denied');
  port.play({ key: 5, path: 'e.m4a' });
  nextPlayError = null;
  const physical = created[0];

  assert.ok(physical.listenOrder < physical.playOrder, 'the listener was attached before the failed start');
  assert.equal(physical.removeCalls, 1, 'the failed player is released exactly once');
  assert.equal(physical.playCalls, 1, 'the failed physical start was invoked once');
  assert.deepEqual(events, [
    { type: 'failed', key: 5, reason: 'player start failed: audio focus denied' },
  ]);
  assert.deepEqual(port.snapshot(), { state: 'idle', positionMs: 0, durationMs: 0 });
  port.pause();

  // A late tick of the removed player is dropped by the stale-owner guard.
  physical.emit(status({ playing: true }));
  assert.equal(events.length, 1);

  // Re-creation works.
  port.play({ key: 6, path: 'f.m4a' });
  assert.equal(created[1].playCalls, 1);
  assert.equal(events.length, 1);
});
