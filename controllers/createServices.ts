import { evaluatePackage } from '../services/contentRepo/contentRepo.ts';
import { readLayerFacts } from '../services/contentRepo/inventory.ts';
import { isSafeSegment } from '../services/safe-path.ts';
import { readRunMapFacts } from '../services/contentRepo/runMapFacts.ts';
import { readRunStoryFacts } from '../services/contentRepo/runStoryFacts.ts';
import type {
  BundlesStore,
  EvaluateInput,
  InventoryState,
  PackageStore,
  Readiness,
  Sha256,
  Tier,
} from '../services/contentRepo/types.ts';
import type { ActivationResult, LayerKey } from '../services/download/types.ts';
import { createOriginCatalogLoader } from '../services/catalog/loader.ts';
import { createCatalogService } from '../services/catalog/catalogService.ts';
import { createCatalogController, type CatalogControllerState } from './catalog/catalogController.ts';
import {
  createPreviewController,
  type PreviewControllerState,
  type PreviewRunSessionPort,
} from './catalog/previewController.ts';
import {
  createNearbySurfaceController,
  type NearbySurfaceBinding,
} from './nearby/nearbySurfaceController.ts';
import { createPlaceDetailController, type PlaceDetailBinding } from './place/placeDetailController.ts';
import { readMomentFacts } from '../services/contentRepo/momentFacts.ts';
import { createMomentPlayController, type MomentPlayBinding, type MomentPlayState } from './moment/momentPlayController.ts';
import type { AudioService } from '../services/audio/service.ts';
import type { LocationService } from '../services/location/service.ts';
import {
  createRunSurfaceController,
  type RunPinnedPackagePort,
  type RunSessionPorts,
  type RunSurfaceState,
} from './run/runSurfaceController.ts';
import type { RunControllerState } from './useRunController.ts';
import { createMyKudyController, type MyKudyState, type SessionHistoryPort } from './myKudyController.ts';
import type { ControllerStore } from './createControllerStore.ts';

export interface ServicePorts {
  // The package store is the seam services/contentRepo already defines
  // (G04.03, types.ts); further ports join as their services are implemented.
  readonly packageStore?: PackageStore;
  // G06.01.a — the configured public origin the catalog loader binds
  // (21 §3.3; the app passes it from its environment) and the digest that
  // pins the fetched index to its pointer. The digest adapter joins with the
  // device crypto task; until then the root constructs no catalog service
  // and the surfaces show their honest unavailable state.
  readonly catalogOrigin?: string;
  readonly catalogSha256?: Sha256;
  // G06.01.b — the preview button's disk truth: the read-only bundles store
  // (09 §7 layout) the layer facts read; the verify verdict and the download
  // channel; the live-session read of §4.1. Each stays absent until its
  // device adapter lands (TR-10 filesystem, G08 entitlement) — the
  // derivation fails closed on an absent port, it never invents a state.
  readonly bundlesStore?: BundlesStore;
  readonly evaluateLayer?: (input: {
    routeId: string;
    version: string;
    locale: string;
    tier: Tier;
  }) => Promise<Readiness>;
  readonly downloadLayer?: (key: LayerKey) => Promise<ActivationResult>;
  readonly runSession?: PreviewRunSessionPort;
  // G06.02 — the walk's device seams (G05.02–G05.05 contracts): the run
  // surface controller is constructed only when they are all present. Until
  // the device adapters land (G05.02.c location, G05.03.b audio, TR-10
  // filesystem/db), the run surfaces show their honest unavailable state —
  // the same rule the catalog member follows.
  readonly run?: { readonly session: RunSessionPorts };
  // G06.04 — the My KUDY history read (services/db.listSessionHistory over
  // the device driver). Absent until TR-10 lands: the screen shows its
  // honest unavailable state.
  readonly sessionHistory?: SessionHistoryPort;
  // G07.01 (issue #281) — the ONE location service instance the app owns
  // (19 §3.3: one OS subscription). The run sessions and the Nearby surface
  // receive the same instance; absent until the G05.02.c adapter lands, in
  // which case the Nearby surface renders its review view.
  readonly location?: LocationService;
  // G07.02 (issue #282) — the ONE audio service instance the app owns
  // (ADR G01.02 §3: one physical player). The run sessions and the moment
  // controller receive the same instance; absent until the G05.03.b adapter
  // lands, in which case the place detail renders its honest no-Play state.
  readonly audio?: AudioService;
  // G07.02 — the live session's moment entry (the PreviewRunSessionPort
  // idiom): true iff the live session's engine accepted the moment launch.
  // G07.03 extends it with the routed manual stop and the live-pause resume
  // of a session-owned launch (ADR G01.02 §3.4/§3.5). Optional: when absent
  // the root resolves the one live surface itself — a provider value (the
  // tests' port-shaped arrangement) overrides the root's resolver.
  readonly sessionMoment?: {
    readonly playMoment: (momentId: string, storyId: string, path?: string) => boolean;
    readonly stopMoment?: () => boolean;
    readonly resumeMoment?: () => boolean;
  };
  // G07.02 — an optional deterministic counter for tests; the root mints its
  // own process-wide counter when absent (one counter per process, ADR
  // G01.02 §3.2).
  readonly nextMomentSeq?: () => number;
  // G07.02 — the clock the FocusRegain threshold reads (§3.7); the root
  // defaults to the wall clock when absent.
  readonly now?: () => number;
}

