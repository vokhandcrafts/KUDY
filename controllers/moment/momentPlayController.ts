// G07.02 (issue #282) — the moment play controller: the single-player
// controller of the no-session context (ADR G01.02 §3.8: in Idle the manual
// launch lives here, without a session, without the engine, without queue or
// auto_fired). One app-level instance over the ONE AudioService the
// composition root owns; the run orchestrator subscribes the same service —
// every listener receives every event and filters by its own token (§3.5:
// a callback whose launch is not the current one is ignored entirely).
//
// The play decision (§3.4/§3.8): the physical state read from the service
// decides the route. A session-owned launch (a guide token, or a moment
// token this controller did not mint) is taken over only through the live
// session's own engine — the sessionMoment port (the PreviewRunSessionPort
// idiom); without the port that state is a named refusal, never a second
// player and never a silent mirror divergence. A repeat of this controller's
// own launch is stopped by command (never finished) and re-launched with a
// fresh token (§3.2: a repeat is always a new launch). Focus facts are
// physical: FocusLoss is a live pause; FocusRegain ≤ 10 min offers Resume of
// the same token, > 10 min closes the launch (§3.7 — one threshold for every
// owner). No durable fields: the state dies with the process (§3.3).
import type { AudioService } from '../../services/audio/service.ts';
import type { AudioServiceEvent, PlaybackState, PlayToken } from '../../services/audio/types.ts';
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';

// The token equality restated at the type-only boundary (09 §6.1: kind + ref
// + seq). services/audio keeps the service-side spelling; controllers may not
// value-import services (the arch gate) — this is the declared restatement,
// the same discipline the token type itself follows in services/audio/types.
const tokensEqual = (a: PlayToken, b: PlayToken): boolean =>
  a.kind === b.kind && a.ref === b.ref && a.seq === b.seq;

// §3.7: the FocusRegain threshold measures the liveness of the live pause
// after an external interruption — one number for every owner.
const FOCUS_REGAIN_CLOSE_MS = 10 * 60 * 1000;

export interface MomentPlayInput {
  readonly momentId: string;
  readonly storyId: string;
  // The full store-relative teaser path the moment facts reader resolved;
  // null = no published audio — the launch is refused before any player
  // command or state change, never a silently successful fake.
  readonly path: string | null;
}

export type MomentPlayState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'playing';
      readonly momentId: string;
      readonly storyId: string;
      readonly token: PlayToken;
      readonly paused: boolean;
    }
  | { readonly kind: 'failed'; readonly reason: string };

export type MomentPlayOutcome =
  | { readonly outcome: 'started' }
  | { readonly outcome: 'routed' }
  | { readonly refused: string };

export interface MomentPlayDeps {
  readonly audio: AudioService;
  // ADR G01.02 §3.2: ONE process-wide counter over every moment launch. The
  // composition root mints it once and hands the same source to the run
  // session ports (RunSessionPorts.nextMomentSeq) — two counters could mint
  // the same token value for two different launches.
  readonly nextSeq: () => number;
  // The live session's moment entry (G07.03): playMoment returns true iff
  // the session's engine accepted the launch (the takeover happened); the
  // resolved teaser path rides along — content resolution is the caller's,
  // the engine reads no manifest. stopMoment/resumeMoment route the manual
  // stop and the live-pause resume of a session-owned moment launch back to
  // the same engine (§3.4/§3.5 — the ownership decisions stay the session's,
  // this controller never commands over a launch it did not mint). Absent
  // or false while a session-owned launch holds the player is a named
  // refusal on play — the controller never plays over a session-owned player.
  readonly sessionMoment?: {
    readonly playMoment: (momentId: string, storyId: string, path?: string) => boolean;
    readonly stopMoment?: () => boolean;
    readonly resumeMoment?: () => boolean;
  };
  // §3.7: the threshold is measured from the physical FocusLoss fact — one
  // clock, injected; the controller never reads a clock of its own.
  readonly now: () => number;
}

export interface MomentPlayBinding {
  readonly store: ControllerStore<MomentPlayState>;
  readonly play: (input: MomentPlayInput) => MomentPlayOutcome;
  readonly stop: () => void;
  // §3.5/§3.7: accepted only for the live pause of the current own token; a
  // refused resume is a service no-op — the next Play is a fresh launch.
  readonly resume: () => void;
  // The physical playback fact, computed from the player on every read
  // (09 §6.3 — the run surface's `playback` idiom): the screens read it to
  // show the honest now-playing state of ANY owner (own, routed or session).
  readonly playback: () => PlaybackState;
}

