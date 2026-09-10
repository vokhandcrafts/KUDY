export interface Point { id: string; x: number; y: number; radiusM: number }
export interface Snapshot {
  state: 'idle' | 'active' | 'paused' | 'finished';
  locationOwner: string | null;
  playing: string | null;
  version: string | null;
  autoplaySuspended: boolean;
  heard: string[];
  autoFired: string[];
  playerCount: 1;
}
export interface Session {
  start(input: { packageReady: boolean; version: string }): void;
  pause(): void;
  resume(input?: { catalogVersion?: string }): void;
  end(): void;
  manualPlay(pointId: string): void;
  locationUnavailable(reason: string): void;
  locationFix(fix: { x: number; y: number; accuracyM: number; ageMs: number; nowMs: number }): void;
  interrupt(): void;
  focusRegained(): void;
  audioFinished(): void;
  r07Hint(): void;
  setAnalyticsConsent(value: boolean): void;
  snapshot(): Snapshot;
}
export function createSession(points: Point[]): Session;
