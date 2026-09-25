// G05.05.a (issue #216) — useRunController: the thin Zustand wrapper over the
// G05.04 run orchestrator and the only writer of the durable session row
// (19 §4.3 RC column; ADR G01.03 §3.1: «адзін пісьменнік — контролер сесіі»).
// services/ enters only as types and explicit ports (issue #209 AC1: the
// composition root value-imports and constructs; the ports here are the
// seams it wires — over services/db's public API, services/contentRepo's
// evaluation and services/download's route-stops parsing). Durability
// decisions, recorded once:
// 1. Start gates on G04.03 readiness for the selected tier (ADR §3.3:
//    conditions before the transaction), then inserts the row through the
//    session-store port — the INSERT plus the R07 hint carry-over are
//    services/db startSession's one transaction — and only after that commit
//    dispatches the engine's Start and lets it arm the location effects. A
//    refusal is a named reason on the result object, never a thrown error
//    (criterion 2); a failing store write keeps the original error and
//    propagates (criterion 1's injected mid-transaction failure leaves the
//    rollback to the store).
// 2. The orchestrator's onCommitted hook (its header note 7) is the
//    durability point: after the engine committed an event and before its
//    effects fire, the durable delta is checkpointed — so the play_seq of a
//    PlayStory lands in the row before the command reaches the audio service
//    (write-through, ADR §3.1), and a failed write aborts the pending
//    effects. A plain checkpoint's own rollback is safe by contract (§3.3:
//    the next checkpoint writes the newer state) — the error still surfaces,
//    it is never swallowed.
// 3. The delta is a before/after compare of the monotonic sets and play_seq:
//    a callback the reducer rejected mutates nothing, so nothing is written
//    (criterion 4's «rejected by step() writes nothing») and an unlock that
//    touches only derived state writes nothing either.
// 4. The controller reads no clock and no GPS: startedAt comes from the
//    injected clock, fixes arrive only through the location service
//    (criterion 6); session ids come from the injected newSessionId port.
// 5. Pause/Resume/End transactions, restart recovery and the pinned-version
//    restore are G05.05.b — deliberately not exposed here: a half-durable
//    Pause (checkpoint without the state UPDATE) would be worse than none,
//    and Out of scope is binding (issue #216).
import { createControllerStore, useController, type ControllerStore } from './createControllerStore.ts';
import { RunOrchestrator, type RunClock, type RunRoute, type RunStop } from './run/runOrchestrator.ts';
import type { SessionProgress, SessionStartInput } from '../services/db/types.ts';
import type { Readiness, Tier } from '../services/contentRepo/types.ts';
import type { DownloadAccessPort } from '../services/download/access.ts';
import type { AudioService } from '../services/audio/service.ts';
import type { LocationService } from '../services/location/service.ts';
import type { EngineConfig } from '../core/engine/reducer.ts';
import type { PipelineConfig } from '../core/pipeline/types.ts';
import { initialRunState, type PlayToken, type RunState } from '../core/engine/state.ts';

// The durable session row through services/db's public API (allowed outputs):
// the composition root implements the port over startSession/checkpointProgress;
// the one expected refusal — the store's one-unfinished-session rule (G04.01,
// ADR §3.1) — comes back as a named result, any other store failure throws
// and keeps its original error.
export interface RunSessionStore {
  start(input: SessionStartInput): { ok: true } | { ok: false; reason: 'live-session-exists' };
  checkpoint(sessionId: string, progress: SessionProgress): void;
}

// G04.03 readiness for the selected tier (issue #60): the Start gate.
export interface RunReadiness {
  evaluate(input: { locale: string; tier: Tier; grantedTiers?: readonly Tier[] }): Promise<Readiness>;
}

// The stops of one verified layer, read from the pinned package's route.json
// (ADR §3.2) — the same document the download channel's AccessReady events
// are built from. null = the document is absent, unreadable or foreign.
export interface RunPackageStops {
  stopsOfLayer(tier: Tier): Promise<string[] | null>;
}

