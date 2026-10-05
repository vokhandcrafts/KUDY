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
  TeaserAudioProbe,
  Tier,
} from '../services/contentRepo/types.ts';
import type { ActivationResult, LayerKey } from '../services/download/types.ts';
import { createOriginCatalogLoader } from '../services/catalog/loader.ts';
import { createCatalogService } from '../services/catalog/catalogService.ts';
import { createCatalogController, type CatalogControllerState } from './catalog/catalogController.ts';
import { loadDiscoveryIndex, type DiscoverySnapshotStore } from '../services/contentRepo/discoveryIndex.ts';
import {
  createDiscoveryController,
  type DiscoveryAnalyticsPort,
  type DiscoveryControllerState,
} from './useDiscoveryController.ts';
import {
  createPreviewController,
  type PreviewControllerState,
  type PreviewRunSessionPort,
} from './catalog/previewController.ts';
import {
  createNearbySurfaceController,
  type NearbySurfaceBinding,
} from './nearby/nearbySurfaceController.ts';
import {
  createNearbyHintController,
  type GuideHintPoint,
  type GuideHintStore,
  type GuideHintTelemetryPort,
  type NearbyHintBinding,
  type NearbyHintRunSource,
} from './useNearbyController.ts';
import type { GuideHintValues } from '../services/config.ts';
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
import { createUiLocaleStore, type UiLocalePersistence, type UiLocaleSwitch } from './uiLocaleStore.ts';
import {
  createFeedbackController,
  type FeedbackUiState,
} from './useFeedbackController.ts';
import type { FeedbackSync } from '../services/feedbackSync.ts';
import type { SqlDriver } from '../services/db/types.ts';
import * as feedbackRepository from '../services/feedbackRepository.ts';
import type { ControllerStore } from './createControllerStore.ts';
import {
  createCommerceController,
  type CommerceControllerState,
  type CommercePort,
  type TelemetryPort,
} from './commerce/commerceController.ts';

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
  // G22.02 (issue #607) — the teaser-audio probe from the same composition
  // root as the bundles store: wherever a teaser reader is supplied, its
  // probe is supplied too (the reader itself refuses a probe-less contract).
  readonly teaserAudioProbe?: TeaserAudioProbe;
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
  // G08.05 (issue #292) — the commerce seam (G08.04 Рашэнне 1: the chain's
  // consumer). The root resolves it from the store session (the G08.03
  // service) and the purchase-chain state when those adapters exist;
  // absent, the preview renders no offer — fail closed, the idiom of every
  // optional port here.
  readonly commerce?: CommercePort;
  // G08.05 — the local telemetry recorder behind the commerce events (the
  // G01.05 table's recording policy verbatim: local_recording always,
  // sending consent-gated — the consented sender is G09's and joins later
  // behind this same seam).
  readonly events?: TelemetryPort;
  // G15.03 — the derived discovery snapshot store (zone A) and the analytics
  // port. Each stays absent until its device adapter lands (the same honest
  // unavailable pattern as the catalog digest): without them the discovery
  // service is not constructed and the surfaces render their named state.
  readonly discoverySnapshot?: DiscoverySnapshotStore;
  readonly discoveryAnalytics?: DiscoveryAnalyticsPort;
  // G14.04.d (issue #305) — the optional durable seam of the UI-locale
  // switch: reads the stored choice at composition, writes every switch.
  // Absent (the device db adapter is TR-10) the choice lives for the
  // session; the `settings` row joins with the adapter (the consent idiom).
  readonly uiLocalePersistence?: UiLocalePersistence;
  // G07.05 (issue #284) — the R07 hint seams: the durable guide_hint_state/
  // guide_hint_last store over services/db (zone B), the public points
  // projection and the accepted values document (ADR G07.04 §3). The app
  // foreground fact and the local hint-event recorder are optional sub-seams;
  // without the fact the controller shows nothing (fail closed). Absent, the
  // root constructs no hint controller and no surface renders a hint card.
  readonly guideHints?: {
    readonly store: GuideHintStore;
    readonly values: GuideHintValues;
    readonly points: () => readonly GuideHintPoint[];
    readonly foreground?: () => boolean;
    readonly telemetry?: GuideHintTelemetryPort;
  };
  // G16.03 (issue #74) — the feedback seams over the durable zone B tables:
  // the device driver the G16.02 repository reads and the delivery sync
  // (services/feedbackSync). Both are device-adapter territory (TR-10 and
  // the functions origin); absent, the root constructs no feedback member
  // and the surfaces render their honest unavailable state.
  readonly feedback?: {
    readonly driver: SqlDriver;
    readonly sync: FeedbackSync;
  };
}

