// G20.20 (issue #491) — the db-backed controller-port wiring the device
// composition root serves over services/db's public API. The session and
// hint stores are the moved test wiring (test/session-store.ts re-exports
// from here — one implementation, the copy-paste gate's own demand); the
// recovery, package-stops and per-route readiness ports are the production
// versions of the run suites' world builder. This module is the second
// composition root allowed to value-import services/ (canon 19 §2.2, the
// machine rule controllers-services-type-only names it).
import {
  DbError,
  checkpointProgress,
  finishSession,
  getLiveSession,
  getSetting,
  listGuidesInHintCooldown,
  listSessionGuideHints,
  listSessionHistoryPage,
  pauseSession,
  recordGuideHintDismissed,
  recordGuideHintShown,
  resumeSession,
  setSetting,
  startSession,
  switchSession,
} from '../services/db/db.ts';
import type { SessionHistoryCursor, SqlDriver } from '../services/db/types.ts';
import { readLayerFacts } from '../services/contentRepo/inventory.ts';
import { STAGING } from '../services/download/download.ts';
import { readRunMapFacts } from '../services/contentRepo/runMapFacts.ts';
import { readRunStoryFacts } from '../services/contentRepo/runStoryFacts.ts';
import { isSafeSegment } from '../services/safe-path.ts';
import { COMPLETE_UI_LOCALES, type CompleteUiLocaleCode } from '../contracts/ui-locales.ts';
import type { BundlesStore, Readiness, Tier } from '../services/contentRepo/types.ts';
import type { RunSessionStore } from './useRunController.ts';
import type { GuideHintStore } from './useNearbyController.ts';
import type { RunPinnedPackagePort, RunSessionPorts } from './run/runSurfaceController.ts';
import type { RunStop } from './run/runOrchestrator.ts';
import type {
  RunRecovery,
  RunRecoveryLayer,
  RunRecoveryPayload,
  RunReadiness,
  RunPackageStops,
} from './useRunController.ts';
import type { SessionHistoryPort } from './myKudyController.ts';
import type { UiLocalePersistence } from './uiLocaleStore.ts';

// G06.04 (issue #63) — the db-backed RunSessionStore port both run suites
// and the device composition share: the wiring over services/db's public
// API (issue #209 AC1). The switch-guide transaction resolves the app-wide
// live row itself (ADR G01.03 §3.1) and reports the finished session id
// back, so the composition root can retire the surface that owned it.
export function sessionStoreOver(driver: SqlDriver): RunSessionStore {
  return {
    start(input) {
      try {
        startSession(driver, input);
        return { ok: true };
      } catch (error) {
        if (error instanceof DbError && error.rule === 'live-session-exists') {
          return { ok: false, reason: 'live-session-exists' };
        }
        throw error;
      }
    },
    startSwitch(input, meta) {
      // The app-wide live row is resolved by the implementation (G06.04):
      // the switch-guide transaction finishes it and inserts the next row.
      const live = getLiveSession(driver);
      if (!live) return { ok: false, reason: 'no-live-session' };
      try {
        switchSession(driver, live.sessionId, input, { finishedAt: meta.finishedAt });
        return { ok: true, finishedSessionId: live.sessionId };
      } catch (error) {
        if (error instanceof DbError && error.rule === 'session-not-live') {
          return { ok: false, reason: 'no-live-session' };
        }
        throw error;
      }
    },
    checkpoint: (sessionId, progress) => checkpointProgress(driver, sessionId, progress),
    pause: (sessionId, progress) => pauseSession(driver, sessionId, progress),
    resume: (sessionId) => resumeSession(driver, sessionId),
    finish: (sessionId, input) => finishSession(driver, sessionId, input),
  };
}

// G07.05 — the db-backed GuideHintStore port: the nearby controller is the
// only writer of the R07 rows (09 §20).
export function hintStoreOver(driver: SqlDriver): GuideHintStore {
  return {
    recordShown(input) {
      recordGuideHintShown(driver, {
        guideIds: input.guideIds,
        scope: input.context === 'active' ? 'session' : 'foreground',
        sessionId: input.sessionId ?? undefined,
        at: input.at,
      });
    },
    recordDismissed(input) {
      recordGuideHintDismissed(driver, {
        guideIds: input.guideIds,
        scope: input.context === 'active' ? 'session' : 'foreground',
        sessionId: input.sessionId ?? undefined,
        at: input.at,
      });
    },
    sessionShown: (sessionId) => listSessionGuideHints(driver, sessionId).map((row) => row.guideId),
    cooldownBlocked: (nowMs, cooldownMs) => listGuidesInHintCooldown(driver, nowMs, cooldownMs),
  };
}