export function createMomentPlayController(deps: MomentPlayDeps): MomentPlayBinding {
  const store = createControllerStore<MomentPlayState>(() => ({ kind: 'idle' }));
  let focusLostAt: number | null = null;

  deps.audio.onEvent((event) => onAudioEvent(event));

  function onAudioEvent(event: AudioServiceEvent): void {
    const current = store.getState();
    if (current.kind !== 'playing') {
      // Focus facts reach every owner (§3.5); with no own launch there is
      // nothing to pause — the idle/failed state stays as it is.
      return;
    }
    switch (event.type) {
      case 'finished':
        if (!tokensEqual(event.token, current.token)) return;
        store.setState({ kind: 'idle' }, true);
        return;
      case 'story_play_failed':
        if (!tokensEqual(event.token, current.token)) return;
        store.setState({ kind: 'failed', reason: event.reason }, true);
        return;
      case 'paused':
        if (!tokensEqual(event.token, current.token)) return;
        store.setState({ ...current, paused: true });
        return;
      case 'resumed':
        if (!tokensEqual(event.token, current.token)) return;
        store.setState({ ...current, paused: false });
        return;
      case 'FocusLoss':
        focusLostAt = deps.now();
        store.setState({ ...current, paused: true });
        return;
      case 'FocusRegain':
        if (focusLostAt !== null && deps.now() - focusLostAt > FOCUS_REGAIN_CLOSE_MS) {
          // §3.7: the launch is closed — the player is released by command (a
          // closed launch keeps no physical hold, the next listen of the file
          // is a fresh launch from the beginning with a new token).
          deps.audio.stop();
          focusLostAt = null;
          store.setState({ kind: 'idle' }, true);
        }
        // ≤ 10 min: the live pause holds; Resume offers the same token.
        return;
    }
  }

  function play(input: MomentPlayInput): MomentPlayOutcome {
    // A launch without a published file is impossible — refused before any
    // player command or state change.
    if (input.path === null) return { refused: 'moment#audio-unpublished' };
    const physical = deps.audio.playbackState();
    const own = store.getState();
    const ownToken = own.kind === 'playing' ? own.token : null;
    const foreign =
      (physical.kind === 'playing' || physical.kind === 'paused') &&
      physical.token !== null &&
      (ownToken === null || !tokensEqual(ownToken, physical.token));
    if (foreign) {
      // A session-owned launch (a guide token, or a moment token this
      // controller did not mint): the takeover is the engine's own
      // transition (§3.4) — routed through the live session or refused.
      if (!deps.sessionMoment) return { refused: 'moment#session-unroutable' };
      if (!deps.sessionMoment.playMoment(input.momentId, input.storyId, input.path)) {
        return { refused: 'moment#session-refused' };
      }
      // The engine took the player; the takeover stops the previous source
      // by command — a command stop produces no callback, so this
      // controller's own launch (if any) is released here, not by an event.
      focusLostAt = null;
      store.setState({ kind: 'idle' }, true);
      return { outcome: 'routed' };
    }
    if (own.kind === 'playing') {
      // A repeat of the controller's own launch: stopped by command, never
      // finished (§3.4) — the next listen is the new launch below.
      deps.audio.stop();
    }
    const token: PlayToken = { kind: 'moment', ref: input.momentId, seq: deps.nextSeq() };
    focusLostAt = null;
    store.setState({ kind: 'playing', momentId: input.momentId, storyId: input.storyId, token, paused: false }, true);
    void deps.audio.play({ token, path: input.path });
    return { outcome: 'started' };
  }

  function stop(): void {
    const current = store.getState();
    if (current.kind === 'playing') {
      deps.audio.stop();
      focusLostAt = null;
      store.setState({ kind: 'idle' }, true);
      return;
    }
    // G07.03: a session-owned moment launch this controller did not mint —
    // the manual stop is the session engine's own decision (§3.4), routed
    // back to it, never a second command over the one player. A guide-owned
    // launch is not this card's to stop.
    const physical = deps.audio.playbackState();
    if (physical.kind === 'playing' && physical.token?.kind === 'moment') {
      deps.sessionMoment?.stopMoment?.();
    }
  }

  function resume(): void {
    const current = store.getState();
    if (current.kind === 'playing' && current.paused) {
      deps.audio.resume(current.token);
      return;
    }
    // G07.03: the session-owned moment's live pause — the engine's
    // ResumeAudio continues the same token and never touches the session
    // flag (§3.5). Routed; a refused resume is a service no-op.
    const physical = deps.audio.playbackState();
    if (physical.kind === 'paused' && physical.token?.kind === 'moment') {
      deps.sessionMoment?.resumeMoment?.();
    }
  }

  return { store, play, stop, resume, playback: () => deps.audio.playbackState() };
}
