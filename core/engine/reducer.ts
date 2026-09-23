// G05.01.a — the pure reducer: session lifecycle and the AccessReady trust
// boundary (docs/agent-tasks/run/G05.01.a.md).
//
// Pure by contract (09 §6.1): the clock is injected (`now`), there is no I/O
// and no React Native import — the same input always gives the same state and
// the same commands. Effects exist only as commands for the controller.
//
// Slice boundaries: autotrigger, the one-cell queue fill and the progress
// rules arrive with G05.01.b; audio ownership (guide/moment transitions,
// tagged callbacks, focus) with G05.01.c. Those union members are accepted by
// the type but ignored here without mutating a field.
//
// The executable reference for the accepted semantics is the documentation
// model docs/run-model/run-model.mjs (frozen; see its README) — this file
// mirrors its lifecycle decisions, not its file layout.

import type { RunCommand } from './commands.ts';
import type { RunEvent } from './events.ts';
import {
  findStop,
  primaryStoryOf,
  storyAccessible,
  type RunSessionState,
  type RunState,
  type StopId,
} from './state.ts';

// Only values from services/config (19 §3.1) — no functions, no clock. The
// accepted numbers live in 09 invariants 5 and 8 and the queue paragraph;
// G05.01.b (freshness, queue distance) and G05.01.c (focus window) consume
// them — G05.01.a reads none yet, they are the contract surface of the
// mandated signature.
export interface EngineConfig {
  fixFreshnessMs: number;
  queueDistanceMultiplier: number;
  focusRegainWindowMs: number;
}

export const defaultEngineConfig: EngineConfig = {
  fixFreshnessMs: 30_000,
  queueDistanceMultiplier: 2,
  focusRegainWindowMs: 600_000,
};

export type StepResult = { state: RunState; commands: RunCommand[] };

export function step(
  previous: RunState,
  event: RunEvent,
  now: number,
  config: EngineConfig,
): StepResult {
  const s: RunState = structuredClone(previous);

  if (s.phase === 'Idle') {
    // Only Start can create a session; every other event has no live addressee
    // (ADR G01.03 §3.5, scope (b)) — package availability lives on disk, and a
    // download completed with no session mutates only the disk.
    if (event.type === 'Start') return { state: startSession(event), commands: [] };
    return { state: s, commands: [] };
  }
  if (s.phase === 'Ended') {
    // Ended never returns to Active (09 invariant 9); a repeat walk is a fresh
    // session from the initial state. No player event is handled in this
    // slice, so every event is ignored without mutating a field.
    return { state: s, commands: [] };
  }

  const commands: RunCommand[] = [];
  switch (event.type) {
    case 'Start':
      // A live session already exists; a second walk goes through a new
      // session row (one live session, ADR G01.03 §3.1), not through this one.
      break;
    case 'Pause':
    case 'End': {
      // Invariant 9: Pause and End clear queued — the displaced stop keeps
      // only manual access — and release the geofences. Stopping guide audio
      // (and the moment-owner exception) is G05.01.c; nothing plays yet.
      retireQueue(s);
      s.autoplaySuspended = true;
      s.phase = event.type === 'End' ? 'Ended' : 'Paused';
      commands.push({ type: 'ClearGeofences' });
      break;
    }
    case 'Resume': {
      // Resume exists only from Paused (ADR G01.03 §3.3); it clears the
      // suspension as an explicit human action (09 invariant 7) and rebuilds
      // the geofence window. Nothing sounds by itself.
      if (s.phase !== 'Paused') break;
      s.phase = 'Active';
      s.autoplaySuspended = false;
      commands.push({ type: 'SetGeofenceWindow', stopIds: geofenceCandidates(s) });
      break;
    }
    case 'AccessReady':
      applyAccess(s, event, commands);
      break;
    default:
      break;
  }
  return { state: s, commands };
}