const isTierValue = (value: string): value is Tier => value === 'base' || value === 'extended';

async function resolveFreshIdentity(
  bundlesStore: BundlesStore,
  routeId: string,
  preferredLocales: () => readonly string[],
): Promise<{ version: string; locale: string } | null> {
  const versions = (await bundlesStore.listDir(`bundles/${routeId}`))?.filter(
    (name) => name !== STAGING,
  );
  if (!versions || versions.length !== 1) return null;
  const locales = await bundlesStore.listDir(`bundles/${routeId}/${versions[0]}`);
  if (!locales || locales.length === 0) return null;
  const locale = preferredLocales().find((candidate) => locales.includes(candidate)) ?? locales[0];
  return { version: versions[0], locale };
}

// The layer path under the bundles root, the layout the pin and the
// inventory read: bundles/<route>/<version>/<locale>/<tier>.
function layerPath(routeId: string, version: string, locale: string, tier: Tier): string {
  return `bundles/${routeId}/${version}/${locale}/${tier}`;
}

// G21.21 (ADR G21.20 §3.4) — the audio availability of one pinned version:
// the locales whose base layer ships an audio directory. The idiom is the
// validator's own layerShipsAudio fact (tools/validate/validate-package.mjs:
// a layer declares itself text-only by shipping no audio directory at all;
// an emptied directory still counts as shipping audio) — listDir answers
// null for an absent subtree, [] for an empty one.
async function audioLocalesOf(
  bundlesStore: BundlesStore,
  routeId: string,
  version: string,
): Promise<string[]> {
  const locales = await bundlesStore.listDir(`bundles/${routeId}/${version}`);
  if (!locales) return [];
  const out: string[] = [];
  for (const locale of locales) {
    const audio = await bundlesStore.listDir(`bundles/${routeId}/${version}/${locale}/base/audio`);
    if (audio !== null) out.push(locale);
  }
  return out;
}

// One layer's recovery read (09 §9.1): the map facts joined with the places'
// geometry. A stop without its place geometry is a damaged package — the
// layer answers needs-recovery whole, never a partial seed. The text loop
// consumes the stop records, the audio loop only the tier status.
async function readRunLayer(
  bundlesStore: BundlesStore,
  routeId: string,
  version: string,
  locale: string,
  tier: Tier,
): Promise<{ layer: RunRecoveryLayer; stops: RunStop[] }> {
  const facts = await readRunMapFacts(bundlesStore, layerPath(routeId, version, locale, tier), {
    routeId,
    version,
  });
  if (!facts.ok) return { layer: { tier, status: 'needs-recovery' }, stops: [] };
  const geometry = new Map(facts.places.map((place) => [place.placeId, place]));
  const stops: RunStop[] = [];
  for (const stop of facts.stops) {
    const place = geometry.get(stop.placeId);
    if (!place) return { layer: { tier, status: 'needs-recovery' }, stops: [] };
    stops.push({
      stopId: stop.stopId,
      lat: place.lat,
      lng: place.lng,
      radius: place.radius,
      ...(stop.storyBaseId ? { storyBaseId: stop.storyBaseId } : {}),
      ...(stop.storyExtendedId ? { storyExtendedId: stop.storyExtendedId } : {}),
    });
  }
  return { layer: { tier, status: 'ready', stops }, stops };
}