export interface RunControllerDeps {
  location: LocationService;
  audio: AudioService;
  // The same clock instance the orchestrator and the services hold; the
  // controller never reads a clock of its own (criterion 6).
  clock: RunClock;
  engineConfig: EngineConfig;
  pipelineConfig: PipelineConfig;
  route: RunRoute;
  stops: ReadonlyArray<RunStop>;
  sessionStore: RunSessionStore;
  readiness: RunReadiness;
  packageStops: RunPackageStops;
  // The capability channel of services/download; passed through to the
  // orchestrator — the only AccessReady delivery path into the engine
  // (criterion 5, ADR §3.5).
  access: DownloadAccessPort;
  // The session identity mint (ADR §3.1: UUIDv4, never reused); a port so
  // the controller stays off the platform crypto API and tests stay
  // deterministic.
  newSessionId: () => string;
  // The tier_available fact of the download channel (ADR §3.1/§3.2): layers
  // verified and granted so far. A live port — a purchase may land between
  // app open and Start.
  grantedTiers?: () => readonly Tier[];
}

// The named refusals of Start (criterion 1/2): a not-ready package maps its
// G04.03 status onto the controller's named refusal
// (incomplete → package-incomplete, needs-recovery → package-needs-recovery,
// access-locked → package-access-locked); a second Start while a session is
// active or paused is the store's one-unfinished-session rule.
export type RunStartRefusal =
  | 'package-incomplete'
  | 'package-needs-recovery'
  | 'package-access-locked'
  | 'live-session-exists';

export interface RunStartInput {
  // The selected tier of this walk; 'base' unless the person starts the paid
  // layer (the readiness evaluation and the verified-tier record both follow
  // it — ADR §3.1 tier, §3.6 full selected layer).
  tier?: Tier;
  // R07 carry-over (ADR §3.9): the foreground window's shown/dismissed
  // guide_ids moved into session scope inside the Start transaction.
  carryGuideHints?: string[];
}

export type RunStartResult = { ok: true; sessionId: string } | { ok: false; reason: RunStartRefusal };

export interface RunControllerState {
  // The engine's committed state, mirrored on every accepted event — the
  // single source the screens read.
  readonly run: RunState;
  readonly start: (input?: RunStartInput) => Promise<RunStartResult>;
  readonly selectStop: (stopId: string) => void;
  readonly selectStory: (stopId: string, storyId: string) => void;
  readonly pauseAudio: () => void;
  readonly stopAudio: () => void;
  readonly resumeAudio: (token: PlayToken) => void;
  readonly guideResume: () => void;
  readonly playMoment: (momentId: string, storyId: string) => void;
}

