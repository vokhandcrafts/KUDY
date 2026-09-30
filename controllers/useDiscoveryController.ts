// G15.03 (issue #70) — the discovery controller: the one owner of the human
// choice (time limit, themes, season — 20 §2, no preference inference) and of
// the index surface state (21 §2). Selection is the pure core
// selectDiscovery; the controller validates the criteria at its boundary
// (21 §4 rule 1: unknown themes, invalid limits are rejected here, the core
// receives valid types). The state has no Run, purchase, GPS or audio ports —
// a collection cannot start a Run or change an entitlement (D07, 21 §2).
// Analytics: the allowlisted discovery_offer_* events (event-table.v1.json)
// with exactly the five payload fields — no time_bucket (decision-required) —
// local recording is the port's concern; without a port the choice works and
// nothing is emitted (consent-denied behavior, 21 §7).
import { createControllerStore, type ControllerStore } from './createControllerStore.ts';
import {
  selectDiscovery,
  type DiscoveryCriteria,
  type DiscoveryIndexV1,
  type DiscoveryOffer,
  type DiscoveryResult,
  type DiscoverySeason,
} from '../core/discovery/selectDiscovery.ts';
import type { DiscoveryIndexState } from '../services/contentRepo/discoveryIndex.ts';

export type {
  DiscoveryCollection,
  DiscoveryDifference,
  DiscoveryIndexV1,
  DiscoveryMatch,
  DiscoveryOffer,
  DiscoveryReason,
  DiscoveryRef,
  DiscoveryResult,
  DiscoverySeason,
} from '../core/discovery/selectDiscovery.ts';

// The first-release time buttons (20 §2): «Без абмежавання» is the null
// limit, the rest are the named minute caps.
export const TIME_LIMITS: readonly number[] = [60, 120, 240];

export const SEASONS: readonly DiscoverySeason[] = ['spring', 'summer', 'autumn', 'winter'];

// The event payload allowlist is exact (event-table.v1.json
// «exact-discovery-payload»): these five fields, nothing else — and no
// time_bucket, which the table marks decision-required.
export interface DiscoveryOfferEvent {
  readonly discovery_revision: string;
  readonly offer_id: string;
  readonly kind: 'guide' | 'place';
  readonly content_locale: string;
  readonly surface: 'discovery' | 'collection';
}

export interface DiscoveryAnalyticsPort {
  offerShown(event: DiscoveryOfferEvent): void;
  offerOpened(event: DiscoveryOfferEvent): void;
}

export interface DiscoveryService {
  load(): Promise<DiscoveryIndexState>;
}

export interface DiscoveryDeps {
  readonly service: DiscoveryService;
  // The content locale of the query (20 §3: the city and query language are
  // never swapped silently). MVP wiring passes the display-locale head.
  readonly criteriaLocale: string;
  readonly analytics?: DiscoveryAnalyticsPort;
}

export type DiscoverySurfaceState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly index: DiscoveryIndexV1;
      readonly revision: string;
      // stale = the last valid snapshot answered (21 §3.3: бачны банэр);
      // staleReason names the fresh-read fault for the banner's detail line.
      readonly stale: boolean;
      readonly staleReason: string | null;
      readonly result: DiscoveryResult;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

// The controls that can change the available choices of the loaded index
// (task step 4: controls render only when they change choices — no fake
// form when one offer fits everything). Derived from the locale-eligible
// offers, independent of the current criteria.
export interface DiscoveryControls {
  readonly timeLimits: readonly number[];
  readonly themeIds: readonly string[];
  readonly seasons: readonly DiscoverySeason[];
}

export interface DiscoveryControllerState {
  readonly surface: DiscoverySurfaceState;
  readonly refreshing: boolean;
  readonly timeLimit: number | null;
  readonly themeIds: readonly string[];
  readonly season: DiscoverySeason | null;
  readonly alternativesShown: boolean;
  readonly controls: DiscoveryControls;
  setTimeLimit(minutes: number | null): void;
  toggleTheme(themeId: string): void;
  setSeason(season: DiscoverySeason | null): void;
  showAlternatives(): void;
  refresh(): Promise<void>;
  recordShown(offers: readonly DiscoveryOffer[], surface: 'discovery' | 'collection'): void;
  recordOpened(offer: DiscoveryOffer, surface: 'discovery' | 'collection'): void;
}

// The display pick of a localized map: the preference order first, then any
// published text rather than an untitled card. Shared by the screens through
// this module (app/ imports controllers only, 19 §4.2).
export function localizedPick(
  value: Record<string, string> | undefined,
  preference: readonly string[],
): string | null {
  if (value === undefined) return null;
  const pick = (locales: readonly string[]): string | null =>
    locales
      .map((locale) => value[locale])
      .find((text): text is string => typeof text === 'string' && text.length > 0) ?? null;
  return pick(preference) ?? pick(Object.keys(value));
}

// offer_id → offer, the screens' resolver for the selection matches.
export function offersById(index: DiscoveryIndexV1): Map<string, DiscoveryOffer> {
  return new Map(index.offers.map((offer) => [offer.offer_id, offer]));
}