export interface Services {
  // G06.05 (issue #280): the display locale the string catalogs render in —
  // G14.04.d (issue #305) reads it through the ui-locale store below: the
  // value the switch holds, changing without a services rebuild.
  readonly locale: string;
  // G14.04.d (issue #305) — the UI-locale switch (the L02 selection): the
  // My KUDY row writes be/en/uk through it, the screens subscribe.
  readonly uiLocale: UiLocaleSwitch;
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
  // G08.05 — the commerce controller factory: one store per opened route
  // (the preview controller idiom), over the commerce and telemetry ports.
  // The offer's only home is the preview surface (11 C26) — the Run surface
  // never constructs one.
  readonly commerce:
    | {
        readonly create: (routeId: string) => ControllerStore<CommerceControllerState>;
      }
    | undefined;
  // G15.03 — the discovery controller: the human choice and the index state
  // (21 §2). Constructed only when the origin, the digest and the snapshot
  // ports all landed; otherwise the surfaces render their honest unavailable
  // state — no inert fake controller stands in.
  readonly discovery:
    | {
        readonly controller: ControllerStore<DiscoveryControllerState>;
      }
    | undefined;
  // G07.05 (issue #284) — the ONE R07 hint controller (19 §2.2): the quiet
  // guide-nearby card over the accepted ADR G07.04 contract, the owner of
  // the guide_hint_state/guide_hint_last records. Exists only when the
  // location, audio and catalog services AND the guideHints seams are all
  // landed — a hint feature without its durable limits, its public points or
  // its values document is no feature.
  readonly hints: NearbyHintBinding | undefined;
  // G16.03 (issue #74) — the ONE feedback controller (19 §2.2): the voluntary
  // rating form, the once-per-session End invitation and the own-ratings
  // list. Exists only with the driver+sync feedback ports; the surfaces
  // render their honest unavailable state without it.
  readonly feedback:
    | {
        readonly controller: ControllerStore<FeedbackUiState>;
      }
    | undefined;
}