export function createRunController(deps: RunControllerDeps): ControllerStore<RunControllerState> {
  // The durable row this controller owns; null until a Start transaction
  // commits (checkpoint before that would address no row — ADR §3.1: Idle is
  // the absence of a row).
  let sessionId: string | null = null;
  let store: ControllerStore<RunControllerState> | null = null;

  const orchestrator = new RunOrchestrator({
    location: deps.location,
    audio: deps.audio,
    clock: deps.clock,
    engineConfig: deps.engineConfig,
    pipelineConfig: deps.pipelineConfig,
    route: deps.route,
    stops: deps.stops,
    access: deps.access,
    onCommitted: (before, after) => {
      // The mirror first (the engine state is committed either way), then
      // the durable write — its failure aborts the pending effects below
      // (decision 2).
      store?.setState({ run: after });
      if (sessionId === null) return;
      const progress = durableDelta(before, after);
      if (progress !== null) deps.sessionStore.checkpoint(sessionId, progress);
    },
  });

  const start = async (input: RunStartInput = {}): Promise<RunStartResult> => {
    const tier = input.tier ?? 'base';
    const readiness = await deps.readiness.evaluate({
      locale: deps.route.locale,
      tier,
      grantedTiers: deps.grantedTiers?.(),
    });
    if (readiness.status !== 'ready') return { ok: false, reason: refusalOf(readiness) };
    const accessible = await startAccessibleStops(deps.packageStops, readiness.tierAvailable);
    if (accessible === null) return { ok: false, reason: 'package-incomplete' };
    const id = deps.newSessionId();
    // The Start transaction (ADR §3.3): INSERT + the R07 carry-over in one
    // commit; the store decides the one-unfinished-session rule (§3.1).
    const started = deps.sessionStore.start({
      sessionId: id,
      routeId: deps.route.routeId,
      version: deps.route.version,
      locale: deps.route.locale,
      tier: [...readiness.tierAvailable],
      startedAt: deps.clock.now(),
      carryGuideHints: input.carryGuideHints,
    });
    if (!started.ok) return { ok: false, reason: started.reason };
    sessionId = id;
    orchestrator.start(id, accessible, [...readiness.tierAvailable]);
    return { ok: true, sessionId: id };
  };

  const created = createControllerStore<RunControllerState>(() => ({
    run: initialRunState,
    start,
    selectStop: (stopId) => orchestrator.selectStop(stopId),
    selectStory: (stopId, storyId) => orchestrator.selectStory(stopId, storyId),
    pauseAudio: () => orchestrator.pauseAudio(),
    stopAudio: () => orchestrator.stopAudio(),
    resumeAudio: (token) => orchestrator.resumeAudio(token),
    guideResume: () => orchestrator.guideResume(),
    playMoment: (momentId, storyId) => orchestrator.playMoment(momentId, storyId),
  }));
  store = created;
  return created;
}

// The screen binding (19 §2.2, hooks as controllers).
export function useRunController(store: ControllerStore<RunControllerState>): RunControllerState {
  return useController(store);
}

// The durable delta of one committed event: the monotonic sets and the
// play_seq write-through (ADR §3.1). A rejected callback mutates nothing, an
// unlock touches only derived state — both compare equal and write nothing.
function durableDelta(before: RunState, after: RunState): SessionProgress | null {
  const from = durableView(before);
  const to = durableView(after);
  const progress: SessionProgress = {};
  if (!sameList(from.heard, to.heard)) progress.heard = [...to.heard];
  if (!sameList(from.autoFired, to.autoFired)) progress.autoFired = [...to.autoFired];
  if (from.playSeq !== to.playSeq) progress.playSeq = to.playSeq;
  return progress.heard === undefined && progress.autoFired === undefined && progress.playSeq === undefined
    ? null
    : progress;
}

function durableView(state: RunState): { heard: string[]; autoFired: string[]; playSeq: number } {
  return state.phase === 'Idle'
    ? { heard: [], autoFired: [], playSeq: 0 }
    : { heard: state.heard, autoFired: state.autoFired, playSeq: state.playSeq };
}

// Monotonic add-only lists (ADR §3.1): order is stable, so index equality is
// the whole comparison.
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// The Start seed of accessible_stop_ids (ADR §3.2 derivation): for every
// verified layer, the stops the pinned package names for it — the unlocks of
// past activations had no live session as addressee (ADR §3.5 scope (b)), so
// Start carries them in. null = the package changed under the Start (a layer
// document vanished, stopped matching or stopped parsing after readiness
// passed) — refuse instead of starting an unplayable walk.
async function startAccessibleStops(
  packageStops: RunPackageStops,
  tiers: readonly Tier[],
): Promise<string[] | null> {
  const ids = new Set<string>();
  for (const tier of tiers) {
    const stopIds = await packageStops.stopsOfLayer(tier);
    if (stopIds === null) return null;
    for (const id of stopIds) ids.add(id);
  }
  return [...ids];
}

function refusalOf(readiness: Exclude<Readiness, { status: 'ready' }>): RunStartRefusal {
  switch (readiness.status) {
    case 'incomplete':
      return 'package-incomplete';
    case 'needs-recovery':
      return 'package-needs-recovery';
    case 'access-locked':
      return 'package-access-locked';
  }
}