// A control renders only when it can change the choice set: some eligible
// offer stays and some eligible offer is excluded. Derived over the open
// criteria (every locale-eligible offer exact), so the answer is a fact of
// the index, not of the current query.
function controlsFor(index: DiscoveryIndexV1, criteriaLocale: string): DiscoveryControls {
  const open: DiscoveryCriteria = { city_id: index.city_id, content_locale: criteriaLocale, theme_ids: [] };
  const eligibleIds = new Set(selectDiscovery(index, open).exact.map((match) => match.offer_id));
  const eligible = index.offers.filter((offer) => eligibleIds.has(offer.offer_id));
  const knownMax = (offer: DiscoveryOffer): number | null => {
    const minutes = offer.estimated_duration?.max_minutes;
    return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  };
  const splits = (kept: number): boolean => kept > 0 && kept < eligible.length;
  return {
    timeLimits: TIME_LIMITS.filter((limit) =>
      splits(eligible.filter((offer) => knownMax(offer) !== null && knownMax(offer)! <= limit).length),
    ),
    themeIds: index.themes
      .map((theme) => theme.id)
      .filter((id) => splits(eligible.filter((offer) => offer.themes.includes(id)).length)),
    seasons: SEASONS.filter((season) =>
      splits(
        eligible.filter((offer) =>
          offer.season_recommendations.some((recommendation) => recommendation.season === season),
        ).length,
      ),
    ),
  };
}

export function createDiscoveryController(deps: DiscoveryDeps): ControllerStore<DiscoveryControllerState> {
  const { service, criteriaLocale, analytics } = deps;
  let seq = 0;
  const shown = new Set<string>();

  const store = createControllerStore<DiscoveryControllerState>((set, get) => {
    const reselect = (): void => {
      const state = get();
      if (state.surface.kind !== 'ready') return;
      set({
        surface: {
          ...state.surface,
          result: selectDiscovery(state.surface.index, toCriteria(state, state.surface.index, criteriaLocale)),
        },
      });
    };
    const applyIndex = (loaded: DiscoveryIndexState): void => {
      if (loaded.kind === 'unavailable') {
        set({ surface: { kind: 'unavailable', reason: loaded.reason } });
        return;
      }
      set({
        surface: {
          kind: 'ready',
          index: loaded.index,
          revision: loaded.revision,
          stale: loaded.stale,
          staleReason: loaded.reason,
          result: selectDiscovery(loaded.index, toCriteria(get(), loaded.index, criteriaLocale)),
        },
        controls: controlsFor(loaded.index, criteriaLocale),
      });
    };
    return {
      surface: { kind: 'loading' },
      refreshing: false,
      timeLimit: null,
      themeIds: [],
      season: null,
      alternativesShown: false,
      controls: { timeLimits: [], themeIds: [], seasons: [] },

      setTimeLimit: (minutes) => {
        // 21 §4 rule 1: a limit outside the named buttons is rejected at the
        // boundary — the previous limit stays, nothing is silently widened.
        if (minutes !== null && !TIME_LIMITS.includes(minutes)) return;
        set({ timeLimit: minutes });
        reselect();
      },

      toggleTheme: (themeId) => {
        const { surface } = get();
        // Unknown themes are rejected at the boundary (21 §4 rule 1).
        if (surface.kind !== 'ready' || !surface.index.themes.some((theme) => theme.id === themeId)) return;
        const themeIds = get().themeIds;
        const next = themeIds.includes(themeId) ? themeIds.filter((id) => id !== themeId) : [...themeIds, themeId];
        set({ themeIds: next });
        reselect();
      },

      setSeason: (season) => {
        if (season !== null && !SEASONS.includes(season)) return;
        set({ season });
        reselect();
      },

      showAlternatives: () => set({ alternativesShown: true }),

      refresh: async () => {
        const run = ++seq;
        if (get().surface.kind !== 'loading') set({ refreshing: true });
        const loaded = await service.load();
        if (run !== seq) return;
        applyIndex(loaded);
        set({ refreshing: false });
      },

      recordShown: (offers, surface) => {
        if (!analytics) return;
        const state = get();
        if (state.surface.kind !== 'ready') return;
        for (const offer of offers) {
          // The event kind enum is guide | place — a collection offer has no
          // shown/opened event in this release (event-table.v1.json).
          if (offer.ref.kind !== 'guide' && offer.ref.kind !== 'place') continue;
          const key = `${surface}:${offer.offer_id}`;
          if (shown.has(key)) continue;
          shown.add(key);
          analytics.offerShown({
            discovery_revision: state.surface.revision,
            offer_id: offer.offer_id,
            kind: offer.ref.kind,
            content_locale: criteriaLocale,
            surface,
          });
        }
      },

      recordOpened: (offer, surface) => {
        if (!analytics) return;
        const state = get();
        if (state.surface.kind !== 'ready') return;
        if (offer.ref.kind !== 'guide' && offer.ref.kind !== 'place') return;
        analytics.offerOpened({
          discovery_revision: state.surface.revision,
          offer_id: offer.offer_id,
          kind: offer.ref.kind,
          content_locale: criteriaLocale,
          surface,
        });
      },
    };
  });
  // The index loads at construction — the same boot pattern as the catalog
  // controller (09 §4: the refresh runs at every start).
  void store.getState().refresh();
  return store;
}

function toCriteria(state: DiscoveryControllerState, index: DiscoveryIndexV1, criteriaLocale: string): DiscoveryCriteria {
  return {
    city_id: index.city_id,
    content_locale: criteriaLocale,
    ...(state.timeLimit !== null ? { max_minutes: state.timeLimit } : {}),
    theme_ids: state.themeIds,
    ...(state.season !== null ? { preferred_season: state.season } : {}),
  };
}
