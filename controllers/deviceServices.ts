// G20.20 (issue #491) — the device composition root: ONE production service
// set for the installed app (spec V5). The platform facilities (the expo
// module bindings, the opened SQLite database, the real audio/location
// services) are constructed in the app root (app/_layout.tsx) and injected
// here; this module owns the one SqlDriver instance, the one bundles root
// and the explicit teardown, and serves every ServicePorts member the free
// flow needs. Deliberately absent (honest unavailable, spec V5): the
// single-store packageStore member (no route context — the preview rides
// evaluateLayer) and discovery analytics (no sender). Discovery's replaceable
// snapshot, Nearby/guide hints and feedback are composed below; feedback
// stays absent without a Functions endpoint. The live-session port reads
// SQLite, and createServices joins its route ID to the catalog title.
// react-native-purchases is never imported here: purchase/restore stays the
// explicitly-unavailable port until G20.21 wires and verifies the live path.
import { activate } from '../services/download/download.ts';
import { createAccessPort } from '../services/download/access.ts';
import { createDeletionGate } from '../services/download/delete.ts';
import { createOriginByteSource } from '../services/download/origin-bytes.ts';
import { createExpoDownloadStore } from '../services/download/expo/expo-download-store.ts';
import { discoverySnapshotOver } from '../services/contentRepo/discoverySnapshot.ts';
import { readRunMapFacts } from '../services/contentRepo/runMapFacts.ts';
import { checkPresence } from '../services/contentRepo/presence.ts';
import { isSafeSegment } from '../services/safe-path.ts';
import { ensureDeviceIdentity, type DeviceRegistrationTransport, type SecureSecretStore } from '../services/device.ts';
import { createFeedbackSync, type FeedbackTransport } from '../services/feedbackSync.ts';
import {
  createExpoBundlesStore,
  createExpoAudioUriResolver,
  createExpoTeaserAudioProbe,
} from '../services/contentRepo/expo/expo-package-store.ts';
import { getLiveSession, openDatabase } from '../services/db/db.ts';
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
  createEvaluateLayer,
  createRunPackageStopsPort,
  createRunReadinessFor,
  createRunRecoveryPort,
  createSessionHistoryPort,
  createUiLocalePersistence,
  hintStoreOver,
  sessionStoreOver,
} from './sessionPorts.ts';
import { defaultEngineConfig } from '../core/engine/reducer.ts';
import type { GuideHintValues } from '../services/config.ts';
import type { GuideHintPoint } from './useNearbyController.ts';

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
  /** Present only in the explicitly labeled offline demo build. */
  demoSource?: {
    loadText: (path: string) => Promise<string>;
    loadBytes: (path: string) => Promise<Uint8Array>;
  };
  /** The content-locale preference for fresh-walk pin picks; the composition default. */
  preferredLocales?: () => readonly string[];
  guideHintValues?: GuideHintValues;
  foreground?: () => boolean;
  onForeground?: (listener: () => void) => () => void;
  /** The feedback retry clock; production uses the app process timers. */
  feedbackClock?: {
    now: () => number;
    schedule: (delayMs: number, callback: () => void) => () => void;
  };
  /** Optional authenticated Functions endpoint; absent leaves feedback unavailable. */
  feedback?: {
    baseUrl: string;
    secretStore: SecureSecretStore;
    transport?: FeedbackTransport;
    registrationTransport?: DeviceRegistrationTransport;
  };
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
  const guideHintPoints = new Map<string, readonly GuideHintPoint[]>();
  const pointsFromMap = (routeId: string, map: Extract<Awaited<ReturnType<typeof readRunMapFacts>>, { ok: true }>): GuideHintPoint[] => {
    const places = new Map(map.places.map((place) => [place.placeId, place]));
    return map.stops.flatMap((stop) => {
      const place = places.get(stop.placeId);
      return place ? [{ guideId: routeId, lat: place.lat, lng: place.lng }] : [];
    });
  };
  // Rebuild the derived projection from installed base layers. A restart
  // checks the lock and JSON at the same metadata level as package presence;
  // it never reads or hashes the audio body.
  const guideHintPointsReady = (async () => {
    if (!facilities.guideHintValues) return;
    const routeIds = await bundlesStore.listDir('bundles');
    for (const routeId of routeIds ?? []) {
      if (!isSafeSegment(routeId) || routeId === 'staging') continue;
      if (guideHintPoints.has(routeId)) continue;
      try {
        const versions = await bundlesStore.listDir(`bundles/${routeId}`);
        for (const version of (versions ?? [])
          .filter((value) => isSafeSegment(value) && /^[0-9]+$/.test(value))
          .sort((a, b) => BigInt(a) === BigInt(b) ? 0 : BigInt(a) > BigInt(b) ? -1 : 1)) {
          const locales = await bundlesStore.listDir(`bundles/${routeId}/${version}`);
          const preferred = preferredLocales();
          const ordered = [...(locales ?? [])].filter(isSafeSegment).sort((a, b) =>
            (preferred.indexOf(a) < 0 ? preferred.length : preferred.indexOf(a)) -
            (preferred.indexOf(b) < 0 ? preferred.length : preferred.indexOf(b)));
          for (const locale of ordered) {
            const layer = { routeId, version, locale, tier: 'base' as const };
            const [presence] = await checkPresence(bundlesStore, { layers: [layer], trigger: 'restart', sha256 });
            if (presence?.status !== 'verified') continue;
            const map = await readRunMapFacts(bundlesStore, `bundles/${routeId}/${version}/${locale}/base`, layer);
            if (!map.ok) continue;
            if (!guideHintPoints.has(routeId)) guideHintPoints.set(routeId, pointsFromMap(routeId, map));
            break;
          }
          if (guideHintPoints.has(routeId)) break;
        }
      } catch { /* a damaged route must not hide other installed guides */ }
    }
  })().catch(() => { /* damaged storage contributes no public points */ });
  const teaserAudioProbe = createExpoTeaserAudioProbe(fileSystem, bundlesRoot);
  const audioUriFor = createExpoAudioUriResolver(fileSystem, bundlesRoot);
  const downloadStore = createExpoDownloadStore(fileSystem, bundlesRoot);
  const fetchBytes = facilities.demoSource?.loadBytes ?? createOriginByteSource(origin);
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
      if (key.tier === 'base') {
        const map = await readRunMapFacts(bundlesStore, deviceLayer, key);
        if (map.ok) {
          guideHintPoints.set(key.routeId, pointsFromMap(key.routeId, map));
        }
      }
    }
    return result;
  };
  // The compile-time structural check of the unavailable port against the
  // controller's contract (services cannot import controllers for it).
  const commerce: CommercePort = createUnavailableCommercePort();
  const feedback = facilities.feedback;
  const feedbackClock = facilities.feedbackClock ?? {
    now: Date.now,
    schedule: (delayMs: number, callback: () => void) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  };
  const feedbackSync = feedback && createFeedbackSync({
    driver,
    secretStore: feedback.secretStore,
    baseUrl: feedback.baseUrl,
    makeMutationId: newSessionId,
    now: feedbackClock.now,
    ...(feedback.transport ? { transport: feedback.transport } : {}),
  });
  let stopFeedbackTimer: (() => void) | null = null;
  let feedbackDisposed = false;
  const feedbackListeners = new Set<() => void>();
  const scheduleFeedbackRetry = (minimumDelayMs = 1_000): void => {
    stopFeedbackTimer?.();
    stopFeedbackTimer = null;
    if (feedbackDisposed) return;
    const row = driver.prepare(
      "SELECT MIN(CASE WHEN transport_state = 'sending' THEN ? ELSE COALESCE(next_attempt_at, ?) END) AS due FROM feedback_outbox WHERE transport_state IN ('pending', 'sending')",
    ).get(feedbackClock.now() + minimumDelayMs, feedbackClock.now() + minimumDelayMs);
    const due = row?.due;
    if (typeof due !== 'number' || !Number.isFinite(due)) return;
    const delay = Math.min(2_147_483_647, Math.max(minimumDelayMs, due - feedbackClock.now()));
    stopFeedbackTimer = feedbackClock.schedule(delay, () => {
      stopFeedbackTimer = null;
      if (facilities.foreground?.() === false) return;
      void deviceFeedbackSync?.flush().catch((error: unknown) => {
        console.warn('feedback scheduled retry failed', error instanceof Error ? error.name : 'unknown');
      });
    });
  };
  const deviceFeedbackSync = feedback && feedbackSync ? {
    stopExpiredPending: () => feedbackSync.stopExpiredPending(),
    flush: async () => {
      let failed = false;
      try {
        feedbackSync.stopExpiredPending();
        const hasWork = driver.prepare(
          "SELECT 1 AS present FROM feedback_outbox WHERE transport_state IN ('pending', 'sending') LIMIT 1",
        ).get();
        if (!hasWork) return await feedbackSync.flush();
        await ensureDeviceIdentity({
          driver,
          secretStore: feedback.secretStore,
          baseUrl: feedback.baseUrl,
          ...(feedback.registrationTransport ? { transport: feedback.registrationTransport } : {}),
        });
        return await feedbackSync.flush();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        scheduleFeedbackRetry(failed ? 30_000 : 1_000);
        if (!feedbackDisposed) {
          for (const listener of feedbackListeners) {
            try { listener(); }
            catch (error) {
              console.warn('feedback UI refresh failed', error instanceof Error ? error.name : 'unknown');
            }
          }
        }
      }
    },
    resolveConflict: (target: Parameters<typeof feedbackSync.resolveConflict>[0]) => feedbackSync.resolveConflict(target),
  } : null;
  if (deviceFeedbackSync) scheduleFeedbackRetry();
  const stopFeedbackResume = deviceFeedbackSync && facilities.onForeground
    ? facilities.onForeground(() => {
      void deviceFeedbackSync.flush().catch((error: unknown) => {
        console.warn('feedback foreground retry failed', error instanceof Error ? error.name : 'unknown');
      });
    })
    : null;
  // A demo catalog is immutable and already bundled. The selector still goes
  // through its verified snapshot contract; this cache is rebuildable on boot.
  let demoSnapshot: Uint8Array | null = null;
  const ports: ServicePorts = {
    catalogOrigin: origin,
    ...(facilities.demoSource ? { catalogLoader: facilities.demoSource.loadText } : {}),
    discoverySnapshot: facilities.demoSource
      ? {
        read: async () => demoSnapshot?.slice() ?? null,
        write: async (bytes: Uint8Array) => { demoSnapshot = bytes.slice(); },
      }
      : discoverySnapshotOver(driver),
    catalogSha256: sha256,
    location,
    audio,
    momentAudioUriFor: audioUriFor,
    ...(facilities.guideHintValues ? {
      guideHints: {
        store: hintStoreOver(driver),
        values: facilities.guideHintValues,
        points: () => [...guideHintPoints.values()].flat(),
        pointsReady: guideHintPointsReady,
        ...(facilities.foreground ? { foreground: facilities.foreground } : {}),
      },
    } : {}),
    ...(deviceFeedbackSync ? {
      feedback: {
        driver,
        makeMutationId: newSessionId,
        sync: deviceFeedbackSync,
        onSyncSettled: (listener) => {
          feedbackListeners.add(listener);
          return () => feedbackListeners.delete(listener);
        },
      },
    } : {}),
    bundlesStore,
    teaserAudioProbe,
    downloadLayer,
    // #727 — the preview's verify rides the run's own map facts: the Start
    // button derives a real evaluate verdict, never verify-unavailable on a
    // downloaded layer.
    evaluateLayer: createEvaluateLayer({ bundlesStore }),
    // The one-live-row read is the preview's switch confirmation gate. The
    // root resolves its display title from the catalog projection; the raw
    // route id remains the honest fallback when that catalog is unavailable.
    runSession: {
      liveSession: () => {
        const live = getLiveSession(driver);
        return live ? { routeId: live.routeId, title: live.routeId } : null;
      },
    },
    commerce,
    sessionHistory: createSessionHistoryPort(driver),
    uiLocalePersistence: createUiLocalePersistence(driver),
    readinessFor: createRunReadinessFor({ driver, bundlesStore, preferredLocales }),
    liveRunSession: () => {
      const row = getLiveSession(driver);
      return row ? { routeId: row.routeId } : null;
    },
    run: {
      session: {
        location,
        audio,
        audioUriFor,
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
    teardown: () => {
      feedbackDisposed = true;
      stopFeedbackTimer?.();
      feedbackListeners.clear();
      stopFeedbackResume?.();
      wakelock.release();
    },
  };
}