// G06.04 — the run surface's pinned-package port, moved verbatim from
// createServices.ts: the live row's version/locale/tier pin wins; a fresh
// walk takes the single version on disk and the first preferred locale
// present. Anything ambiguous, absent or damaged is a named refusal.
export function createPinnedPackagePort(input: {
  session: RunSessionPorts;
  bundlesStore: BundlesStore;
  preferredLocales: () => readonly string[];
}): RunPinnedPackagePort {
  const { session: runPorts, bundlesStore, preferredLocales } = input;
  return {
    read: async (routeId) => {
      if (!isSafeSegment(routeId)) return { kind: 'refused', reason: 'run#unsafe-route-id' };
      const live = await runPorts.recovery.read(routeId);
      let version: string;
      let locale: string;
      let tier: Tier[];
      if (live && live.routeId === routeId && (live.row.state === 'active' || live.row.state === 'paused')) {
        version = live.row.version;
        locale = live.row.locale;
        tier = live.row.tier.filter(isTierValue);
      } else {
        const versions = (await bundlesStore.listDir(`bundles/${routeId}`))?.filter(
          (name) => name !== STAGING,
        );
        if (!versions || versions.length === 0) {
          return { kind: 'refused', reason: 'run#package-not-downloaded' };
        }
        if (versions.length > 1) return { kind: 'refused', reason: 'run#package-ambiguous' };
        version = versions[0];
        const locales = await bundlesStore.listDir(`bundles/${routeId}/${version}`);
        if (!locales || locales.length === 0) return { kind: 'refused', reason: 'run#locale-missing' };
        locale = preferredLocales().find((candidate) => locales.includes(candidate)) ?? locales[0];
        tier = ['base'];
      }
      const facts = await readRunMapFacts(bundlesStore, layerPath(routeId, version, locale, 'base'), {
        routeId,
        version,
      });
      if (!facts.ok) return { kind: 'refused', reason: facts.diagnostic };
      const stories = await readRunStoryFacts(bundlesStore, layerPath(routeId, version, locale, 'base'));
      const storiesExtended = tier.includes('extended')
        ? await readRunStoryFacts(bundlesStore, layerPath(routeId, version, locale, 'extended'))
        : { ok: true as const, stories: [] };
      return {
        kind: 'pinned',
        version,
        locale,
        tier,
        // G21.21 (ADR G21.20 §3.2, owner edit 1): the pinned version's
        // available audio locales — the default pin's selection source and
        // the explicit choice's validation set.
        audioLocales: await audioLocalesOf(bundlesStore, routeId, version),
        stops: facts.stops,
        places: facts.places,
        stories: stories.ok ? stories.stories : [],
        storiesExtended: storiesExtended.ok ? storiesExtended.stories : [],
      };
    },
  };
}

// 09 §9.1 — the read-only restart-recovery view: the route's live row plus
// the recorded layers' stop records joined from the same map facts the walk
// reads. A stop without its place geometry is a damaged package — the layer
// answers needs-recovery whole, never a partial seed. G21.21 (ADR G21.20
// §3.4): the payload also carries the pinned version's audio availability
// and the recorded audio pin's own per-tier reads — the restore resolves a
// NULL row against the availability and seeds audioTierAvailable only from
// the audio tiers that verify now.
export function createRunRecoveryPort(input: {
  driver: SqlDriver;
  bundlesStore: BundlesStore;
}): RunRecovery {
  const { driver, bundlesStore } = input;
  return {
    read: async (routeId): Promise<RunRecoveryPayload | null> => {
      const row = getLiveSession(driver);
      if (!row || row.routeId !== routeId) return null;
      const layers: RunRecoveryLayer[] = [];
      for (const tier of row.tier.filter(isTierValue)) {
        const { layer } = await readRunLayer(bundlesStore, routeId, row.version, row.locale, tier);
        // the text layer's stop records ride the layer itself — the restore
        // seed; the audio layer's are read for the pin's verification status
        layers.push(layer);
      }
      const audioLocales = await audioLocalesOf(bundlesStore, routeId, row.version);
      const audioLayers: RunRecoveryLayer[] = [];
      if (row.audioLocale !== null) {
        for (const tier of row.tier.filter(isTierValue)) {
          const { layer } = await readRunLayer(bundlesStore, routeId, row.version, row.audioLocale, tier);
          audioLayers.push(layer);
        }
      }
      return { row, routeId, version: row.version, layers, audioLocales, audioLayers };
    },
  };
}

