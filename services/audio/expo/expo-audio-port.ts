// G05.03.b — the expo-audio adapter over the G05.03.a player port. This is
// the only module of services/audio/expo/ that imports expo-audio at
// runtime; node --test imports it only through the G20.02 behavioral suite,
// which replaces the expo-audio module itself with node:test module mocks
// (the npm test node invocation passes --experimental-test-module-mocks;
// only this file uses mock.module).
// The composition root receives the port factory as the audio port parameter —
// no other module imports this file (AC4; verified by arch:check and the
// import grep in results).
//
// Canon anchors: `09` §6.3 `audio` row — one physical player; position in
// milliseconds, never a 0..1 ratio; a disposed player is re-created, never
// reset. ADR G01.02 §3.4/§3.5 — one player for guide and moment plays
// alike; an interruption is focus loss, never finished. G05.03.a
// services/audio/types.ts is the port contract, implemented exactly.
//
// Physical mapping decisions recorded in results/G05.03.b.md:
// - one expo `AudioPlayer` per source: `play` removes the previous player
//   and creates a fresh one (re-creation, never reset); `stop`/`dispose`
//   remove the player, so its late statuses cannot fire.
// - the speech audio mode is requested through the once-guarded
//   `configureSpeechAudioMode()`; the app start awaits it before the first
//   play (ducking and focus itself are left to the OS, `09` §6.3).
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import type {
  AudioPlayerPort,
  AudioSource,
  PlayerSnapshot,
  PlayerSourceEvent,
} from '../types.ts';
import { createStatusMapper, type MappedEvent } from './status-mapping.ts';
import { createSpeechModeSetter, SPEECH_AUDIO_MODE } from './speech-mode.ts';

// Set once per process (AC3). The app start awaits this before the first
// play; the rejection propagates to that caller — nothing swallows it.
export const configureSpeechAudioMode = createSpeechModeSetter(setAudioModeAsync, SPEECH_AUDIO_MODE);

export interface ExpoAudioPlayerPortOptions {
  // Status tick interval in milliseconds (expo-audio default is 500ms); a
  // denser tick keeps computed playback state fresh for the progress UI.
  updateIntervalMs?: number;
}

// The current source key the port echoes on source-scoped events (the
// tagged-callback idiom one level down — G05.03.a types.ts). The mapper
// returns key-less event shapes; this adapter attaches the key of the
// source that produced them, focus events carry none.
function withSourceKey(event: MappedEvent, key: number): PlayerSourceEvent {
  switch (event.type) {
    case 'finished':
      return { type: 'finished', key };
    case 'failed':
      return { type: 'failed', key, reason: event.reason };
    case 'paused':
      return { type: 'paused', key };
    case 'resumed':
      return { type: 'resumed', key };
    case 'focus-loss':
      return { type: 'focus-loss' };
    case 'focus-regain':
      return { type: 'focus-regain' };
  }
}

// The reason carried to the existing failed-event path (story_play_failed
// one level up): the failing operation plus the original message; a
// non-Error throw is stringified whole.
function failureReason(operation: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${operation}: ${message}`;
}

export function createExpoAudioPlayerPort(options?: ExpoAudioPlayerPortOptions): AudioPlayerPort {
  const updateIntervalMs = options?.updateIntervalMs ?? 250;
  const mapper = createStatusMapper();
  let handler: ((event: PlayerSourceEvent) => void) | null = null;
  let player: AudioPlayer | null = null;
  let sourceKey: number | null = null;
  // Latest status of the current player; snapshot() computes from it —
  // no second copy of the physical state lives anywhere (`09` §6.3).
  let latest: AudioStatus | null = null;

  return {
    play(source: AudioSource): void {
      // The previous physical player is removed whole — a replaced source
      // has no status left to report. The fields drop before creation, so
      // a synchronous throw from createAudioPlayer leaves the port with no
      // player: pause()/resume() no-op and snapshot() reads an idle state
      // instead of touching the removed player's methods.
      player?.remove();
      player = null;
      sourceKey = null;
      latest = null;
      let created: AudioPlayer;
      try {
        created = createAudioPlayer({ uri: source.path }, { updateInterval: updateIntervalMs });
      } catch (error) {
        handler?.({ type: 'failed', key: source.key, reason: failureReason('player creation failed', error) });
        return;
      }
      // The listener closes over its own player and drops everything while
      // another player owns the port: a late tick of a removed player must
      // neither touch the shared `latest`/mapper ledger nor be credited to
      // the new source (R1: one owner per launch).
      created.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (player !== created) return;
        latest = status;
        const mapped = mapper.onStatus(status);
        if (mapped && sourceKey !== null) handler?.(withSourceKey(mapped, sourceKey));
      });
      player = created;
      sourceKey = source.key;
      latest = null;
      mapper.onCommand('play');
      try {
        // Identity and subscriptions are in place — only now the physical
        // player starts. expo-audio creates a player paused: creation and
        // play are separate operations (audit A26-02 — the player was
        // created and subscribed but never started).
        created.play();
      } catch (error) {
        // The listener dies with the player — remove() is the one release;
        // the port is back to no-player, and the failure reaches the
        // existing failed-event path one level up.
        created.remove();
        player = null;
        sourceKey = null;
        latest = null;
        handler?.({ type: 'failed', key: source.key, reason: failureReason('player start failed', error) });
      }
    },

    stop(): void {
      player?.remove();
      player = null;
      sourceKey = null;
      latest = null;
      mapper.onCommand('stop');
    },

    pause(): void {
      if (!player) return;
      player.pause();
      mapper.onCommand('pause');
    },

    resume(): void {
      if (!player) return;
      player.play();
      mapper.onCommand('resume');
    },

    snapshot(): PlayerSnapshot {
      return mapper.snapshotOf(player === null ? null : latest);
    },

    dispose(): void {
      player?.remove();
      player = null;
      sourceKey = null;
      latest = null;
      mapper.onCommand('dispose');
    },

    onSourceEvent(sourceEventHandler: (event: PlayerSourceEvent) => void): void {
      handler = sourceEventHandler;
    },
  };
}
