// G05.03.a — the audio service: a plain class over an injected player port.
// One physical player: a second play stops the first by command before the
// next starts (ADR G01.02 §3.4); every callback is tagged with the token of
// the source that produced it and a callback of a non-current launch is
// ignored entirely (§3.5, 09 §6.1 player boundary); focus events pass through
// verbatim, never as finished; playback state is computed from the port on
// read (09 §6.3); a disposed player is re-created, never reset (19 §3.4).
// The service issues no tokens and interprets none — the controller owns
// them — and it imports nothing from core/engine (criterion 6): no heard,
// no queue, no automation decisions live here.
import type {
  AudioPlayerPort,
  AudioServiceEvent,
  PlaybackState,
  PlayerSnapshot,
  PlayerSourceEvent,
  PlayToken,
} from './types.ts';

export interface AudioServiceDeps {
  // 19 §3.4: creation on the first Play; dispose → the next play creates a
  // new player. The factory keeps that decision here instead of trusting a
  // caller to hand in a fresh port.
  createPort: () => AudioPlayerPort;
}

// One live subscription slot: the composition root passes the controller's
// sink once. A second onEvent() call replaces it.
type EventHandler = (event: AudioServiceEvent) => void;

// The port instance the service currently plays on. `alive` dies with
// dispose(); the event closure keeps the instance, so a late physical event
// of a disposed port is dropped instead of forwarded (criterion 2).
interface PortSession {
  port: AudioPlayerPort;
  alive: boolean;
}

export class AudioService {
  private readonly createPort: () => AudioPlayerPort;
  private session: PortSession | null = null;
  // The current physical launch: the source key the port echoes and the
  // token of the play command that started it. Null after stop, after an
  // accepted finished/failed, and after dispose.
  private current: { key: number; token: PlayToken } | null = null;
  private nextKey = 0;
  private handler: EventHandler | null = null;

  constructor(deps: AudioServiceDeps) {
    this.createPort = deps.createPort;
  }

  onEvent(handler: EventHandler): void {
    this.handler = handler;
  }

  // PlayStory / PlayMoment carry the controller's token (ADR G01.02 §3.2);
  // the service echoes it, never mints one. While a source is active it is
  // stopped by command first — one player, never two active sources.
  async play(command: { token: PlayToken; path: string }): Promise<void> {
    const port = this.ensurePort();
    if (this.current) {
      port.stop();
      this.current = null;
    }
    const key = ++this.nextKey;
    this.current = { key, token: command.token };
    port.play({ key, path: command.path });
  }

  // StopAudio — an action on the current launch (09 §6.1). A stopped launch
  // produces no finished and no error: its late port events fall to the
  // key-mismatch rejection below.
  stop(): void {
    if (!this.current) return;
    this.livePort().stop();
    this.current = null;
  }

  pause(): void {
    if (!this.current) return;
    this.livePort().pause();
  }

  // ResumeAudio(play_token): accepted only for the live pause of the current
  // launch (ADR G01.02 §3.5). A closed or stale token is a command refusal —
  // the port is not touched, the next listen of that file is a fresh play.
  resume(token: PlayToken): boolean {
    if (!this.current) return false;
    if (!tokensEqual(this.current.token, token)) return false;
    this.livePort().resume();
    return true;
  }

  // Computed from the port on every read — no second copy of the physical
  // state is kept anywhere (09 §6.3).
  playbackState(): PlaybackState {
    if (!this.session || !this.session.alive) return { kind: 'idle' };
    const snapshot = this.session.port.snapshot();
    if (snapshot.state === 'idle') return { kind: 'idle' };
    if (!this.current) {
      return { kind: 'failed', token: null, reason: 'port reports playback without a launch' };
    }
    const problem = snapshotProblem(snapshot);
    if (problem) return { kind: 'failed', token: this.current.token, reason: problem };
    return {
      kind: snapshot.state,
      token: this.current.token,
      positionMs: snapshot.positionMs,
      durationMs: snapshot.durationMs,
    };
  }

  // The disposed port instance is dropped whole, never reset (09 §6.3);
  // the next play re-creates a player through the factory.
  dispose(): void {
    const session = this.session;
    if (!session) return;
    session.alive = false;
    session.port.dispose();
    this.session = null;
    this.current = null;
  }

  private ensurePort(): AudioPlayerPort {
    if (this.session && this.session.alive) return this.session.port;
    const port = this.createPort();
    const session: PortSession = { port, alive: true };
    this.session = session;
    port.onSourceEvent((event) => {
      if (!session.alive) return;
      this.handleSourceEvent(event);
    });
    return port;
  }

  private livePort(): AudioPlayerPort {
    if (!this.session || !this.session.alive) {
      throw new Error('audio service has no live player for the current launch');
    }
    return this.session.port;
  }

  // The rejection rule is single (ADR G01.02 §3.5): a source-scoped event
  // whose key is not the current launch's is ignored entirely — no crediting,
  // no stop, no follow-up. Focus events are physical facts of the device:
  // they always reach the controller and are never turned into finished.
  private handleSourceEvent(event: PlayerSourceEvent): void {
    if (event.type === 'focus-loss') {
      this.emit({ type: 'FocusLoss' });
      return;
    }
    if (event.type === 'focus-regain') {
      this.emit({ type: 'FocusRegain' });
      return;
    }
    const launched = this.current;
    if (!launched || event.key !== launched.key) return;
    if (event.type === 'finished') {
      this.current = null;
      this.emit({ type: 'finished', token: launched.token });
      return;
    }
    if (event.type === 'failed') {
      this.current = null;
      this.emit({ type: 'story_play_failed', token: launched.token, reason: event.reason });
      return;
    }
    if (event.type === 'paused') {
      this.emit({ type: 'paused', token: launched.token });
      return;
    }
    this.emit({ type: 'resumed', token: launched.token });
  }

  private emit(event: AudioServiceEvent): void {
    this.handler?.(event);
  }
}

// A NaN, infinite or negative millisecond value from the port is a failure,
// not a number (09 §6.3: the TourForge NaN defect; criterion 4).
function snapshotProblem(snapshot: PlayerSnapshot): string | null {
  for (const field of ['positionMs', 'durationMs'] as const) {
    const value = snapshot[field];
    if (!Number.isFinite(value)) {
      return `${field} is ${String(value)} — the port must report a finite millisecond value`;
    }
    if (value < 0) return `${field} is negative (${String(value)})`;
  }
  return null;
}

function tokensEqual(a: PlayToken, b: PlayToken): boolean {
  return a.kind === b.kind && a.ref === b.ref && a.seq === b.seq;
}
