// G20.20 (issue #491) — the device composition root: ONE production service
// set for the installed app (spec V5). The platform facilities (the expo
// module bindings, the opened SQLite database, the real audio/location
// services) are constructed in the app root (app/_layout.tsx) and injected
// here; this module owns the one SqlDriver instance, the one bundles root
// and the explicit teardown, and serves every ServicePorts member the free
// flow needs. Deliberately absent (honest unavailable, spec V5): the
// single-store packageStore member (no route context — the preview rides
// evaluateLayer), the live-walk runSession/walk fact (needs the route-title
// join from the catalog projection), the discovery snapshot/analytics and
// the guide-hint seams (no values document on device), and the feedback
// seams (the functions origin env is a G16/G20.21 prerequisite).
// react-native-purchases is never imported here: purchase/restore stays the
// explicitly-unavailable port until G20.21 wires and verifies the live path.
import { activate } from '../services/download/download.ts';
import { createAccessPort } from '../services/download/access.ts';
import { createDeletionGate } from '../services/download/delete.ts';
import { createOriginByteSource } from '../services/download/origin-bytes.ts';
import { createExpoDownloadStore } from '../services/download/expo/expo-download-store.ts';
import {
  createExpoBundlesStore,
  createExpoTeaserAudioProbe,
} from '../services/contentRepo/expo/expo-package-store.ts';
import { openDatabase } from '../services/db/db.ts';
import type { SqlDriver } from '../services/db/types.ts';
import type { Sha256, Tier } from '../services/contentRepo/types.ts';
import { createDeviceWakelock, type DeviceWakelock, type KeepAwakeFacility } from '../services/device-wakelock.ts';
import type { AudioService } from '../services/audio/service.ts';
import type { LocationService } from '../services/location/service.ts';
import type { Directory, File } from 'expo-file-system';
import type { RunSessionPorts } from './run/runSurfaceController.ts';
import type { RunReadiness } from './useRunController.ts';
import type { ServicePorts } from './createServices.ts';
import type { CommercePort } from './commerce/commerceController.ts';
import { createUnavailableCommercePort } from '../services/entitlement/unavailable-port.ts';
import {
  createRunPackageStopsPort,
  createRunReadinessFor,
  createRunRecoveryPort,
  createSessionHistoryPort,
  createUiLocalePersistence,
  sessionStoreOver,
} from './sessionPorts.ts';
import { defaultEngineConfig } from '../core/engine/reducer.ts';

// The configured public catalog origin, or null when absent — the app root's
// fail-closed gate: no origin, no composition call, the surfaces keep their
// honest unavailable state (V5). Pure so the node tests exercise the real
// gate the root uses.
export function catalogOriginFrom(env: Record<string, string | undefined>): string | null {
  const origin = env.EXPO_PUBLIC_CATALOG_ORIGIN;
  return origin ? origin : null;
}

export interface DeviceFileSystem {
  File: typeof File;
  Directory: typeof Directory;
  /** Bytes available on the volume; null when the host cannot say. */
  freeBytes: () => number | null;
}

export interface DeviceFacilities {
  /** The one SQLite connection the app owns (openDatabaseSync in the app root). */
  driver: SqlDriver;
  sha256: Sha256;
  newSessionId: () => string;
  keepAwake: KeepAwakeFacility;
  location: LocationService;
  audio: AudioService;
  fileSystem: DeviceFileSystem;
  /** The bundles tree root (the download channel writes what the readers read). */
  bundlesRoot: Directory;
  /** The configured public catalog origin (EXPO_PUBLIC_CATALOG_ORIGIN). */
  origin: string;
  /** The content-locale preference for fresh-walk pin picks; the composition default. */
  preferredLocales?: () => readonly string[];
}

export interface DeviceServiceSet {
  ports: ServicePorts;
  teardown: () => void;
}

