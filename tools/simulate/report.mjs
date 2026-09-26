// G05.06.a — the simulation report (09 §11 «Справаздача»): which stops fired
// and how fast, the command stream, timers that never fired, and
// `stuck_playing` — a segment still sounding at the end of the trace, the one
// condition the tool exists to catch. The builder is pure over recorded
// observations: no clock reads, no iteration order that depends on anything
// but trace time — the same trace run twice renders byte-identical JSON (AC2).
import { isDeepStrictEqual } from 'node:util';

// Records what the replay saw. The production hook onCommitted(before, after)
// (controllers/run) is the single observation point: the reducer's committed
// states are the truth about launches, phase changes and accepted fixes —
// the simulator reads them, never re-derives them.
export class SimulationObserver {
  constructor(clock, radiusByStopId) {
    this.clock = clock;
    this.radiusByStopId = radiusByStopId;
    // What input drives the engine right now: 'auto' (a trace fix),
    // 'deferred' (a queue drain — audio completions and watchdog timers) or
    // 'manual' (a user command). Launch attribution only; never a rule.
    this.source = 'auto';
    this.stayStartMs = new Map(); // stopId → first accepted fix `at` of the current in-radius stay
    this.launches = [];
    this.lastLaunchKey = null;
    this.commands = [];
    this.startedAtMs = null;
    this.endedAtMs = null;
  }

  onCommitted(before, after) {
    if (before.phase === 'Idle' && after.phase === 'Active') this.startedAtMs = this.clock.now();
    if (after.phase === 'Ended' && this.endedAtMs === null) this.endedAtMs = this.clock.now();

    // Accepted-fix tracking (the engine keeps only accepted fixes): the start
    // of the contiguous in-radius stay per stop — leaving resets it, matching
    // the pipeline's dwell reset (09 §6.2 stage 4).
    const fix = after.phase === 'Idle' ? null : after.lastFix;
    if (fix !== null) {
      for (const [stopId, distance] of fix.distances) {
        const radius = this.radiusByStopId.get(stopId);
        if (radius === undefined) continue;
        if (distance <= radius) {
          if (!this.stayStartMs.has(stopId)) this.stayStartMs.set(stopId, fix.at);
        } else {
          this.stayStartMs.delete(stopId);
        }
      }
    }

    // Guide launches: a new (stopId, storyId, playId) triple. A pause or a
    // resume flips `paused` on the same triple and is not a launch; a replay
    // always carries a fresh playId (play_seq grows per launch).
    const playing = after.phase === 'Idle' ? null : after.playing;
    if (playing !== null && playing.owner === 'guide') {
      const key = `${playing.playId}:${playing.stopId}:${playing.storyId}`;
      if (key !== this.lastLaunchKey) {
        const stayStart = this.stayStartMs.get(playing.stopId);
        this.launches.push({
          stopId: playing.stopId,
          storyId: playing.storyId,
          at: this.clock.now(),
          origin: this.source,
          latencyMs: stayStart === undefined ? null : this.clock.now() - stayStart,
        });
        this.lastLaunchKey = key;
      }
    } else if (playing === null) {
      this.lastLaunchKey = null;
    }
  }

  // A user command's outcome: applied (the committed state moved) or a no-op —
  // recorded from the same before/after views the production hook receives.
  recordCommand(at, command, before, after) {
    this.commands.push({
      at,
      action: command.action,
      outcome: isDeepStrictEqual(before, after) ? 'no-op' : 'applied',
    });
  }

  firedStops() {
    return this.launches.filter((launch) => launch.origin !== 'manual');
  }

  manualPlays() {
    return this.launches.filter((launch) => launch.origin === 'manual');
  }
}

// Byte-stable rendering: fixed key order by construction, 2-space JSON, no
// wall-clock fields anywhere.
export function buildReport({ name, doc, clock, observer, orchestrator, counters, diagnostics }) {
  const state = orchestrator.state;
  const playing = state.phase === 'Idle' ? null : state.playing;
  const events = doc.events;
  const report = {
    simulator: 'g05.06.a',
    trace: {
      name,
      events: events.length,
      firstAtMs: events.length === 0 ? null : events[0].at,
      lastAtMs: events.length === 0 ? null : events[events.length - 1].at,
    },
    route: {
      routeId: doc.route.routeId,
      version: doc.route.version,
      locale: doc.route.locale,
      tier: [...doc.route.tier],
      stops: doc.stops.length,
    },
    session: {
      startedAtMs: observer.startedAtMs,
      endedAtMs: observer.endedAtMs,
      finalPhase: state.phase,
      heard: state.phase === 'Idle' ? [] : [...state.heard],
      autoFired: state.phase === 'Idle' ? [] : [...state.autoFired],
    },
    firedStops: observer.firedStops(),
    manualPlays: observer.manualPlays(),
    commandStream: observer.commands,
    timersNeverFired: clock.pending(),
    stuckPlaying:
      playing === null
        ? null
        : playing.owner === 'guide'
          ? { owner: 'guide', stopId: playing.stopId, storyId: playing.storyId, playId: playing.playId, paused: playing.paused }
          : { owner: 'moment', momentId: playing.momentId, storyId: playing.storyId, seq: playing.seq, paused: playing.paused },
    counters: { ...counters },
    diagnostics: [...diagnostics],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
