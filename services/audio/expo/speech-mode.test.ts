// G05.03.b — behavioral tests for the speech-audio-mode once-guard (AC3:
// the mode is set once for speech). The underlying setter is injected, so
// no test touches expo-audio; reverting the guard (a second set, a cached
// rejection, a swallowed error) makes them fail (implementation-rules 1).
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechModeSetter, SPEECH_AUDIO_MODE } from './speech-mode.ts';

test('repeated calls set the mode exactly once', async () => {
  let calls = 0;
  const setMode = async (): Promise<void> => {
    calls += 1;
  };
  const setter = createSpeechModeSetter(setMode, SPEECH_AUDIO_MODE);
  await setter();
  await setter();
  await setter();
  assert.equal(calls, 1);
  assert.equal(setter.isSet, true);
});

test('calls racing while the first attempt is in flight share it', async () => {
  let calls = 0;
  const setMode = (): Promise<void> =>
    new Promise((resolve) => {
      calls += 1;
      setTimeout(resolve, 5);
    });
  const setter = createSpeechModeSetter(setMode, SPEECH_AUDIO_MODE);
  await Promise.all([setter(), setter(), setter()]);
  assert.equal(calls, 1);
  assert.equal(setter.isSet, true);
});

test('a rejection propagates to the caller and the next call retries', async () => {
  let calls = 0;
  const setMode = (): Promise<void> => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('audio session busy')) : Promise.resolve();
  };
  const setter = createSpeechModeSetter(setMode, SPEECH_AUDIO_MODE);
  await assert.rejects(setter(), /audio session busy/);
  assert.equal(setter.isSet, false);
  await setter();
  assert.equal(calls, 2);
  assert.equal(setter.isSet, true);
  await setter();
  assert.equal(calls, 2);
});
