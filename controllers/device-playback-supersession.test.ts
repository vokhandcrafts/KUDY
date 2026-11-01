// G20.29 / #791 AC3: a newer launch replaces an older launch while the
// shared speech-mode request is pending. Only the Expo audio boundary is
// mocked; AudioService and its adapter are the production implementations.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { AudioPlayer } from 'expo-audio';

let completeMode: (() => void) | null = null;
let modeCalls = 0;
const physicalPlays: string[] = [];

mock.module('expo-audio', {
  namedExports: {
    setAudioModeAsync: () => {
      modeCalls += 1;
      return new Promise<void>((complete) => { completeMode = complete; });
    },
    createAudioPlayer: (source: { uri: string }): AudioPlayer => ({
      addListener() {},
      play() { physicalPlays.push(source.uri); },
      pause() {},
      setActiveForLockScreen() {},
      clearLockScreenControls() {},
      remove() {},
    }) as unknown as AudioPlayer,
  },
});

const { AudioService } = await import('../services/audio/service.ts');
const { configureSpeechAudioMode, createExpoAudioPlayerPort } = await import('../services/audio/expo/expo-audio-port.ts');

test('G20.29 AC3: superseded Moment cannot start when pending initialization completes for a newer guide', async () => {
  const deps = { createPort: () => createExpoAudioPlayerPort(), configureMode: configureSpeechAudioMode };
  const audio = new AudioService(deps);
  const older = audio.play({ token: { kind: 'moment', ref: 'm-old', seq: 1 }, path: 'file:///installed/old.m4a' });
  const newer = audio.play({ token: { kind: 'guide', ref: 'walk', seq: 2 }, path: 'file:///installed/new.m4a' });
  assert.equal(modeCalls, 1, 'both launches share the pending mode request');
  assert.deepEqual(physicalPlays, [], 'neither source plays before mode completion');
  assert.ok(completeMode);
  completeMode();
  await Promise.all([older, newer]);
  assert.deepEqual(physicalPlays, ['file:///installed/new.m4a']);
});
