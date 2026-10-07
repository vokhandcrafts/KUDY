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
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
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
import type { LocationStatus } from '../../services/location/types.ts';
import type { DownloadAccessPort } from '../../services/download/access.ts';
import { useStoreState } from '../useControllerStore.ts';

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
  // G07.02 — injected by the composition root over its moment controller
  // (ADR G01.02 §3.2/§3.8): the process-wide moment counter and the idle
  // launch facts Start reads. A provider value for these is overridden by
  // the root — one counter per process, the root's.
  readonly nextMomentSeq?: () => number;
  readonly currentMomentPlay?: () => {
    readonly momentId: string;
    readonly storyId: string;
    readonly seq: number;
    readonly paused: boolean;
  } | null;
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
      // G21.21 (ADR G21.20 §3.2, owner edit 1): the pinned version's
      // available audio locales — the default pin's selection source and the
      // explicit handover choice's validation set.
      audioLocales: ReadonlyArray<string>;
      stops: ReadonlyArray<RunStopFact>;
      places: ReadonlyArray<RunPlaceFact>;
      // The pinned layer's story facts (11 §3: the card's transcript is
      // inspected's) — read beside the map facts; a damaged stops.json
      // never blocks the walk, the card renders its pending word.
      stories: ReadonlyArray<RunStoryFact>;
      // G06.05 (issue #280, AC3): the extended layer's story facts when the
      // pin carries the tier — the transcript switch's second source. Empty
      // when the tier is absent or its stops.json is damaged (the same
      // never-blocks rule as the base layer).
      storiesExtended: ReadonlyArray<RunStoryFact>;
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
      // G06.05 (issue #280, AC3): the extended layer's story facts when the
      // pin carries the tier.
      storiesExtended: ReadonlyArray<RunStoryFact>;
      // The audio's computed physical state (09 §6.3), read through the
      // session's own service — the strip's progress line reads it per
      // render; the surface keeps no second copy.
      playback: () => PlaybackState;
      // G06.05 (issue #280, AC4): the location service's live status — the
      // denied/stalled banners of 11 §7 read it per render (any engine or
      // panel state change re-renders the screen and re-reads it).
      locationStatus: () => LocationStatus;
      locale: string;
      // G21.21 (ADR G21.20 §3.2): the effective audio pin of the surface —
      // null = the text-only session; the screens read it, the engine owns
      // the truth.
      audioLocale: string | null;
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
  // G21.21 (ADR G21.20 §3.2, owner edit 1): the preview's explicit audio
  // choice carried through the route params. It is validated against the
  // pinned version's available audio locales; absent or foreign falls to the
  // owner's default rule — the walk's text locale when its audio exists,
  // else English, else the text-only session (no audio anywhere).
  readonly audioParam?: string | null;
  // G07.05 — the R07 carry source (ADR G01.03 §3.9): the composition root
  // hands in the hint controller's foreground-window ids, and the fresh
  // Start's transaction moves them into session scope. Read at start time —
  // the window's facts are whatever the hint controller recorded by then.
  readonly carryGuideHints?: () => readonly string[];
}

// The resolved audio pin of a fresh handover (ADR G21.20 §3.2, owner edit 1):
// the explicit choice when it names an available audio locale, else the walk's
// text locale when its audio exists, else English when it exists, else null —
// the text-only session.
export function resolveAudioPin(
  textLocale: string,
  audioLocales: ReadonlyArray<string>,
  audioParam?: string | null,
): string | null {
  if (audioParam != null && audioLocales.includes(audioParam)) return audioParam;
  if (audioLocales.includes(textLocale)) return textLocale;
  if (audioLocales.includes('en')) return 'en';
  return null;
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
    nextMomentSeq: deps.session.nextMomentSeq,
    currentMomentPlay: deps.session.currentMomentPlay,
  });
  try {
    // 09 §9.1: the surface opening reads the live row — a restored walk is a
    // state the screens read, never an action the controller takes.
    await controller.getState().recover();
  } catch {
    return unavailable('run#recovery-failed');
  }
  // G21.21: the effective audio pin of the surface — the fresh handover's
  // resolved one, or the restored row's surviving pin (the §3.4 restore
  // resolution); the screens read it, the engine owns the truth.
  let audioLocale: string | null = null;
  if (controller.getState().run.phase === 'Idle') {
    // No live row for this route: the surface opened for a fresh handover
    // (the preview gated the §4.1 dialog and handed over), so the walk
    // starts here — through the confirmed switch-guide transaction when the
    // dialog's «Завяршыць і пачаць» led here (G06.04). The R07 carry rides
    // the same input (ADR G01.03 §3.9), the resolved audio pin rides its
    // own input (ADR G21.20 §3.2). A refusal is the named reason — the walk
    // never half-starts.
    const carry = deps.carryGuideHints?.();
    const audioPin = resolveAudioPin(pinned.locale, pinned.audioLocales, deps.audioParam);
    const started = await controller
      .getState()
      .start({
        audioLocale: audioPin,
        ...(deps.confirmedSwitch ? { confirmedSwitch: true } : {}),
        ...(carry !== undefined && carry.length > 0 ? { carryGuideHints: [...carry] } : {}),
      });
    if (!started.ok) return unavailable(started.reason);
    audioLocale = audioPin;
  } else {
    const recovery = controller.getState().recovery;
    audioLocale = recovery.status === 'restored' ? recovery.audioPin : null;
  }
  store.setState({
    status: 'ready',
    controller,
    stops,
    facts: pinned.stops,
    places: pinned.places,
    stories: pinned.stories,
    storiesExtended: pinned.storiesExtended,
    playback: () => deps.session.audio.playbackState(),
    locationStatus: () => deps.session.location.status(),
    locale: pinned.locale,
    audioLocale,
  });
}

// --- React bindings (hooks as controllers, 19 §2.2) ---------------------------

export function useRunSurface(
  factory:
    | {
        create(
          routeId: string,
          options?: { confirmedSwitch?: boolean; audio?: string | null },
        ): ControllerStore<RunSurfaceState>;
      }
    | undefined,
  routeId: string,
  confirmedSwitch?: boolean,
  audio?: string | null,
): RunSurfaceState | null {
  // The confirmed-switch flag and the audio choice are mount inputs (the
  // §4.1 handover's route params): the factory decides with them whether the
  // fresh surface starts through the switch transaction and which audio pin
  // the walk carries; a cached surface ignores both.
  const store = useMemo(
    () =>
      factory?.create(
        routeId,
        {
          ...(confirmedSwitch ? { confirmedSwitch: true } : {}),
          ...(audio !== undefined ? { audio } : {}),
        },
      ),
    [factory, routeId, confirmedSwitch, audio],
  );
  return useStoreState(store);
}

// The run controller's state for the ready surface — a null-tolerant
// subscription, since the surface resolves asynchronously (the shared
// useStoreState of useControllerStore.ts keeps the one shape).
export function useRunState(store: ControllerStore<RunControllerState> | null): RunControllerState | null {
  return useStoreState(store);
}
