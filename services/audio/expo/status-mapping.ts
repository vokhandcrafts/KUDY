// G05.03.b — pure mapping from expo-audio player statuses to the G05.03.a
// port facts. The module imports expo-audio only as types (the adapter is
// expo-audio-port.ts); every function here runs under node --test on
// synthetic statuses.
//
// Canon anchors, copied not paraphrased (implementation-rules 2):
// `09` §6.3 `audio` row — playback state is computed from the player, never
// duplicated; position is in milliseconds, never a 0..1 ratio; a disposed
// player is re-created, never reset. ADR G01.02 §3.5 — an interruption is a
// focus event, never finished; a stopped launch produces no finished and no
// error. `fake-port.ts` of G05.03.a documents the same rules one level up.
//
// Platform fact (checked in node_modules/expo-audio 1.1.1, not assumed):
// `AudioStatus` carries no error field. On Android the player is ExoPlayer
// and its error state is `STATE_IDLE`, which is also the initial state of a
// fresh player (android/src/main/java/expo/modules/audio/AudioPlayer.kt,
// playbackStateToString) — the mapper distinguishes the two by a was-loaded
// flag: a source that had been loaded and reports isLoaded=false again is a
// failure with a reason, a source that never loaded is still loading.
import type { AudioStatus } from 'expo-audio';
import type { PlayerSnapshot } from '../types.ts';

// The adapter's command ledger. The adapter records every port command it
// issues to the physical player; the mapper consumes them as plain inputs,
// so tests drive the same transition logic without any expo import.
export type PortCommand = 'play' | 'stop' | 'pause' | 'resume' | 'dispose';

// Adapter-level event: the shapes of the port's source events without the
// source key — the adapter attaches the key of the current source when it
// forwards (the port contract keeps `key` on its source-scoped variants).
export type MappedEvent =
  | { type: 'finished' }
  | { type: 'failed'; reason: string }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'focus-loss' }
  | { type: 'focus-regain' };

// One mapping session for one physical player lifetime. `play` opens a
// launch, `stop`/`dispose` close it (late statuses of a removed player are
// ignored entirely), `finished`/`failed` settle the launch: further
// statuses of the ended or dead player map to nothing — the physical
// player reports no more transitions then, and focus facts belong to a
// live launch (ADR G01.02 §3.5).
export interface StatusMapper {
  onCommand(command: PortCommand): void;
  onStatus(status: AudioStatus): MappedEvent | null;
  snapshotOf(status: AudioStatus | null): PlayerSnapshot;
}

export function createStatusMapper(): StatusMapper {
  // Expected transition the next status must explain: a pause/resume
  // command makes the matching playing transition a `paused`/`resumed`
  // event; the same transition without a command is an interruption
  // (focus loss / regain). Both clear once consumed; a focus loss also
  // revokes a pending resume — the interruption supersedes it (ADR
  // G01.02 §3.7: nothing sounds by itself after FocusRegain).
  let pausePending = false;
  let resumePending = false;
  let focusLost = false;
  // The source has reached isLoaded=true since its play command — the
  // error discriminator against the initial idle state (see platform fact).
  let wasLoaded = false;
  // Settled: finished/failed emitted; ended-player ticks must not re-fire.
  let settled = false;
  // No source expected: statuses are a removed player's late ticks.
  let closed = false;
  let lastPlaying: boolean | null = null;

  function resetLedger(): void {
    pausePending = false;
    resumePending = false;
    focusLost = false;
    wasLoaded = false;
    settled = false;
    lastPlaying = null;
  }

  return {
    onCommand(command: PortCommand): void {
      if (command === 'play') {
        closed = false;
        resetLedger();
        return;
      }
      if (command === 'pause') {
        pausePending = true;
        return;
      }
      if (command === 'resume') {
        resumePending = true;
        return;
      }
      // stop/dispose remove the physical player: its late statuses are
      // dropped whole (the port is re-created per play, never reset).
      closed = true;
      resetLedger();
    },

    onStatus(status: AudioStatus): MappedEvent | null {
      if (closed || settled) return null;
      if (wasLoaded || status.isLoaded) wasLoaded = true;

      // Error discrimination: a loaded source that reports unloaded again
      // is a failure with a reason (platform fact above — there is no
      // error field to read). Never finished (ADR G01.02 §3.5).
      if (wasLoaded && !status.isLoaded) {
        settled = true;
        return { type: 'failed', reason: `player reported playbackState "${status.playbackState}" after the source was loaded` };
      }

      // A natural end. Android re-sends didJustFinish on every ENDED tick
      // (AudioPlayer.kt maps didJustFinish from STATE_ENDED) — settled
      // keeps that to one finished event per launch.
      if (status.didJustFinish) {
        settled = true;
        return { type: 'finished' };
      }

      const playing = status.playing;
      const previous = lastPlaying;
      lastPlaying = playing;
      if (previous === null || previous === playing) return null;

      if (previous && !playing) {
        // true → false: our pause command, or the OS took the output.
        if (pausePending) {
          pausePending = false;
          return { type: 'paused' };
        }
        focusLost = true;
        pausePending = false;
        resumePending = false;
        return { type: 'focus-loss' };
      }
      // false → true: our resume, or the output came back after an
      // interruption. Nothing sounds by itself otherwise (R03) — a start
      // right after the play command is the launch opening, not an event.
      if (resumePending) {
        resumePending = false;
        return { type: 'resumed' };
      }
      if (focusLost) {
        focusLost = false;
        return { type: 'focus-regain' };
      }
      return null;
    },

    snapshotOf(status: AudioStatus | null): PlayerSnapshot {
      // No live facts: nothing loaded yet, the launch already settled, or
      // the player removed — the port reports idle rather than inventing
      // numbers. Position and duration are milliseconds (`09` §6.3);
      // expo-audio reports seconds, so ×1000 with rounding. A NaN or zero
      // duration passes through verbatim — the service's snapshot guard
      // turns non-finite into a `failed` state, never a number.
      if (closed || settled || status === null || !status.isLoaded) {
        return { state: 'idle', positionMs: 0, durationMs: 0 };
      }
      return {
        state: status.playing ? 'playing' : 'paused',
        positionMs: status.currentTime * 1000,
        durationMs: status.duration * 1000,
      };
    },
  };
}
