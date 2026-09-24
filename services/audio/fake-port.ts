// G05.03.a — test fake over the player port contract (the allowed fake port
// of the task). It models one physical source with scripted snapshots and
// manually fired events, so tests read like player scenarios. The fake never
// has two active sources: a play() arriving while a source is still active is
// recorded as a missing-stop violation — the service must stop the first
// source by command before starting the next (criterion 1), and reverting
// that stop turns these tests red (implementation-rules 1).
import type { AudioPlayerPort, PlayerSnapshot, PlayerSourceEvent } from './types.ts';

export class FakeAudioPlayerPort implements AudioPlayerPort {
  readonly commands: string[] = [];
  readonly violations: string[] = [];
  // The scripted physical facts snapshot() returns; a test rewrites it between
  // reads to prove the service computes state instead of storing it.
  snapshotValue: PlayerSnapshot = { state: 'idle', positionMs: 0, durationMs: 0 };
  disposed = false;

  private active = new Map<number, string>();
  private handler: ((event: PlayerSourceEvent) => void) | null = null;

  play(source: { key: number; path: string }): void {
    this.commands.push(`play ${source.key}:${source.path}`);
    if (this.active.size > 0) {
      const keys = [...this.active.keys()].join(',');
      this.violations.push(`play ${source.key} while source ${keys} still active`);
    }
    this.active.set(source.key, source.path);
  }

  stop(): void {
    this.commands.push('stop');
    this.active.clear();
  }

  pause(): void {
    this.commands.push('pause');
  }

  resume(): void {
    this.commands.push('resume');
  }

  snapshot(): PlayerSnapshot {
    return this.snapshotValue;
  }

  dispose(): void {
    this.commands.push('dispose');
    this.disposed = true;
    this.active.clear();
  }

  onSourceEvent(handler: (event: PlayerSourceEvent) => void): void {
    this.handler = handler;
  }

  // --- test controls: the player reports its physical facts ---

  // A natural end of the source (or a rogue late one for an already replaced
  // key — the async race the proof scenario needs).
  finish(key: number): void {
    this.active.delete(key);
    this.handler?.({ type: 'finished', key });
  }

  fail(key: number, reason: string): void {
    this.active.delete(key);
    this.handler?.({ type: 'failed', key, reason });
  }

  reportPaused(key: number): void {
    this.handler?.({ type: 'paused', key });
  }

  reportResumed(key: number): void {
    this.handler?.({ type: 'resumed', key });
  }

  // A call or another app takes the audio output; regaining it later.
  focusLoss(): void {
    this.handler?.({ type: 'focus-loss' });
  }

  focusRegain(): void {
    this.handler?.({ type: 'focus-regain' });
  }
}
