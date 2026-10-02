// The single home of the synthetic expo-audio AudioStatus fixture used by
// the adapter suites (status-mapping.test.ts, expo-audio-port.test.ts).
// Extracted in G20.02 when the second consumer appeared — the copy-paste
// gate allows one variant only. The `AudioStatus` import is type-only and
// erased under node --experimental-strip-types.
import type { AudioStatus } from 'expo-audio';

// A fully loaded, ready, not-yet-playing status; tests override the fields
// that change. Field list mirrors expo-audio 1.1.1 AudioStatus verbatim.
export function status(overrides: Partial<AudioStatus> = {}): AudioStatus {
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
