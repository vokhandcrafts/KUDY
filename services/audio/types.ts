// G05.03.a — services/audio contract types. Canonical anchors, copied not
// paraphrased (implementation-rules 2): `09` §6.1 (the player boundary —
// `play_token = {kind, ref, seq}`, every callback echoes it unchanged, a
// callback whose launch is not the current one is ignored entirely;
// FocusLoss/FocusRegain are physical player events, never finished),
// ADR G01.02-audio-ownership §3.2/§3.5 (token issuance rules, the rejection
// table), `09` §6.3 `audio` row (playback state is computed from the player,
// never duplicated; position in milliseconds, never a 0..1 ratio; a disposed
// player is re-created, never reset), `19` §3.4 (the service sketch; its
// `(sessionId, playId)` callback tag predates G01.02 — the token shape here
// is the canon, the difference is recorded in results/G05.03.a.md).
//
// Name boundary (declared once, like core/engine/state.ts): canonical snake_case
// contract names (play_token, story_play_failed) and verbatim event names
// (FocusLoss, FocusRegain) keep their canon spelling inside the `type`
// discriminants; TypeScript identifiers around them are the camelCase
// mechanical transform. No second contract, no third spelling.
//
// This module must not import core/engine (criterion 6): the token type is
// restated here from 09 §6.1, structurally identical to the engine's.

// 09 §6.1 / ADR G01.02 §3.2: one token per launch, issued by the controller
// that owns the single player. For a guide launch the token IS the accepted
// (session_id, play_id) pair (ref = session_id, seq = play_id); for a moment
// launch ref = moment_id and seq = the process-wide manual-content counter.
export interface PlayToken {
  kind: 'guide' | 'moment';
  ref: string;
  seq: number;
}

// One physical play command handed to the port. `key` is an opaque,
// service-issued source number the port echoes on every source-scoped event —
// the tagged-callback idiom one level down. The port never invents or
// interprets a key; the service uses it to attribute a physical event to the
// launch that produced it, so a late event of a replaced source cannot be
// credited to the current one (the proof scenario of G05.03.a).
export interface AudioSource {
  key: number;
  path: string;
}

// Physical facts of the single source, read on demand — the service computes
// the playback state from a fresh snapshot on every read (09 §6.3) and never
// keeps a second copy. Both numbers are milliseconds.
export interface PlayerSnapshot {
  state: 'idle' | 'playing' | 'paused';
  positionMs: number;
  durationMs: number;
}

// Physical events the port reports. Source-scoped variants carry the `key`
// echoed from the play command; focus events are facts of the device, not of
// a source, so they carry none (ADR G01.02 §3.5: they reach the controller
// always and are never converted into finished).
export type PlayerSourceEvent =
  | { type: 'finished'; key: number }
  | { type: 'failed'; key: number; reason: string }
  | { type: 'paused'; key: number }
  | { type: 'resumed'; key: number }
  | { type: 'focus-loss' }
  | { type: 'focus-regain' };

// The injected single physical player (19 §3.4: created on the first Play,
// dispose → re-creation, never reset; `09` §6.3: one player for guide and
// moment plays alike). The expo-audio adapter is G05.03.b; tests use the
// fake in fake-port.ts.
export interface AudioPlayerPort {
  play(source: AudioSource): void;
  stop(): void;
  pause(): void;
  resume(): void;
  snapshot(): PlayerSnapshot;
  dispose(): void;
  onSourceEvent(handler: (event: PlayerSourceEvent) => void): void;
}

// What the service tells the controller (19 §3.4 minimum set + ADR G01.02
// §3.5 acceptance table). Tagged variants carry verbatim the token of the
// play command that started the producing source. The canon names are copied
// verbatim: story_play_failed is the contract name of the error callback
// (never AudioFinished), FocusLoss/FocusRegain are the 09 §6.1 event names.
export type AudioServiceEvent =
  | { type: 'finished'; token: PlayToken }
  | { type: 'story_play_failed'; token: PlayToken; reason: string }
  | { type: 'paused'; token: PlayToken }
  | { type: 'resumed'; token: PlayToken }
  | { type: 'FocusLoss' }
  | { type: 'FocusRegain' };

// Playback state computed from the port on read (09 §6.3: computed, not
// duplicated). Position and duration are milliseconds, never a 0..1 ratio;
// a NaN, infinite or negative number reported by the port becomes `failed`
// with a reason — never a number (criterion 4).
export type PlaybackState =
  | { kind: 'idle' }
  | { kind: 'playing'; token: PlayToken; positionMs: number; durationMs: number }
  | { kind: 'paused'; token: PlayToken; positionMs: number; durationMs: number }
  | { kind: 'failed'; token: PlayToken | null; reason: string };
