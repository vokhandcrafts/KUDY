// G20.29 / #791: production audio service, Expo adapter and Moment controller.
// Only the Expo audio boundary is replaced; these checks do not claim native
// background or interruption behavior, which remains unverified on a device.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { readFileSync } from 'node:fs';

import type { AudioPlayer, AudioStatus } from 'expo-audio';
import type { PlayToken } from '../services/audio/types.ts';

type CompleteMode = () => void;
type RejectMode = (error: Error) => void;
const modeCalls: unknown[] = [];
const modeAttempts: { complete: CompleteMode; reject: RejectMode }[] = [];
const physicalPlays: string[] = [];
const removed: string[] = [];

mock.module('expo-audio', {
  namedExports: {
    setAudioModeAsync: (mode: unknown) => {
      modeCalls.push(mode);
      return new Promise<void>((complete, reject) => modeAttempts.push({ complete, reject }));
    },
    createAudioPlayer: (source: { uri: string }): AudioPlayer => {
      const player = {
        addListener(_event: string, _listener: (status: AudioStatus) => void) {},
        play() { physicalPlays.push(source.uri); },
        pause() {},
        remove() { removed.push(source.uri); },
      };
      return player as unknown as AudioPlayer;
    },
  },
});

const { AudioService } = await import('../services/audio/service.ts');
const { createExpoAudioPlayerPort, configureSpeechAudioMode } = await import('../services/audio/expo/expo-audio-port.ts');
const { SPEECH_AUDIO_MODE } = await import('../services/audio/expo/speech-mode.ts');
const { createMomentPlayController } = await import('./moment/momentPlayController.ts');

const guideToken = (seq: number): PlayToken => ({ kind: 'guide', ref: 'walk-791', seq });
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

test('G20.29 AC1–4: device Moment and guide starts await one speech-mode initialization; failure, retry, supersession and stop are observable', async () => {
  // An extra dependency property is legal on the baseline. The real device
  // root must bind this same production setter (guarded below).
  const deps = { createPort: () => createExpoAudioPlayerPort(), configureMode: configureSpeechAudioMode };
  const audio = new AudioService(deps);
  let seq = 0;
  const moment = createMomentPlayController({
    audio,
    nextSeq: () => ++seq,
    now: () => 0,
    audioUriFor: (path) => `file:///installed/${path}`,
  });

  // AC2: initialization rejection must take the controller's existing
  // playback-error path without ever creating or starting a physical player.
  assert.deepEqual(moment.play({ momentId: 'm-fail', storyId: 'story-fail', path: 'fail.m4a' }), { outcome: 'started' });
  assert.equal(modeAttempts.length, 1, 'the first launch requests the mode');
  assert.deepEqual(modeCalls[0], SPEECH_AUDIO_MODE);
  assert.deepEqual(physicalPlays, [], 'a pending mode cannot start playback');
  modeAttempts[0].reject(new Error('audio session unavailable'));
  await tick();
  assert.equal(moment.store.getState().kind, 'failed', 'the existing controller reports playback failure');
  assert.deepEqual(physicalPlays, [], 'a rejected mode cannot start playback');

  // AC1/AC3: an explicit retry and a concurrent guide request share the
  // second attempt. The guide supersedes the pending Moment, then stop
  // cancels the guide; resolving the mode cannot resurrect either launch.
  assert.deepEqual(moment.play({ momentId: 'm-retry', storyId: 'story-retry', path: 'retry.m4a' }), { outcome: 'started' });
  const pendingGuide = audio.play({ token: guideToken(1), path: 'file:///installed/guide-1.m4a' });
  assert.equal(modeAttempts.length, 2, 'concurrent requests share one retry');
  assert.deepEqual(physicalPlays, []);
  audio.stop();
  modeAttempts[1].complete();
  await pendingGuide;
  await tick();
  assert.deepEqual(physicalPlays, [], 'stopped and superseded launches stay cancelled');

  // AC1/AC4: after successful mode completion, both owners can start with
  // their exact file URIs, without setting the mode again. The second play
  // releases the first physical player under the existing one-owner rule.
  assert.deepEqual(moment.play({ momentId: 'm-live', storyId: 'story-live', path: 'live.m4a' }), { outcome: 'started' });
  await tick();
  await audio.play({ token: guideToken(2), path: 'file:///installed/guide-2.m4a' });
  assert.deepEqual(physicalPlays, ['file:///installed/live.m4a', 'file:///installed/guide-2.m4a']);
  assert.deepEqual(removed, ['file:///installed/live.m4a']);
  assert.equal(modeCalls.length, 2, 'one rejected attempt, then one shared success');
});

test('G20.29 AC4: device composition binds the same production mode setter to the one audio service', () => {
  const root = readFileSync(new URL('./deviceRoot.ts', import.meta.url), 'utf8');
  assert.match(root, /import\s*\{[^}]*configureSpeechAudioMode[^}]*\}\s*from\s*['"]\.\.\/services\/audio\/expo\/expo-audio-port\.ts['"]/s);
  assert.match(root, /new AudioService\(\{[^}]*configureMode:\s*configureSpeechAudioMode[^}]*\}\)/s);
});
