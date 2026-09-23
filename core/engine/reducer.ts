// G05.01.a + G05.01.b — the pure reducer: session lifecycle and the
// AccessReady trust boundary (docs/agent-tasks/run/G05.01.a.md), then the
// autotrigger conditions, the one-cell queue and the P01 progress rules
// (docs/agent-tasks/run/G05.01.b.md).
//
// Pure by contract (09 §6.1): the clock is injected (`now`), there is no I/O
// and no React Native import — the same input always gives the same state and
// the same commands. Effects exist only as commands for the controller.
//
// Slice boundary: audio ownership (guide/moment transitions, tagged
// callbacks, focus) arrives with G05.01.c. Those union members are accepted
// by the type but ignored here without mutating a field; in particular a
// session Pause/End does not stop the launch yet — G05.01.c criterion 5.
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
  storyTierOf,
  storiesOf,
  type RunSessionState,
  type RunState,
  type StoryId,
  type StopId,
} from './state.ts';

// Only values from services/config (19 §3.1) — no functions, no clock. The
// accepted numbers live in 09 invariants 5 and 8 and the queue paragraph;
// G05.01.b consumes the freshness window and the queue distance multiplier
// (the immediate trigger sits in the radius itself, multiplier 1 — 11 §5.1.5),
// G05.01.c will consume the focus window.
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
  const s: RunSessionState | RunState = structuredClone(previous);

  if (s.phase === 'Idle') {
    // Only Start can create a session; every other event has no live addressee
    // (ADR G01.03 §3.5, scope (b)) — package availability lives on disk, and a
    // download completed with no session mutates only the disk.
    if (event.type === 'Start') return { state: startSession(event), commands: [] };
    return { state: s, commands: [] };
  }
  if (s.phase === 'Ended') {
    // Ended never returns to Active (09 invariant 9); a repeat walk is a fresh
    // session from the initial state. Guide-launch completions cannot exist
    // here — Pause/End stop guide audio from G05.01.c on, and in this slice
    // every event is still ignored without mutating a field.
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
      // (and the moment-owner exception) is G05.01.c.
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
    case 'LocationAccepted':
      // Invariant 8 reads the fix from last_fix; the pipeline already rejected
      // the bad fixes before the state mutation (09 §6.2), the engine only
      // keeps the last accepted one — in Paused too, so the resume sees a
      // current position.
      s.lastFix = structuredClone(event.fix);
      break;
    case 'DwellCompleted':
      dwell(s, event, now, config, commands);
      break;
    case 'AudioFinished':
      audioFinished(s, event, now, config, commands);
      break;
    case 'UserSelectedStop': {
      // ADR G01.01 §4.3: manual play of the primary story — never
      // proximity-bound, allowed after played (R03 replay), and an explicit
      // human action that lifts the automation suspension (09 invariant 7).
      const primary = primaryStoryOf(findStop(s, event.stopId));
      if (s.phase === 'Active' && primary !== undefined && storyAccessible(s, primary)) {
        s.autoplaySuspended = false;
        playGuide(s, event.stopId, primary, false, commands);
      }
      break;
    }
    case 'UserSelectedStory': {
      // ADR G01.01 §4.3: the named story of this stop — the only way an
      // additional (extended) story ever sounds (P01; 11 C37); a locked story
      // is refused (11 C33).
      const stop = findStop(s, event.stopId);
      const known = stop !== undefined && storiesOf(stop).includes(event.storyId);
      if (s.phase === 'Active' && known && storyAccessible(s, event.storyId)) {
        s.autoplaySuspended = false;
        playGuide(s, event.stopId, event.storyId, false, commands);
      }
      break;
    }
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

// Add-only semantics of the monotonic sets (ADR G01.01 §4.2): an element is
// never removed and a repeat adds nothing.
function addOnce<T>(list: T[], id: T): void {
  if (!list.includes(id)) list.push(id);
}

// Invariant 9: the queued stop leaves the queue into auto_fired — the
// automatic attempt is over, manual access remains.
function retireQueue(s: RunSessionState): void {
  if (s.queued) {
    addOnce(s.autoFired, s.queued.stopId);
    s.queued = null;
  }
}

// ADR G01.01 §4.8 conditions 4 and 6: the automatic attempt targets the
// primary story of the stop (§4.3), which must be accessible; the stop must
// not have burned its automatic attempt (§4.8.4) and its primary story must
// not be heard — a story listened to by hand beforehand never auto-replays
// (11 C12). An additional story in heard does not block and vice versa (§4.8).
function autoEligible(s: RunSessionState, stopId: StopId): boolean {
  const primary = primaryStoryOf(findStop(s, stopId));
  return (
    primary !== undefined &&
    storyAccessible(s, primary) &&
    !s.autoFired.includes(stopId) &&
    !s.heard.includes(primary)
  );
}

// §4.8.5 / 09 invariant 8, freshness half: a known fix, not from the future,
// aged ≤ fix_freshness_ms. Bounds inclusive (brief criterion 3).
function fixIsFresh(s: RunSessionState, now: number, freshnessMs: number): boolean {
  const fix = s.lastFix;
  return (
    fix !== null &&
    Number.isFinite(fix.at) &&
    fix.at <= now &&
    now - fix.at <= freshnessMs
  );
}

// The same invariant, accuracy and distance half: accuracy ≤ radius and
// distance ≤ multiplier × radius (1 × for the immediate trigger, 2 × for the
// deferred play of the queue). Bounds inclusive.
function fixWithinDistance(
  s: RunSessionState,
  stopId: StopId,
  radius: number,
  multiplier: number,
): boolean {
  const fix = s.lastFix;
  if (fix === null || !Number.isFinite(radius) || radius <= 0) return false;
  if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > radius) return false;
  const distance = fix.distances.get(stopId);
  return (
    distance !== undefined &&
    Number.isFinite(distance) &&
    distance >= 0 &&
    distance <= multiplier * radius
  );
}