export interface Services {
  readonly contentRepo:
    | {
        readonly evaluatePackage: (input: EvaluateInput) => Promise<Readiness>;
      }
    | undefined;
  readonly catalog:
    | {
        readonly controller: ControllerStore<CatalogControllerState>;
      }
    | undefined;
  // G06.01.b — the preview controller factory: one store per opened route
  // (the state lives per route_id), over the shared ports.
  readonly preview:
    | {
        readonly create: (routeId: string) => ControllerStore<PreviewControllerState>;
      }
    | undefined;
  // G06.02 — one run surface controller per opened route: it resolves the
  // walk's pinned package (the live row's pin wins — ADR G01.03 §3.4; a
  // fresh walk takes the single version/locale on disk), constructs the run
  // controller over the session ports and opens the walk (recover, else
  // start). The screen renders the surface state. The surface is cached per
  // route (G06.04, NAV7): re-entering Run through «Прагулка» reuses the
  // same controller, so the panel position and the inspected card are the
  // ones the person left behind.
  readonly run:
    | {
        readonly create: (
          routeId: string,
          options?: { readonly confirmedSwitch?: boolean },
        ) => ControllerStore<RunSurfaceState>;
      }
    | undefined;
  // G06.04 (11 §1, NAV7) — the read-only live-walk fact behind the city mode
  // button: «Прагулка» returns to the Run surface of the app's one live
  // walk; with no live walk the button has no target and no surface shows
  // it. Read-only — the same port the preview holds; sessions are written
  // by the run controller alone.
  readonly walk:
    | {
        readonly liveSession: () => { routeId: string; title: string } | null;
      }
    | undefined;
  // G06.04 — the My KUDY history controller over the sessionHistory port.
  readonly history:
    | {
        readonly controller: ControllerStore<MyKudyState>;
      }
    | undefined;
  // G07.01 (issue #281) — the Nearby (Побач) surface binding: the offers
  // store over the shared catalog service plus the location service the
  // arming guard uses (undefined until the adapter lands — the review view
  // is then the honest default). Exists when the catalog service does: the
  // offers are its discovery-index projection.
  readonly nearby:
    | {
        readonly create: () => NearbySurfaceBinding;
      }
    | undefined;
  // G07.02 (issue #282) — the place detail binding: one store per opened
  // place (the offer facts of the validated catalog projection plus the
  // place's moment teasers from the downloaded packages). Exists when the
  // catalog service does — the teasers are rendered without Play when the
  // audio port is absent.
  readonly place:
    | {
        readonly create: (placeId: string) => PlaceDetailBinding;
      }
    | undefined;
  // G07.02 — the ONE moment play controller (ADR G01.02 §3.8: the no-session
  // launch lives here). Exists only with the audio port; the playback state
  // survives navigation — the place detail and the Run panel both read it.
  readonly moment: MomentPlayBinding | undefined;
}

