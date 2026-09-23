// G05.01.a + G05.01.b — engine state types and derived views
// (docs/agent-tasks/run/G05.01.a.md, docs/agent-tasks/run/G05.01.b.md).
//
// Name boundary, declared once for the whole module (19 §3): the canonical
// contract names are snake_case in 09 §6.1 and the accepted ADRs
// (docs/architecture/decisions/G01.01/G01.02/G01.03); TypeScript identifiers
// here are their camelCase mechanical transform — no second contract, and no
// third spelling anywhere else. Event and command names are copied verbatim
// from 09 §6.1 (events.ts / commands.ts).
//
// 19 §3.1 predates the G01.02 synchronization (canon note in the brief): the
// `playing` owner variants and `PlayToken` here follow 09 §6.1, which is the
// name source after that sync.
//
// Monotonic sets (`heard`, `auto_fired`, `accessible_stop_ids`, `tier_available`)
// are stored as add-only arrays: the durable row keeps them as JSON arrays
// (ADR G01.03 §3.1), and array order keeps deep-equality deterministic for the
// parity work in G05.01.d.

export type SessionId = string;
export type RouteId = string;
export type VersionId = string;
export type StopId = string;
export type StoryId = string;
export type MomentId = string;

// BCP-47 locale from the bundle allowlist (09 §3); the allowlist itself is
// content-schema territory, not an engine rule.
export type Locale = string;

export type Tier = 'base' | 'extended';

// Four states, no more (09 §6.1; the forbidden list adds no states).
export type Phase = 'Idle' | 'Active' | 'Paused' | 'Ended';

// One stop of the pinned package, as Start received it. The primary story is
// derived, never stored (ADR G01.01 §4.1): base when present, else the
// paid-only extended story; an unlock never rewrites it.
export interface PackageStop {
  stopId: StopId;
  storyBaseId?: StoryId;
  storyExtendedId?: StoryId;
}

// ADR G01.02 §3.2: every launch carries one token; a guide token IS the
// accepted (session_id, play_id) pair, a moment token carries the controller's
// moment_id and its process-wide counter.
export interface PlayToken {
  kind: 'guide' | 'moment';
  ref: string;
  seq: number;
}

// Mirror of the physical player inside the session (09 §6.1, ADR G01.02 §3.3):
// the only source of player occupancy for autoplay, queue and cards. G05.01.c
// owns the transitions; nothing in G05.01.a sets it.
export type Playing =
  | { owner: 'guide'; stopId: StopId; storyId: StoryId; playId: number }
  | { owner: 'moment'; momentId: MomentId; storyId: StoryId; seq: number };

// One-cell queue of the newest trigger (09 §6.1); filled by G05.01.b.
export interface QueuedTrigger {
  stopId: StopId;
  radius: number;
  at: number;
}

// Accepted fix carried by LocationAccepted (19 §3.3): the freshness/accuracy
// checks of invariant 8 read it from last_fix. G05.01.b consumes it.
export interface AcceptedFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: number;
  distances: Map<StopId, number>;
}

// Session state: everything 09 §6.1 lists under Active, kept across Paused and
// Ended. `tier` is the informational start record of verified layers
// (ADR G01.03 §3.1) — it never grows; runtime availability is `tierAvailable`.
export interface RunSessionState {
  phase: 'Active' | 'Paused' | 'Ended';
  sessionId: SessionId;
  routeId: RouteId;
  // Pinned at Start, immutable until End (ADR G01.03 §3.4).
  version: VersionId;
  locale: Locale;
  tier: Tier[];
  stops: PackageStop[];
  // Trusted input from verified availability (ADR G01.01 §4.2): grows only
  // through AccessReady of the same identity.
  accessibleStopIds: StopId[];
  tierAvailable: Tier[];
  heard: StoryId[];
  autoFired: StopId[];
  playing: Playing | null;
  queued: QueuedTrigger | null;
  autoplaySuspended: boolean;
  lastFix: AcceptedFix | null;
  focusLostAt: number | null;
  playSeq: number;
}

export interface RunIdleState {
  phase: 'Idle';
}

export type RunState = RunIdleState | RunSessionState;

export const initialRunState: RunIdleState = { phase: 'Idle' };

export const storiesOf = (stop: PackageStop): StoryId[] =>
  [stop.storyBaseId, stop.storyExtendedId].filter((id): id is StoryId => id !== undefined);

// Derived primary story (ADR G01.01 §4.1) — base, for paid-only stops extended.
export const primaryStoryOf = (stop: PackageStop | undefined): StoryId | undefined =>
  stop && (stop.storyBaseId ?? stop.storyExtendedId);

// The tier a story belongs to inside its stop: the extended story of a stop is
// the extended-tier one, everything else is base (run-model tierOf parity).
export const storyTierOf = (stop: PackageStop, storyId: StoryId): Tier =>
  stop.storyExtendedId === storyId ? 'extended' : 'base';

export const findStop = (state: RunSessionState, stopId: StopId): PackageStop | undefined =>
  state.stops.find((stop) => stop.stopId === stopId);

// story_accessible (ADR G01.01 §4.2): the story is primary or additional of a
// stop whose id is in accessible_stop_ids, and its tier is in tier_available.
export const storyAccessible = (state: RunSessionState, storyId: StoryId): boolean => {
  const stop = state.stops.find((candidate) => storiesOf(candidate).includes(storyId));
  return (
    !!stop &&
    state.accessibleStopIds.includes(stop.stopId) &&
    state.tierAvailable.includes(storyTierOf(stop, storyId))
  );
};

// «Яшчэ можна адкрыць» (ADR G01.01 §4.6): every accessible story of the route
// stops that is not heard — locked stories excluded, the unit is story_id, an
// unheard additional story is listed even when the stop marker already says
// played. Route-stop order, [base, extended] inside a stop (the executable
// reference: docs/run-model/run-model.mjs missed()).
export const missedStories = (state: RunSessionState): StoryId[] => [
  ...new Set(
    state.stops
      .flatMap((stop) => storiesOf(stop))
      .filter((storyId) => storyAccessible(state, storyId) && !state.heard.includes(storyId)),
  ),
];

export type StopStatus = 'locked' | 'playing' | 'played' | 'available' | 'pending';

// Stop status is computed, never stored (ADR G01.01 §4.5, 09 §6.1):
// locked → playing → played → available → pending, first match wins. The
// playing marker requires the audible guide launch; a live-pause nuance lands
// with G05.01.c together with the paused field of the launch.
export const stopStatus = (state: RunSessionState, stopId: StopId): StopStatus => {
  const stop = findStop(state, stopId);
  const primary = primaryStoryOf(stop);
  if (!primary || !storyAccessible(state, primary)) return 'locked';
  if (
    state.playing &&
    state.playing.owner === 'guide' &&
    state.playing.stopId === stopId
  ) {
    return 'playing';
  }
  if (state.heard.includes(primary)) return 'played';
  return state.autoFired.includes(stopId) ? 'available' : 'pending';
};