export function createServices(ports: ServicePorts): Services {
  const {
    packageStore,
    catalogOrigin,
    catalogSha256,
    bundlesStore,
    teaserAudioProbe,
    evaluateLayer,
    downloadLayer,
    runSession,
    sessionHistory,
    location,
    audio,
    sessionMoment,
    nextMomentSeq,
    now,
    commerce,
    events,
    discoverySnapshot,
    discoveryAnalytics,
    guideHints,
    uiLocalePersistence,
  } = ports;
  const catalogLoader = catalogOrigin ? createOriginCatalogLoader(catalogOrigin) : undefined;
  // MVP display-locale order: Belarusian first (21 §3.2 allowlist; G14.04.d's
  // ui-locale switch below changes the chrome words' display locale, this
  // content-display preference stays the composition fact until the uk
  // content wave lands — G14.04.c/f). One preference value for the catalog
  // service, the preview controller and the moment facts reader.
  const localePreference: readonly string[] = ['be', 'en'];
  // G14.04.d (issue #305) — the UI-locale switch (the L02 selection G06.05
  // deferred here): the chrome words' display locale, switchable in My KUDY
  // without a restart. The persistence port is optional — absent (the app
  // build today, the device db adapter is TR-10) the choice lives for the
  // session; the durable `settings` row joins with the adapter.
  const uiLocale = createUiLocaleStore(uiLocalePersistence);
  // G21.17 (issue #551): the projection preference resolves per call — the
  // selected UI language first, the composition fallback after — so a switch
  // re-projects the titles through the same refresh (the subscription below).
  const catalogService = catalogLoader &&
    catalogSha256 &&
    createCatalogService({ loader: catalogLoader, sha256: catalogSha256 }, () => ({
      localePreference: [uiLocale.current(), ...localePreference],
    }));
  // G15.03 — the verified index service: the same origin loader and digest
  // the catalog uses, plus the derived snapshot store (zone A). The
  // controller is constructed only over the complete port set.
  const discoveryService = catalogLoader &&
    catalogSha256 &&
    discoverySnapshot && {
      load: () => loadDiscoveryIndex({ loader: catalogLoader, sha256: catalogSha256, snapshot: discoverySnapshot }),
    };
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
  // G07.05 — the resolver's store wrapped into the hint controller's
  // structural run source, memoized per resolved store: the controller
  // re-attaches its change subscription only when the live surface changes.
  let liveRunWrapper: { readonly store: ControllerStore<RunControllerState>; readonly source: NearbyHintRunSource } | null = null;
  const liveRunSource = (): NearbyHintRunSource | null => {
    const store = liveSurfaceController();
    if (store === null) return null;
    if (liveRunWrapper === null || liveRunWrapper.store !== store) {
      liveRunWrapper = {
        store,
        source: {
          get run() {
            return store.getState().run;
          },
          subscribe: (listener) => store.subscribe(listener),
        },
      };
    }
    return liveRunWrapper.source;
  };
  // G07.05 (issue #284) — the ONE R07 hint controller (19 §2.2), over the
  // accepted ADR G07.04 contract. It reads the fixes through the location
  // service's read-only tap and the live run state through the resolver; the
  // durable limits, the public points and the values document arrive with
  // the guideHints seams. The controller exists only with the full seam set —
  // a hint card without its limits or its previews is no card.
  const hints =
    location && audio && catalogService && guideHints
      ? createNearbyHintController({
          location,
          audio,
          catalog: catalogService,
          store: guideHints.store,
          points: guideHints.points,
          values: guideHints.values,
          liveRun: liveRunSource,
          ...(guideHints.foreground ? { foreground: guideHints.foreground } : {}),
          ...(guideHints.telemetry ? { telemetry: guideHints.telemetry } : {}),
          ...(now ? { now } : {}),
        })
      : undefined;
  // G16.03 (issue #74) — the ONE feedback controller (19 §2.2): the form, the
  // End invitation and the own-ratings list over the G16.02 repository and
  // sync. Exists only with both feedback ports — the honest absence rule.
  const feedbackController = ports.feedback
    ? createFeedbackController({
        driver: ports.feedback.driver,
        sync: ports.feedback.sync,
        repository: feedbackRepository,
        ...(now ? { now } : {}),
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
  // G21.17 (issue #551): the teasers' display order reads the switched UI
  // language first, the composition fallback after — the reader runs per
  // place-detail open, so the pick is per-open fresh.
  // G22.02 (issue #607): the teaser audio resolves through the dedicated
  // probe — never a full media read; the reader exists only where the probe
  // port is supplied beside the store.
  const momentsReader = bundlesStore && teaserAudioProbe
    ? () =>
        readMomentFacts(bundlesStore, {
          locales: [uiLocale.current(), ...localePreference],
          audioProbe: teaserAudioProbe,
        })
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
              // G21.17 (issue #551): a fresh walk rides the selected UI
              // language when the downloaded package carries it — the person
              // starts the guide they are reading; an absent layer falls to
              // the composition preference, never a substitution beyond it.
              locale =
                [uiLocale.current(), ...localePreference].find((candidate) => locales.includes(candidate)) ??
                locales[0];
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
            // walk, not the card. G06.05 (issue #280, AC3): the extended
            // layer's stories are read beside the base ones when the pin
            // carries the tier — the card's transcript switch needs both.
            const stories = await readRunStoryFacts(
              bundlesStore,
              `bundles/${routeId}/${version}/${locale}/base`,
            );
            const storiesExtended = tier.includes('extended')
              ? await readRunStoryFacts(
                  bundlesStore,
                  `bundles/${routeId}/${version}/${locale}/extended`,
                )
              : { ok: true as const, stories: [] };
            return {
              kind: 'pinned',
              version,
              locale,
              tier,
              stops: facts.stops,
              places: facts.places,
              stories: stories.ok ? stories.stories : [],
              storiesExtended: storiesExtended.ok ? storiesExtended.stories : [],
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
  // G21.17 (issue #551) — the content selection boundaries ride the selected
  // UI language: the catalog controller re-projects (titles ride the switched
  // preference through the same refresh-at-every-load reader policy) and the
  // discovery controller re-selects (its criteriaLocale is the switched code)
  // whenever the switch moves. The switch is the human choice; neither
  // subscription touches a live walk (the run's pinned package is out of
  // both stores' reach).
  const catalogController = catalogService ? createCatalogController(catalogService) : undefined;
  if (catalogController) {
    uiLocale.subscribe(() => void catalogController.getState().refresh());
  }
  const discoveryController = discoveryService
    ? createDiscoveryController({
        service: discoveryService,
        criteriaLocale: uiLocale.current(),
        ...(discoveryAnalytics ? { analytics: discoveryAnalytics } : {}),
      })
    : undefined;
  if (discoveryController) {
    uiLocale.subscribe(() => discoveryController.getState().setCriteriaLocale(uiLocale.current()));
  }
  return {
    // G14.04.d — the display locale reads through the ui-locale store (the
    // L02 switch): a getter, so the screens' per-render uiStrings(...) sees
    // the switched value without a services rebuild.
    get locale() {
      return uiLocale.current();
    },
    // G14.04.d (issue #305) — the switch itself: the My KUDY row writes it,
    // the screens subscribe through useUiLocale.
    uiLocale,
    contentRepo: packageStore && {
      evaluatePackage: (input) => evaluatePackage(packageStore, input),
    },
    // A service member exists only when its port is provided (the root's
    // rule): with no origin bound there is no catalog to render and the
    // surfaces show their honest unavailable state.
    catalog: catalogController && {
      controller: catalogController,
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
            // G21.17 (issue #551): the preview's display order reads the
            // switched UI language first — evaluated per route open.
            localePreference: [uiLocale.current(), ...localePreference],
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
          // G07.05 — the R07 carry source: the hint controller's
          // foreground-window ids move into session scope in the Start
          // transaction (ADR G01.03 §3.9).
          ...(hints ? { carryGuideHints: hints.foregroundCarry } : {}),
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
          // G21.17 (issue #551): the binding is one surface opening — the
          // snapshot is the switched locale at open time; the open list
          // re-filters per render over the same facts.
          locale: uiLocale.current(),
        }),
    },
    hints,
    // G16.03 (issue #74) — the rating surfaces' member (the form route, the
    // End invitation, the place action, the My KUDY list read it).
    feedback: feedbackController && {
      controller: feedbackController,
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
    // G08.05 — the commerce store per opened route (the preview idiom);
    // exists only with the commerce port — the honest absence otherwise.
    commerce: commerce && {
      create: (routeId) =>
        createCommerceController({
          port: commerce,
          telemetry: events,
          routeId,
        }),
    },
    discovery: discoveryController && {
      controller: discoveryController,
    },
  };
}
