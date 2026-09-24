// G05.03.b — the once-guard for the speech audio mode (AC3: the mode is set
// once for speech). Pure: the underlying setter is injected, so node --test
// proves the guard without importing expo-audio. The adapter (expo-audio-port.ts)
// binds it to expo-audio's setAudioModeAsync; the app start awaits the bound
// function once before the first play (integration point recorded in
// results/G05.03.b.md).

// `09` §6.3 `audio` row: speech mode — ducking and focus are left to the OS;
// background playback enabled. The same options the G00.01 spike verified
// (spikes/G00.01-location-audio/App.tsx: setAudioModeAsync with
// playsInSilentMode/shouldPlayInBackground/interruptionMode 'duckOthers').
export interface SpeechAudioMode {
  playsInSilentMode: true;
  interruptionMode: 'duckOthers';
  shouldPlayInBackground: true;
}

export const SPEECH_AUDIO_MODE: SpeechAudioMode = {
  playsInSilentMode: true,
  interruptionMode: 'duckOthers',
  shouldPlayInBackground: true,
};

export interface SpeechModeSetter {
  (): Promise<void>;
  // True after the underlying setter has completed successfully — a later
  // call returns the settled promise, never a second set.
  readonly isSet: boolean;
}

// While a set attempt is in flight every call returns that same attempt. A
// rejection propagates to the caller (never swallowed here) and clears the
// guard, so the next call retries; a successful set is cached for good.
export function createSpeechModeSetter<M>(setMode: (mode: M) => Promise<void>, mode: M): SpeechModeSetter {
  let settled: Promise<void> | null = null;
  let done = false;
  const setter = (): Promise<void> => {
    if (settled) return settled;
    const attempt = setMode(mode);
    settled = attempt;
    void attempt.then(
      () => {
        done = true;
      },
      () => {
        if (settled === attempt) settled = null;
      },
    );
    return attempt;
  };
  // Object.assign would copy the accessor's current value, not the getter
  // itself — defineProperty keeps `isSet` live.
  return Object.defineProperty(setter, 'isSet', {
    get: () => done,
  }) as SpeechModeSetter;
}