// G06.04 — the per-layer stop ids for the confirmed switch and the Start
// gate: the same identity rules as the pin (live row wins, else the sole
// package on disk), the map facts of the asked layer.
export function createRunPackageStopsPort(input: {
  driver: SqlDriver;
  bundlesStore: BundlesStore;
  preferredLocales: () => readonly string[];
}): RunPackageStops {
  const { driver, bundlesStore, preferredLocales } = input;
  return {
    stopsOfLayer: async (routeId: string, tier: Tier): Promise<string[] | null> => {
      const live = getLiveSession(driver);
      const identity =
        live && live.routeId === routeId && (live.state === 'active' || live.state === 'paused')
          ? { version: live.version, locale: live.locale }
          : await resolveFreshIdentity(bundlesStore, routeId, preferredLocales);
      if (identity === null) return null;
      const facts = await readRunMapFacts(
        bundlesStore,
        layerPath(routeId, identity.version, identity.locale, tier),
        { routeId, version: identity.version },
      );
      return facts.ok ? facts.stops.map((stop) => stop.stopId) : null;
    },
  };
}

// G04.03 — the Start gate per route: the composition binds the route at
// surface-create time (RunSessionPorts.readiness has no route argument), so
// createServices.run.create overrides the shared readiness with this
// closure's answer for the opened route. The verdict is the disk-fact
// derivation the readiness card documents: readLayerFacts over the asked
// layer (the download writes the layer's lock.json beside its files), the
// base layer granted by the contract's own rule, extended only with a
// grant.
export function createRunReadinessFor(input: {
  driver: SqlDriver;
  bundlesStore: BundlesStore;
  preferredLocales: () => readonly string[];
}): (routeId: string) => RunReadiness {
  const { driver, bundlesStore, preferredLocales } = input;
  return (routeId) => ({
    evaluate: async (ask): Promise<Readiness> => {
      const live = getLiveSession(driver);
      const identity =
        live && live.routeId === routeId && (live.state === 'active' || live.state === 'paused')
          ? { version: live.version, locale: live.locale }
          : await resolveFreshIdentity(bundlesStore, routeId, preferredLocales);
      if (identity === null) return { status: 'incomplete', missing: ['package#absent'] };
      const granted = ask.grantedTiers ?? [];
      const needed: Tier[] = ask.tier === 'extended' ? ['base', 'extended'] : ['base'];
      // The card's own precedence: structural incompleteness first, then
      // access — an incomplete base layer cannot start regardless of grants.
      const tierAvailable = needed.filter((tier) => tier === 'base' || granted.includes(tier));
      if (!tierAvailable.includes(ask.tier)) return { status: 'access-locked', tier: ask.tier };
      for (const tier of tierAvailable) {
        const facts = await readLayerFacts(
          bundlesStore,
          layerPath(routeId, identity.version, identity.locale, tier),
        );
        if (facts.state !== 'ready') {
          const missing = facts.missingCount === null ? 'unknown' : String(facts.missingCount);
          return { status: 'incomplete', missing: [`layer#${tier}#${facts.state}:${missing}`] };
        }
      }
      return {
        status: 'ready',
        routeId,
        version: identity.version,
        tier: ask.tier,
        tierAvailable,
      };
    },
  });
}

// G06.04 — the My KUDY history read over the keyset page the store serves.
export function createSessionHistoryPort(driver: SqlDriver): SessionHistoryPort {
  return {
    listPage: async (cursor: SessionHistoryCursor | null) => listSessionHistoryPage(driver, cursor),
  };
}

// G14.04.d — the durable ui-locale seam over the zone-B settings row: the
// stored value is validated against the canonical locale list, a corrupt row
// reads as no choice (the session default 'be' stands), never a throw.
// G21.15 (issue #549, review round 1): the key is exported so the corruption
// test pins the real seam key — renaming it breaks the test at compile time.
export const UI_LOCALE_KEY = 'ui_locale';

export function createUiLocalePersistence(driver: SqlDriver): UiLocalePersistence {
  return {
    read: () => {
      const stored = getSetting(driver, UI_LOCALE_KEY);
      return stored !== null && (COMPLETE_UI_LOCALES as readonly string[]).includes(stored)
        ? (stored as CompleteUiLocaleCode)
        : null;
    },
    write: (locale) => setSetting(driver, UI_LOCALE_KEY, locale),
  };
}
