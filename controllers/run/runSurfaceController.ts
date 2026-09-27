// G06.02 (issue #278) — the run surface controller: one per opened route.
// It resolves the walk's pinned package (the live row's pin wins — ADR
// G01.03 §3.4; a fresh walk takes the single version/locale on disk),
// joins the route stops with the places' geometry, constructs the run
// controller (G05.05) over the session ports and opens the walk: recover()
// when a live row exists (09 §9.1 — «continue the saved walk» is a state
// the screens read), start() when the surface opens for a fresh handover.
// Every refusal lands as a named reason on the surface state — the screen
// renders it, nothing is invented.
//
// The composition root constructs this controller (createServices); the
// device seams arrive as its ports. Without them the root constructs no run
// member and the screen shows its honest unavailable state — no fake stands
// in for a device adapter (the root's rule since issue #209).
import { useControllerState, createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import {
  createRunController,
  type RunControllerState,
  type RunControllerDeps,
  type RunReadiness,
  type RunSessionStore,
  type RunWakelock,
} from '../useRunController.ts';
import type { RunClock, RunRoute, RunStop } from './runOrchestrator.ts';
import type { EngineConfig } from '../../core/engine/reducer.ts';
import type { PipelineConfig } from '../../core/pipeline/types.ts';
import type { Tier } from '../../services/contentRepo/types.ts';
import type { RunPlaceFact, RunStopFact } from '../../services/contentRepo/runMapFacts.ts';
import type { RunStoryFact } from '../../services/contentRepo/runStoryFacts.ts';
import type { AudioService } from '../../services/audio/service.ts';
import type { PlaybackState } from '../../services/audio/types.ts';
import type { LocationService } from '../../services/location/service.ts';
import type { DownloadAccessPort } from '../../services/download/access.ts';

import { useMemo } from 'react';

// The walk's device seams: the RunControllerDeps fields that are not the
// per-route package facts. The provider owns every default — the surface
// invents none (no clock, no config, no id mint of its own).
export interface RunSessionPorts {
  readonly location: RunControllerDeps['location'];
  readonly audio: RunControllerDeps['audio'];
  readonly clock: RunClock;
  readonly engineConfig: EngineConfig;
  readonly pipelineConfig: PipelineConfig;
  readonly sessionStore: RunSessionStore;
  readonly readiness: RunReadiness;
  readonly packageStops: RunControllerDeps['packageStops'];
  // The download channel's capability port — the only AccessReady delivery
  // path into the engine (ADR G01.03 §3.5); the walk ports always provide it.
  readonly access: DownloadAccessPort;
  readonly wakelock: RunWakelock;
  readonly recovery: RunControllerDeps['recovery'];
  readonly newSessionId: () => string;
  readonly grantedTiers?: () => readonly Tier[];
}

// The walk's pinned package, resolved by the composition root over its own
// disk truth (the root is the one module that value-imports services). The
// stops/places facts are the runMapFacts read of the pinned layer; 'refused'
// carries the named diagnostic the screen renders.
export type RunPinnedPackage =
  | {
      kind: 'pinned';
      version: string;
      locale: string;
      tier: Tier[];
      stops: ReadonlyArray<RunStopFact>;
      places: ReadonlyArray<RunPlaceFact>;
      // The pinned layer's story facts (11 §3: the card's transcript is
      // inspected's) — read beside the map facts; a damaged stops.json
      // never blocks the walk, the card renders its pending word.
      stories: ReadonlyArray<RunStoryFact>;
    }
  | { kind: 'refused'; reason: string };

export interface RunPinnedPackagePort {
  read(routeId: string): Promise<RunPinnedPackage>;
}

export type RunSurfaceState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ready';
      controller: ControllerStore<RunControllerState>;
      stops: ReadonlyArray<RunStop>;
      facts: ReadonlyArray<RunStopFact>;
      places: ReadonlyArray<RunPlaceFact>;
      // The pinned layer's story facts — the panel card's transcript source
      // (11 §3: the transcript is inspected's).
      stories: ReadonlyArray<RunStoryFact>;
      // The audio's computed physical state (09 §6.3), read through the
      // session's own service — the strip's progress line reads it per
      // render; the surface keeps no second copy.
      playback: () => PlaybackState;
      locale: string;
    };

