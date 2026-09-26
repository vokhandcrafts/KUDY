// G05.06.a — the simulator's determinism core (09 §11): one queue of deferred
// actions — the location watchdog's timers and the audio completions — ordered
// by due time, then insertion order as the tie-break. There is no wall clock
// and no randomness anywhere in tools/simulate: the DeterministicClock is the
// only time source; its `now` moves only when the replay advances to the next
// trace event or drains a queued action. It implements RunClock
// (controllers/run) and LocationClock (services/location) over one shared
// queue, so the watchdog's resubscribe backoff replays deterministically
// against the audio completions.
export class DeterministicClock {
  // `startMs` is the trace's first event time; the clock never reads the wall.
  constructor(startMs) {
    this.currentMs = startMs;
    this.seq = 0;
    this.entries = [];
  }

  now() {
    return this.currentMs;
  }

  // Internal: the replay and the drain move the clock; nothing else may.
  set(ms) {
    this.currentMs = ms;
  }

  // LocationClock shape (services/location). `label` is optional report
  // metadata: a queued action's id in the report's never-fired list.
  schedule(delayMs, fn, label = null) {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error(`simulator clock: invalid delay ${String(delayMs)}`);
    }
    const entry = { dueMs: this.currentMs + delayMs, seq: this.seq++, fn, label, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  // Schedules at an absolute simulation time (the audio completions use it).
  scheduleAt(dueMs, fn, label = null) {
    const cancel = this.schedule(dueMs - this.currentMs, fn, label);
    return cancel;
  }

  // Runs every entry due at or before `untilMs`, in (dueMs, seq) order,
  // moving the clock forward entry by entry. A callback that schedules new
  // work at its own due time is picked up by the same drain; work scheduled
  // strictly later stays pending.
  drainUntil(untilMs) {
    for (;;) {
      let next = null;
      for (const entry of this.entries) {
        if (entry.cancelled || entry.dueMs > untilMs) continue;
        if (next === null || entry.dueMs < next.dueMs || (entry.dueMs === next.dueMs && entry.seq < next.seq)) {
          next = entry;
        }
      }
      if (next === null) break;
      this.entries = this.entries.filter((e) => e !== next);
      this.set(next.dueMs);
      next.fn();
    }
    this.set(untilMs);
  }

  // Entries still pending at the end of the replay — the report's
  // «таймеры, што не спрацавалі», due time then insertion order.
  pending() {
    return this.entries
      .filter((entry) => !entry.cancelled)
      .sort((a, b) => a.dueMs - b.dueMs || a.seq - b.seq)
      .map((entry) => ({ id: entry.label ?? `timer-${String(entry.seq)}`, dueMs: entry.dueMs }));
  }
}