function startSession(event: Extract<RunEvent, { type: 'Start' }>): RunSessionState {
  // Readiness is verified before the Start transaction (ADR G01.03 §3.3,
  // §3.6), so a package claiming no verified layer, an unknown layer, or
  // accessibility for stops outside the pinned package is refused instead of
  // silently starting an unplayable walk. Partial downloads and hash
  // mismatches never reach this point (G04/G05 own the disk).
  if (
    event.tier.length === 0 ||
    !event.tier.every((t) => t === 'base' || t === 'extended')
  ) {
    throw new RangeError('start requires at least one verified layer: base|extended');
  }
  const accessible = event.stops
    .map((stop) => stop.stopId)
    .filter((id) => event.accessibleStopIds.includes(id));
  if (accessible.length !== event.accessibleStopIds.length) {
    throw new RangeError('accessibleStopIds must reference stops of the pinned package');
  }
  return {
    phase: 'Active',
    sessionId: event.sessionId,
    routeId: event.routeId,
    version: event.version,
    locale: event.locale,
    tier: [...event.tier],
    stops: event.stops.map((stop) => ({ ...stop })),
    accessibleStopIds: accessible,
    tierAvailable: [...event.tier],
    heard: [],
    autoFired: [],
    playing: null,
    queued: null,
    autoplaySuspended: false,
    lastFix: null,
    focusLostAt: null,
    playSeq: 0,
  };
}

// Invariant 9: the queued stop leaves the queue into auto_fired — the
// automatic attempt is over, manual access remains.
function retireQueue(s: RunSessionState): void {
  if (s.queued) {
    if (!s.autoFired.includes(s.queued.stopId)) s.autoFired.push(s.queued.stopId);
    s.queued = null;
  }
}

// ADR G01.03 §3.5: the event is accepted only when the whole identity matches
// the live session, and a mismatch is ignored entirely — no field mutates.
// Files unlocked here stay under their own package key for any session that
// pins that version later. The engine cannot see the disk: "the actually
// downloaded layer" (check 4) and the capability channel (check 6) live in
// services/download; the reducer re-checks the declared values and the pin.
function applyAccess(
  s: RunSessionState,
  event: Extract<RunEvent, { type: 'AccessReady' }>,
  commands: RunCommand[],
): void {
  const identityMatches =
    event.issuer === 'services/download' &&
    event.routeId === s.routeId &&
    event.version === s.version &&
    event.locale === s.locale &&
    (event.tier === 'base' || event.tier === 'extended');
  if (!identityMatches) return;
  // Unknown stop ids open no content: the payload must stay inside the
  // pinned package (check 5). An empty payload alongside a valid tier stays
  // accepted — it widens the tier only (run-model applyAccess parity).
  if (!event.stopIds.every((stopId) => !!findStop(s, stopId))) return;

  // Acceptance: tier_available widens, accessible_stop_ids recomputes, the
  // geofence window is rebuilt — with no Play, and heard/auto_fired untouched
  // (same-version unlock keeps progress). A repeat of the same identity adds
  // nothing, so it emits no command: the no-op stays a no-op.
  let widened = false;
  for (const stopId of event.stopIds) {
    if (!s.accessibleStopIds.includes(stopId)) {
      s.accessibleStopIds.push(stopId);
      widened = true;
    }
  }
  if (!s.tierAvailable.includes(event.tier)) {
    s.tierAvailable.push(event.tier);
    widened = true;
  }
  if (widened) commands.push({ type: 'SetGeofenceWindow', stopIds: geofenceCandidates(s) });
}

// The recomputed window payload: every stop whose primary story is accessible
// now (09 §6.3 — services/location picks the nearest ≤ 20 of these).
function geofenceCandidates(s: RunSessionState): StopId[] {
  return s.stops
    .filter((stop) => {
      const primary = primaryStoryOf(stop);
      return !!primary && storyAccessible(s, primary);
    })
    .map((stop) => stop.stopId);
}