export interface RunSurfaceDeps {
  readonly routeId: string;
  readonly pinnedPackage: RunPinnedPackagePort;
  readonly session: RunSessionPorts;
  readonly localePreference?: readonly string[];
  // G06.04 — the §4.1 dialog's confirmed «Завяршыць і пачаць» carried from
  // the preview through the route params (NAV8): the fresh handover starts
  // through the switch-guide transaction. A cached surface (the walk is
  // already live) ignores it.
  readonly confirmedSwitch?: boolean;
}

export function createRunSurfaceController(deps: RunSurfaceDeps): ControllerStore<RunSurfaceState> {
  const store = createControllerStore<RunSurfaceState>(() => ({ status: 'loading' }));
  void resolve(store, deps);
  return store;
}

async function resolve(store: ControllerStore<RunSurfaceState>, deps: RunSurfaceDeps): Promise<void> {
  const unavailable = (reason: string) => store.setState({ status: 'unavailable', reason });
  let pinned: RunPinnedPackage;
  try {
    pinned = await deps.pinnedPackage.read(deps.routeId);
  } catch {
    return unavailable('run#package-read-failed');
  }
  if (pinned.kind !== 'pinned') return unavailable(pinned.reason);

  const geometry = new Map(pinned.places.map((place) => [place.placeId, place]));
  const stops: RunStop[] = [];
  for (const fact of pinned.stops) {
    const place = geometry.get(fact.placeId);
    // The reader refuses an unplaced stop already; this guard keeps the join
    // total against a port that does not.
    if (!place) return unavailable(`run-map#stop-unplaced:${fact.stopId}`);
    stops.push({
      stopId: fact.stopId,
      lat: place.lat,
      lng: place.lng,
      radius: place.radius,
      storyBaseId: fact.storyBaseId,
      storyExtendedId: fact.storyExtendedId,
    });
  }
  const route: RunRoute = {
    routeId: deps.routeId,
    version: pinned.version,
    locale: pinned.locale,
    tier: [...pinned.tier],
  };
  const controller = createRunController({
    location: deps.session.location,
    audio: deps.session.audio,
    clock: deps.session.clock,
    engineConfig: deps.session.engineConfig,
    pipelineConfig: deps.session.pipelineConfig,
    route,
    stops,
    sessionStore: deps.session.sessionStore,
    readiness: deps.session.readiness,
    packageStops: deps.session.packageStops,
    access: deps.session.access,
    newSessionId: deps.session.newSessionId,
    grantedTiers: deps.session.grantedTiers,
    wakelock: deps.session.wakelock,
    recovery: deps.session.recovery,
  });
  try {
    // 09 §9.1: the surface opening reads the live row — a restored walk is a
    // state the screens read, never an action the controller takes.
    await controller.getState().recover();
  } catch {
    return unavailable('run#recovery-failed');
  }
  if (controller.getState().run.phase === 'Idle') {
    // No live row for this route: the surface opened for a fresh handover
    // (the preview gated the §4.1 dialog and handed over), so the walk
    // starts here — through the confirmed switch-guide transaction when the
    // dialog's «Завяршыць і пачаць» led here (G06.04). A refusal is the
    // named reason — the walk never half-starts.
    const started = await controller
      .getState()
      .start(deps.confirmedSwitch ? { confirmedSwitch: true } : undefined);
    if (!started.ok) return unavailable(started.reason);
  }
  store.setState({
    status: 'ready',
    controller,
    stops,
    facts: pinned.stops,
    places: pinned.places,
    stories: pinned.stories,
    playback: () => deps.session.audio.playbackState(),
    locale: pinned.locale,
  });
}

// --- React bindings (hooks as controllers, 19 §2.2) ---------------------------

export function useRunSurface(
  factory:
    | {
        create(
          routeId: string,
          options?: { confirmedSwitch?: boolean },
        ): ControllerStore<RunSurfaceState>;
      }
    | undefined,
  routeId: string,
  confirmedSwitch?: boolean,
): RunSurfaceState | null {
  // The confirmed-switch flag is a mount input (the §4.1 handover's route
  // param): the factory decides with it whether the fresh surface starts
  // through the switch transaction; a cached surface ignores it.
  const store = useMemo(
    () => factory?.create(routeId, confirmedSwitch ? { confirmedSwitch: true } : undefined),
    [factory, routeId, confirmedSwitch],
  );
  return useControllerState(store);
}

// The run controller's state for the ready surface — a null-tolerant
// subscription, since the surface resolves asynchronously (the shared
// useControllerState keeps the one shape).
export function useRunState(store: ControllerStore<RunControllerState> | null): RunControllerState | null {
  return useControllerState(store);
}
