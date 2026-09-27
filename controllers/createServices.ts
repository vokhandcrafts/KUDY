import { evaluatePackage } from '../services/contentRepo/contentRepo.ts';
import { readLayerFacts, isSafeSegment } from '../services/contentRepo/inventory.ts';
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
  createRunSurfaceController,
  type RunPinnedPackagePort,
  type RunSessionPorts,
  type RunSurfaceState,
} from './run/runSurfaceController.ts';
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
  // start). The screen renders the surface state.
  readonly run:
    | {
        readonly create: (routeId: string) => ControllerStore<RunSurfaceState>;
      }
    | undefined;
}

export function createServices(ports: ServicePorts): Services {
  const { packageStore, catalogOrigin, catalogSha256, bundlesStore, evaluateLayer, downloadLayer, runSession } =
    ports;
  const catalogLoader = catalogOrigin ? createOriginCatalogLoader(catalogOrigin) : undefined;
  // MVP display-locale order: Belarusian first (21 §3.2 allowlist; the
  // UI-locale selection is G06.05/L02 and will replace this). One preference
  // value for the catalog service and the preview controller.
  const localePreference: readonly string[] = ['be', 'en'];
  const catalogService = catalogLoader &&
    catalogSha256 &&
    createCatalogService({ loader: catalogLoader, sha256: catalogSha256 }, { localePreference });
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
      create: (routeId) =>
        createRunSurfaceController({
          routeId,
          pinnedPackage,
          session: runPorts,
          localePreference,
        }),
    },
  };
}