// ADR G01.01 §4.8, 11 §5.1: all six conditions hold at once, and a trigger
// that did not play has three distinct outcomes (11 §5.1.1, brief criterion
// 4). The check order is the contract: session, eligibility and position
// first, then the suspension, then the player occupancy.
function dwell(
  s: RunSessionState,
  event: Extract<RunEvent, { type: 'DwellCompleted' }>,
  now: number,
  config: EngineConfig,
  commands: RunCommand[],
): void {
  if (s.phase !== 'Active') return; // §4.8.1 — ignored entirely (11 C9)
  if (!autoEligible(s, event.stopId)) return; // §4.8.4 / §4.8.6
  if (!fixIsFresh(s, now, config.fixFreshnessMs)) return; // §4.8.5
  if (!fixWithinDistance(s, event.stopId, event.radius, 1)) return; // §4.8.5
  if (s.autoplaySuspended) {
    // §5.1.1 outcome 2: the attempt is over — manual access remains (11 C5).
    addOnce(s.autoFired, event.stopId);
    return;
  }
  if (s.playing) {
    // §5.1.1 outcome 3 / §5.3: the one-cell queue keeps the newest OTHER
    // trigger — a stop never displaces itself — and queueing touches no
    // auto_fired entry (11 C8).
    if (s.queued?.stopId !== event.stopId) {
      retireQueue(s);
      s.queued = { stopId: event.stopId, radius: event.radius, at: now };
    }
    return;
  }
  const primary = primaryStoryOf(findStop(s, event.stopId));
  if (primary === undefined) return; // unreachable: autoEligible held
  playGuide(s, event.stopId, primary, true, commands);
}

// One physical player (ADR G01.01 §4.3): a new launch replaces the previous
// one by command — a replacement is an interruption, never an AudioFinished
// (§4.9), so the replaced story gains no heard credit. play_seq grows by one
// per launch and is write-through before the audio command (ADR G01.03 §3.1),
// so a late callback can never collide with the new play_id. The path is the
// bundle-relative audio path of ADR §4.1; the controller resolves it against
// the installed bundle root.
function playGuide(
  s: RunSessionState,
  stopId: StopId,
  storyId: StoryId,
  automatic: boolean,
  commands: RunCommand[],
): void {
  const stop = findStop(s, stopId);
  if (!stop) return; // unreachable: every caller resolved the stop first
  if (s.playing) commands.push({ type: 'StopAudio' });
  if (automatic) addOnce(s.autoFired, stopId);
  s.playSeq += 1;
  s.playing = { owner: 'guide', stopId, storyId, playId: s.playSeq };
  commands.push({
    type: 'PlayStory',
    storyId,
    path: `${s.locale}/${storyTierOf(stop, storyId)}/audio/${storyId}.m4a`,
    sessionId: s.sessionId,
    playId: s.playSeq,
  });
}

// ADR G01.01 §4.11, 09 invariant 4: the pair (session_id, play_id) must match
// the current guide launch — play_id restarts at zero in a new session and a
// manual replay launches the same story twice, so neither value alone
// identifies the launch — and a story_id carried by the event must be the one
// playing. Any other completion is ignored entirely: no heard credit, no
// stop, no queue start (11 C10).
function audioFinished(
  s: RunSessionState,
  event: Extract<RunEvent, { type: 'AudioFinished' }>,
  now: number,
  config: EngineConfig,
  commands: RunCommand[],
): void {
  const launch = s.playing;
  if (
    !launch ||
    launch.owner !== 'guide' ||
    event.sessionId !== s.sessionId ||
    event.playId !== launch.playId ||
    ('storyId' in event && event.storyId !== launch.storyId)
  ) {
    return;
  }
  addOnce(s.heard, launch.storyId);
  s.playing = null;
  const queued = s.queued;
  if (!queued) return;
  // §4.9 / 11 §5.3: the deferred trigger plays only when the autotrigger
  // contract still holds for its primary — content, progress, freshness,
  // accuracy and the 2 × radius distance re-checked against the current fix,
  // bounds inclusive (brief criterion 3). Otherwise the attempt is over: the
  // stop keeps only manual access, and a primary heard by hand while queued
  // lands here too (status stays played).
  const deferredReady =
    s.phase === 'Active' &&
    !s.autoplaySuspended &&
    autoEligible(s, queued.stopId) &&
    fixIsFresh(s, now, config.fixFreshnessMs) &&
    fixWithinDistance(s, queued.stopId, queued.radius, config.queueDistanceMultiplier);
  if (!deferredReady) {
    retireQueue(s);
    return;
  }
  s.queued = null;
  const primary = primaryStoryOf(findStop(s, queued.stopId));
  if (primary !== undefined) playGuide(s, queued.stopId, primary, true, commands);
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