export function createServices(ports: ServicePorts): Services {
  const {
    packageStore,
    catalogOrigin,
    catalogSha256,
    bundlesStore,
    evaluateLayer,
    downloadLayer,
    runSession,
    sessionHistory,
    location,
    audio,
    sessionMoment,
    nextMomentSeq,
    now,
  } = ports;
  const catalogLoader = catalogOrigin ? createOriginCatalogLoader(catalogOrigin) : undefined;
  // MVP display-locale order: Belarusian first (21 §3.2 allowlist; the
  // UI-locale selection is G06.05/L02 and will replace this). One preference
  // value for the catalog service, the preview controller and the moment
  // facts reader.
  const localePreference: readonly string[] = ['be', 'en'];
  const catalogService = catalogLoader &&
    catalogSha256 &&
    createCatalogService({ loader: catalogLoader, sha256: catalogSha256 }, { localePreference });
  // G06.04 — the run surface cache (NAV7): one surface controller per route
  // for the whole app run, so «Прагулка» returns to the panel position and
  // the inspected card the person left. The wrapper store below evicts a
  // surface when its walk stops being the live one (its own End, or a
  // confirmed switch to another guide) — a stale surface never renders and
  // a repeat walk opens a fresh one (new session_id, clean sets). The cache
  // is also G07.03's live-session source: the moment routing resolves the
  // one live walk here (the one-live-session rule, ADR G01.03 §3.1).
  const runSurfaces = new Map<string, ControllerStore<RunSurfaceState>>();
  // G07.02 — the process-wide moment counter (ADR G01.02 §3.2: ONE counter
  // over every moment launch) and the one moment play controller over the
  // one audio instance. Both live only with the audio port.
  let momentSeqCounter = 0;
  const rootNextMomentSeq = nextMomentSeq ?? (() => ++momentSeqCounter);
  // G07.03 — the root's own session routing (ADR G01.02 §3.4/§3.8): the
  // one-live-session rule (ADR G01.03 §3.1) means the cached surfaces hold
  // at most one live walk, so the resolver finds it per call — no registry
  // to keep in step with the engine, no second token mint. A moment token
  // the idle controller did not mint belongs to this session's engine.
  const liveSurfaceController = (): ControllerStore<RunControllerState> | null => {
    for (const surfaceStore of runSurfaces.values()) {
      const surface = surfaceStore.getState();
      if (surface.status !== 'ready') continue;
      const run = surface.controller.getState().run;
      if (run.phase === 'Active' || run.phase === 'Paused') return surface.controller;
    }
    return null;
  };
  const rootSessionMoment = {
    playMoment: (momentId: string, storyId: string, path?: string): boolean => {
      const controller = liveSurfaceController();
      return controller !== null && controller.getState().playMoment(momentId, storyId, path);
    },
    stopMoment: (): boolean => {
      const controller = liveSurfaceController();
      if (controller === null) return false;
      const run = controller.getState().run;
      if (run.phase !== 'Active' && run.phase !== 'Paused') return false;
      const playing = run.playing;
      if (playing === null || playing.owner !== 'moment' || playing.paused) return false;
      controller.getState().stopAudio();
      return true;
    },
    resumeMoment: (): boolean => {
      const controller = liveSurfaceController();
      if (controller === null) return false;
      const run = controller.getState().run;
      if (run.phase !== 'Active' && run.phase !== 'Paused') return false;
      const playing = run.playing;
      if (playing === null || playing.owner !== 'moment' || !playing.paused) return false;
      controller.getState().resumeAudio({ kind: 'moment', ref: playing.momentId, seq: playing.seq });
      return true;
    },
  };
  const momentPlay = audio
    ? createMomentPlayController({
        audio,
        nextSeq: rootNextMomentSeq,
        sessionMoment: sessionMoment ?? rootSessionMoment,
        now: now ?? (() => Date.now()),
      })
    : undefined;
  // The idle launch facts Start reads (ADR §3.8: Start inherits the sounding
  // moment instead of stopping it) — a paused launch inherits nothing.
  const currentMomentPlay = momentPlay
    ? (): { momentId: string; storyId: string; seq: number; paused: boolean } | null => {
        const state: MomentPlayState = momentPlay.store.getState();
        return state.kind === 'playing'
          ? { momentId: state.momentId, storyId: state.storyId, seq: state.token.seq, paused: state.paused }
          : null;
      }
    : undefined;
  // G07.02 — the moment facts reader over the downloaded packages (the root
  // is the one module that value-imports services); absent without a bundles
  // store — the place detail renders without teasers.
  const momentsReader = bundlesStore
    ? () => readMomentFacts(bundlesStore, { locales: localePreference })
    : undefined;
  // The preview button's inventory port: the asked layer's disk facts read
  // through the shared readLayerFacts reader (G04.04.a) — the version
  // directory decides not_downloaded, the layer facts decide
  // partial/ready. Catalog-sourced identifiers are untrusted input; an
  // unsafe one never reaches the store (the safe-segment idiom).
  const inventoryPort = bundlesStore && {
    layerState: async (input: {
      routeId: string;
      version: string;
      locale: string;
      tier: Tier;
    }): Promise<{ state: InventoryState; missingCount: number | null }> => {
      for (const value of [input.routeId, input.version, input.locale]) {
        if (!isSafeSegment(value)) return { state: 'not_downloaded', missingCount: null };
      }
      const versions = await bundlesStore.listDir(`bundles/${input.routeId}`);
      if (!versions || !versions.includes(input.version)) {
        return { state: 'not_downloaded', missingCount: null };
      }
      const facts = await readLayerFacts(
        bundlesStore,
        `bundles/${input.routeId}/${input.version}/${input.locale}/${input.tier}`,
      );
      return { state: facts.state, missingCount: facts.missingCount };
    },
  };
  // The run surface's pinned-package port, implemented here over the root's
  // own disk seams (the root is the one module that value-imports services):
  // the live row's version/locale/tier pin wins (ADR G01.03 §3.4 — a newer
  // catalog never substitutes a live walk's files); a fresh walk takes the
  // single version on disk and the first preferred locale present. Anything
  // ambiguous, absent or damaged is a named refusal — never a guess.
  const isTierValue = (value: string): value is Tier => value === 'base' || value === 'extended';
  const runPorts = ports.run?.session;
  const pinnedPackage: RunPinnedPackagePort | undefined =
    runPorts && bundlesStore
      ? {
          read: async (routeId) => {
            if (!isSafeSegment(routeId)) return { kind: 'refused', reason: 'run#unsafe-route-id' };
            const live = await runPorts.recovery.read(routeId);
            let version: string;
            let locale: string;
            let tier: Tier[];
            if (
              live &&
              live.routeId === routeId &&
              (live.row.state === 'active' || live.row.state === 'paused')
            ) {
              version = live.row.version;
              locale = live.row.locale;
              tier = live.row.tier.filter(isTierValue);
            } else {
              const versions = await bundlesStore.listDir(`bundles/${routeId}`);
              if (!versions || versions.length === 0) {
                return { kind: 'refused', reason: 'run#package-not-downloaded' };
              }
              if (versions.length > 1) return { kind: 'refused', reason: 'run#package-ambiguous' };
              version = versions[0];
              const locales = await bundlesStore.listDir(`bundles/${routeId}/${version}`);
              if (!locales || locales.length === 0) {
                return { kind: 'refused', reason: 'run#locale-missing' };
              }
              locale = localePreference.find((candidate) => locales.includes(candidate)) ?? locales[0];
              tier = ['base'];
            }
            const facts = await readRunMapFacts(
              bundlesStore,
              `bundles/${routeId}/${version}/${locale}/base`,
              { routeId, version },
            );
            if (!facts.ok) return { kind: 'refused', reason: facts.diagnostic };
            // The panel card's transcript source (11 §3: the transcript is
            // inspected's), read from the same layer directory as the map
            // facts. A damaged stops.json never blocks the walk — the card
            // renders its honest pending word; the engine's truth is the
            // walk, not the card.
            const stories = await readRunStoryFacts(
              bundlesStore,
              `bundles/${routeId}/${version}/${locale}/base`,
            );
            return {
              kind: 'pinned',
              version,
              locale,
              tier,
              stops: facts.stops,
              places: facts.places,
              stories: stories.ok ? stories.stories : [],
            };
          },
        }
      : undefined;
  // G06.04 — the run surface cache (NAV7) is declared above, beside the
  // moment routing it also serves; the wrapper store below is its only
  // eviction writer.
  const findCachedSurface = (sessionId: string): string | null => {
    for (const [routeId, store] of runSurfaces) {
      const surface = store.getState();
      if (surface.status !== 'ready') continue;
      const run = surface.controller.getState().run;
      if (run.phase !== 'Idle' && run.sessionId === sessionId) return routeId;
    }
    return null;
  };
  // The switch-aware session store: the ports' store with the two
  // retirement points wired. finish() evicts the finished walk's cached
  // surface (the engine already went through its own End — no retire);
  // startSwitch() retires the switched-away surface first (its controller's
  // engine mirror becomes Ended and its resources are released — the row
  // was finished by the switch transaction, not by this engine) and then
  // evicts it. The wrapper is the composition root's wiring: it owns no
  // rule of its own.
  const runSessionWithRetirement: RunSessionPorts | undefined = runPorts && {
    ...runPorts,
    sessionStore: {
      ...runPorts.sessionStore,
      finish: (sessionId, input) => {
        runPorts.sessionStore.finish(sessionId, input);
        const cached = findCachedSurface(sessionId);
        if (cached !== null) runSurfaces.delete(cached);
      },
      startSwitch: (input, meta) => {
        const result = runPorts.sessionStore.startSwitch(input, meta);
        if (result.ok) {
          const cached = findCachedSurface(result.finishedSessionId);
          const store = cached === null ? undefined : runSurfaces.get(cached);
          const surface = store?.getState();
          if (cached !== null && surface && surface.status === 'ready') {
            runSurfaces.delete(cached);
            surface.controller.getState().retire();
          }
        }
        return result;
      },
    },
  };
  return {
    contentRepo: packageStore && {
      evaluatePackage: (input) => evaluatePackage(packageStore, input),
    },
    // A service member exists only when its port is provided (the root's
    // rule): with no origin bound there is no catalog to render and the
    // surfaces show their honest unavailable state.
    catalog: catalogService && {
      controller: createCatalogController(catalogService),
    },
    preview: catalogService && {
      create: (routeId) =>
        createPreviewController(
          {
            service: catalogService,
            inventory: inventoryPort,
            evaluate: evaluateLayer ? { evaluate: evaluateLayer } : undefined,
            download: downloadLayer ? { activate: downloadLayer } : undefined,
            runSession,
            localePreference,
          },
          routeId,
        ),
    },
    run: runPorts && bundlesStore && pinnedPackage && {
      create: (routeId, options) => {
        // The cached surface is the walk's own re-entry (NAV7): the same
        // controller, the panel position kept. A fresh create with the
        // confirmed switch flag means the person confirmed §4.1's
        // «Завяршыць і пачаць» on another route — that surface was evicted
        // by the switch, or it never existed here.
        const cached = runSurfaces.get(routeId);
        if (cached) return cached;
        const store = createRunSurfaceController({
          routeId,
          pinnedPackage,
          // The root injects its moment fields over the provider's ports —
          // one process-wide counter and one idle-launch fact source
          // (ADR G01.02 §3.2/§3.8); a provider value for them is overridden.
          // The retirement wrapper of G06.04 stays the base of the spread.
          session: {
            ...(runSessionWithRetirement ?? runPorts),
            nextMomentSeq: rootNextMomentSeq,
            currentMomentPlay,
          },
          localePreference,
          confirmedSwitch: options?.confirmedSwitch,
        });
        runSurfaces.set(routeId, store);
        // A refused surface (the walk never started) is not the walk's
        // anchor — NAV7 keeps only a living walk's position. Evict on
        // 'unavailable': the transient reasons (the package read, the
        // recovery, the one-live-session rule) may clear, and the next
        // create re-resolves instead of serving the cached refusal forever.
        store.subscribe((state) => {
          if (state.status === 'unavailable') runSurfaces.delete(routeId);
        });
        return store;
      },
    },
    walk: runSession && {
      liveSession: () => runSession.liveSession(),
    },
    history: sessionHistory && {
      controller: createMyKudyController(sessionHistory),
    },
    nearby: catalogService && {
      create: () =>
        createNearbySurfaceController({
          service: catalogService,
          location,
          locale: localePreference[0] ?? 'be',
        }),
    },
    place: catalogService && {
      create: (placeId) =>
        createPlaceDetailController({
          service: catalogService,
          moments: momentsReader,
          placeId,
        }),
    },
    moment: momentPlay,
  };
}
