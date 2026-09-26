// G05.06.a — the simulator's deterministic OS boundary. The production
// LocationService and AudioService run unmodified (the simulator composes the
// real classes, 09 §11); these ports stand in for expo-location and expo-audio
// and speak only the injected port contracts (services/location/types.ts,
// services/audio/types.ts). Every delayed physical fact — an audio completion,
// a focus transition — is scheduled on the shared DeterministicClock, never on
// a real timer.

// The location boundary: permission is pre-granted (a simulator run assumes a
// walkable device), the subscription generation is echoed on every delivered
// fix, and the geofence window is recorded for the report. Fixes enter through
// deliverFix() from the trace replay; without a live subscription the fix is
// dropped exactly like an OS would (no subscriber).
export class SimLocationPort {
  constructor() {
    this.currentSub = null;
    this.requests = [];
    this.regions = [];
    this.handler = null;
  }

  permission() {
    return 'granted';
  }

  requestPermission(scope, explanation) {
    this.requests.push({ scope, explanation });
  }

  startFixes(sub) {
    this.currentSub = sub;
  }

  stopFixes(sub) {
    if (this.currentSub === sub) this.currentSub = null;
  }

  setRegions(regions) {
    this.regions = [...regions];
  }

  onPortEvent(handler) {
    this.handler = handler;
  }

  // The replay's delivery path: the port tags the fix with the live
  // subscription; the service's own generation check does the rest.
  deliverFix(fix) {
    if (this.currentSub === null || this.handler === null) return false;
    this.handler({ type: 'fix', sub: this.currentSub, fix });
    return true;
  }
}

// The audio boundary: one physical player whose completion is a queued action
// at start + duration. Pause freezes the remaining time, resume re-arms it —
// the live-pause semantics of ADR G01.02 §3.4 as a queue entry. Stale
// completions are impossible to attribute wrongly: the service rejects by key,
// and stop() cancels the entry outright.
export class SimAudioPort {
  constructor(clock, durationFor) {
    this.clock = clock;
    this.durationFor = durationFor;
    this.handler = null;
    this.sources = new Map(); // key → { path, durationMs, positionBaseMs, baseAtMs, finishCancel }
    this.stateByKey = new Map(); // key → 'playing' | 'paused'
    this.currentKey = undefined;
  }

  onSourceEvent(handler) {
    this.handler = handler;
  }

  play(source) {
    this.stop();
    const durationMs = this.durationFor(source.path);
    const finishCancel = this.clock.schedule(
      durationMs,
      () => this.finish(source.key),
      `audio.finished(key=${String(source.key)})`,
    );
    this.sources.set(source.key, {
      path: source.path,
      durationMs,
      positionBaseMs: 0,
      baseAtMs: this.clock.now(),
      finishCancel,
    });
    this.stateByKey.set(source.key, 'playing');
    this.currentKey = source.key;
  }

  stop() {
    const source = this.currentSource();
    if (source === null) return;
    source.finishCancel();
    this.sources.delete(this.currentKey);
    this.stateByKey.delete(this.currentKey);
    this.currentKey = undefined;
  }

  pause() {
    const source = this.currentSource();
    if (source === null || this.stateByKey.get(this.currentKey) !== 'playing') return;
    source.positionBaseMs += this.clock.now() - source.baseAtMs;
    source.finishCancel();
    this.stateByKey.set(this.currentKey, 'paused');
    this.handler?.({ type: 'paused', key: this.currentKey });
  }

  resume() {
    const source = this.currentSource();
    if (source === null || this.stateByKey.get(this.currentKey) !== 'paused') return;
    const remainingMs = Math.max(0, source.durationMs - source.positionBaseMs);
    source.baseAtMs = this.clock.now();
    source.finishCancel = this.clock.schedule(
      remainingMs,
      () => this.finish(this.currentKey),
      `audio.finished(key=${String(this.currentKey)})`,
    );
    this.stateByKey.set(this.currentKey, 'playing');
    this.handler?.({ type: 'resumed', key: this.currentKey });
  }

  snapshot() {
    const source = this.currentSource();
    if (source === null) return { state: 'idle', positionMs: 0, durationMs: 0 };
    const state = this.stateByKey.get(this.currentKey);
    const positionMs =
      state === 'playing' ? source.positionBaseMs + (this.clock.now() - source.baseAtMs) : source.positionBaseMs;
    return { state, positionMs, durationMs: source.durationMs };
  }

  dispose() {
    this.stop();
  }

  // The device-level focus facts of the trace (an incoming call), forwarded
  // verbatim — no key, never as finished (services/audio contract).
  emitFocus(kind) {
    if (kind !== 'focus-loss' && kind !== 'focus-regain') {
      throw new Error(`sim audio port: unknown focus event '${String(kind)}'`);
    }
    this.handler?.({ type: kind });
  }

  finish(key) {
    if (this.currentKey !== key || this.stateByKey.get(key) !== 'playing') return;
    this.sources.delete(key);
    this.stateByKey.delete(key);
    this.currentKey = undefined;
    this.handler?.({ type: 'finished', key });
  }

  currentSource() {
    return this.currentKey === undefined ? null : (this.sources.get(this.currentKey) ?? null);
  }
}