// The fail-closed shared readiness: run.create overrides it per route when
// the readinessFor port lands; a surface created without it refuses named.
const HONEST_REFUSAL: RunReadiness = {
  evaluate: async () => ({ status: 'incomplete', missing: ['package#absent'] }),
};

export function createDeviceServicePorts(facilities: DeviceFacilities): DeviceServiceSet {
  const {
    driver,
    sha256,
    newSessionId,
    keepAwake,
    location,
    audio,
    fileSystem,
    bundlesRoot,
    origin,
  } = facilities;
  const preferredLocales = facilities.preferredLocales ?? (() => ['be', 'en'] as const);
  // The schema's idempotent migrations run once per composition; the durable
  // zones survive a restart, the derived ones rebuild here.
  openDatabase(driver);
  const bundlesStore = createExpoBundlesStore(fileSystem, bundlesRoot);
  const teaserAudioProbe = createExpoTeaserAudioProbe(fileSystem, bundlesRoot);
  const downloadStore = createExpoDownloadStore(fileSystem, bundlesRoot);
  const fetchBytes = createOriginByteSource(origin);
  const access = createAccessPort();
  const gate = createDeletionGate();
  const wakelock: DeviceWakelock = createDeviceWakelock(keepAwake);
  // The free download leg (spec V5): the layer's lock.json and files live on
  // the public origin; the paid grant path joins with G20.21. Failures keep
  // the named rules (no URL) and surface as the preview's download failure.
  const downloadLayer = async (key: { routeId: string; version: string; locale: string; tier: Tier }) => {
    // The published layout serves the base layers under bundle/ (09 §3); the
    // device store keeps them under bundles/ (the download channel's own
    // layout, services/download/download.ts layerPath).
    const originLayer = `bundle/${key.routeId}/${key.version}/${key.locale}/${key.tier}`;
    const deviceLayer = `bundles/${key.routeId}/${key.version}/${key.locale}/${key.tier}`;
    const lockBytes = await fetchBytes(`${originLayer}/lock.json`);
    let lock: unknown;
    try {
      lock = JSON.parse(new TextDecoder().decode(lockBytes));
    } catch {
      throw new Error('download-lock#unreadable');
    }
    const result = await activate({ ...key, lock }, {
      store: downloadStore,
      fetch: (path) => fetchBytes(`${originLayer}/${path}`),
      sha256,
      driver,
      access,
      cancel: gate,
    });
    // The lock itself is not a lock entry (09 §4) — the composition writes
    // the fetched lock beside the files, so the inventory and the Start gate
    // verify against the same document the activation used.
    if (result.status === 'complete') {
      await downloadStore.writeFile(`${deviceLayer}/lock.json`, lockBytes);
    }
    return result;
  };
  // The compile-time structural check of the unavailable port against the
  // controller's contract (services cannot import controllers for it).
  const commerce: CommercePort = createUnavailableCommercePort();
  const ports: ServicePorts = {
    catalogOrigin: origin,
    catalogSha256: sha256,
    bundlesStore,
    teaserAudioProbe,
    downloadLayer,
    commerce,
    sessionHistory: createSessionHistoryPort(driver),
    uiLocalePersistence: createUiLocalePersistence(driver),
    readinessFor: createRunReadinessFor({ driver, bundlesStore, preferredLocales }),
    run: {
      session: {
        location,
        audio,
        clock: { now: () => Date.now() },
        engineConfig: defaultEngineConfig,
        pipelineConfig: { dwellMs: 0 },
        sessionStore: sessionStoreOver(driver),
        readiness: HONEST_REFUSAL,
        packageStops: createRunPackageStopsPort({ driver, bundlesStore, preferredLocales }),
        access,
        wakelock,
        recovery: createRunRecoveryPort({ driver, bundlesStore }),
        newSessionId,
      } satisfies RunSessionPorts,
    },
  };
  return {
    ports,
    teardown: () => wakelock.release(),
  };
}
