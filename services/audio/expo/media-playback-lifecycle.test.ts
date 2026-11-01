// APR-08.c / #854 AC2: the production adapter must activate the supported
// expo-audio lock-screen session for a started source and release ownership
// when that source no longer owns playback. Native FGS/notification evidence
// remains a separate Android release check (AC1).
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { AudioPlayer, AudioStatus } from 'expo-audio';
import type { PlayerSourceEvent } from '../types.ts';
import { status } from './status-fixture.ts';

interface RecordingPlayer {
  calls: string[];
  play(): void;
  pause(): void;
  remove(): void;
  setActiveForLockScreen(active: boolean): void;
  clearLockScreenControls(): void;
  addListener(event: string, listener: (status: AudioStatus) => void): void;
  emit(status: AudioStatus): void;
}

const players: RecordingPlayer[] = [];
mock.module('expo-audio', {
  namedExports: {
    createAudioPlayer: (): AudioPlayer => {
      let listener: ((status: AudioStatus) => void) | null = null;
      const player: RecordingPlayer = {
        calls: [],
        play() { player.calls.push('play'); },
        pause() { player.calls.push('pause'); },
        remove() { player.calls.push('remove'); },
        setActiveForLockScreen(active) { player.calls.push(`active:${active}`); },
        clearLockScreenControls() { player.calls.push('clear'); },
        addListener(event, callback) {
          assert.equal(event, 'playbackStatusUpdate');
          listener = callback;
        },
        emit(nextStatus) { listener?.(nextStatus); },
      };
      players.push(player);
      return player as unknown as AudioPlayer;
    },
    setAudioModeAsync: async () => {},
  },
});

const { createExpoAudioPlayerPort } = await import('./expo-audio-port.ts');

for (const terminal of ['finished', 'failed'] as const) {
  test(`#854 AC2: ${terminal} playback releases the lock-screen session without a stop command`, () => {
    players.length = 0;
    const port = createExpoAudioPlayerPort();
    const events: PlayerSourceEvent[] = [];
    port.onSourceEvent((event) => events.push(event));
    port.play({ key: 3, path: 'guide.m4a' });
    const player = players[0];

    player.emit(status({ playing: true }));
    assert.equal(player.calls.filter((call) => call === 'clear').length, 0,
      'ordinary playback updates must leave controls available');
    player.emit(terminal === 'finished'
      ? status({ didJustFinish: true })
      : status({ isLoaded: false, playbackState: 'idle' }));

    assert.equal(events.at(-1)?.type, terminal);
    assert.equal(player.calls.filter((call) => call === 'clear').length, 1);
  });
}

test('#854 AC2: a started source owns the lock screen until stop; pause and resume retain ownership', () => {
  players.length = 0;
  const port = createExpoAudioPlayerPort();
  port.play({ key: 1, path: 'guide.m4a' });
  const player = players[0];
  assert.equal(player.calls.filter((call) => call === 'active:true').length, 1);
  assert.equal(player.calls.filter((call) => call === 'play').length, 1);

  port.pause();
  port.resume();
  assert.equal(player.calls.filter((call) => call === 'active:true').length, 1);
  assert.ok(!player.calls.includes('clear'), 'pause must keep the lock-screen session available for resume');

  port.stop();
  assert.equal(player.calls.filter((call) => call === 'clear').length, 1);
  assert.equal(player.calls.filter((call) => call === 'remove').length, 1);
});

test('#854 AC2: replacing a source and disposing the port release each player lock-screen session', () => {
  players.length = 0;
  const port = createExpoAudioPlayerPort();
  port.play({ key: 1, path: 'first.m4a' });
  port.play({ key: 2, path: 'second.m4a' });

  assert.equal(players.length, 2);
  assert.equal(players[0].calls.filter((call) => call === 'clear').length, 1);
  assert.equal(players[0].calls.filter((call) => call === 'remove').length, 1);
  assert.equal(players[1].calls.filter((call) => call === 'active:true').length, 1);

  port.dispose();
  assert.equal(players[1].calls.filter((call) => call === 'clear').length, 1);
  assert.equal(players[1].calls.filter((call) => call === 'remove').length, 1);
});
