// G07.01 (issue #281) — the Nearby (Побач) surface controller: the discovery
// offers of the active city (21 §3.2, projected by the catalog service) in
// the two views the canon names (G06.08 screens.md «Побач», P02 in 15):
// proximity — with an allowed position, the offers ordered by the authored
// distance the index publishes; review — without a position, the manual
// list in the canon order. The index carries no user-relative data (21 §4:
// «сігналы nearby не ўваходзяць»), so no «ад вас» distance is rendered
// anywhere (P02: «без выдуманай адлегласці»).
//
// Location discipline (criterion 4, 09 §20): the surface never owns a second
// GPS subscription. It arms the ONE LocationService's city-surface mode only
// when no walk holds it, releases what it armed on unmount, and never
// touches the mode or the fix sink of a live or paused session (G07.03 owns
// the active-Run behaviour). No audio path exists here at all (criterion 3,
// R04): a radius entry and a card tap produce no audio event — the render
// suite fails if one is wired.
import { useEffect, useState } from 'react';

import { byEditorialOrder } from '../../core/discovery/selectDiscovery.ts';
import type { CatalogService, NearbyOfferFacts } from '../../services/catalog/types.ts';
import type { LocationMode, LocationStatus } from '../../services/location/types.ts';
// G21.09 (issue #542): the message shapes live in the shared pure contract zone.
import type { NearbyStrings } from '../../contracts/ui-message-types.ts';
import type { LocationService } from '../../services/location/service.ts';
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import { useStoreState } from '../useControllerStore.ts';
import { NEARBY_STRINGS_DATA } from './nearbySurface-strings.generated.ts';

// The offer facts type the screens render — re-exported here so the UI layer
// keeps importing its view types from the controllers (the catalog
// controller's own re-export idiom).
export type { NearbyOfferFacts };

// The surface state the screen renders — the load outcome of the service,
// the city catalog's state coverage (loading / ready / offline / error).
export type NearbySurfaceState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly offers: readonly NearbyOfferFacts[]; readonly degraded: 'index-unavailable' | null }
  | { readonly kind: 'offline'; readonly offers: readonly NearbyOfferFacts[]; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

export interface NearbySurfaceDeps {
  readonly service: Pick<CatalogService, 'loadNearby'>;
  readonly location: LocationService | undefined;
  readonly locale: string;
}

// One opened Nearby surface: the offers store plus the location service the
// arming guard may use (absent until the device adapter lands — the review
// view is then the honest default, criterion 2).
export interface NearbySurfaceBinding {
  readonly store: ControllerStore<NearbySurfaceState>;
  readonly location: LocationService | undefined;
  readonly locale: string;
}

export function createNearbySurfaceController(deps: NearbySurfaceDeps): NearbySurfaceBinding {
  const store = createControllerStore<NearbySurfaceState>(() => ({ kind: 'loading' }));
  // The binding lives one surface opening (the screen's useMemo): the boot
  // load IS the revalidate-at-every-start policy (09 §4) — the store dies
  // with the surface, so there is no refresh API, no superseded-run guard
  // and no previous-result cache to keep (the singleton catalog controller
  // needs those; this per-open store does not).
  void deps.service
    .loadNearby(null)
    .then((surface) => store.setState(surface))
    .catch(() => store.setState({ kind: 'error', reason: 'nearby#load-failed' }));
  return { store, location: deps.location, locale: deps.locale };
}

// The arming guard (criterion 4): the surface arms the one city subscription
// only when no walk holds it. A live or paused session keeps its owner — the
// surface renders the review list in that context (G07.03 owns the
// active-Run behaviour); the guard is pure so the node suite proves the
// discipline per mode.
export function nearbyArmingDecision(mode: LocationMode): 'arm' | 'hold' {
  return mode === 'idle' || mode === 'city-surface' ? 'arm' : 'hold';
}

// The location view the surface renders from the service's own state — no
// second position owner is created to learn it (criterion 4).
export type NearbyLocationView =
  | { readonly state: 'absent' }
  | { readonly state: 'held-by-walk' }
  | { readonly state: 'denied' }
  | { readonly state: 'proximity'; readonly note: 'acquiring' | 'recovering' | 'stalled' | null };

function nearbyLocationView(location: LocationService): NearbyLocationView {
  const status: LocationStatus = location.status();
  if (status.state === 'permission-denied') return { state: 'denied' };
  // The proximity view is this surface's own armed state (city-surface — the
  // mode the arming guard sets). A walk's active-guide/paused subscription
  // stays the walk's (G07.03's context) and renders the review view.
  if (location.currentMode() !== 'city-surface') return { state: 'held-by-walk' };
  const note: Extract<NearbyLocationView, { state: 'proximity' }>['note'] =
    status.state === 'acquiring' || status.state === 'recovering' || status.state === 'stalled'
      ? status.state
      : null;
  return { state: 'proximity', note };
}

// The review order (21 §4 rule 6): editorial_order, then offer_id for
// stability. The proximity view (criterion 1) orders nearest-first by the
// published authored distance; an offer without the figure sorts after every
// known one — never a fabricated figure — and the canon order breaks ties.
export function nearbyOrder(
  offers: readonly NearbyOfferFacts[],
  view: NearbyLocationView,
): readonly NearbyOfferFacts[] {
  if (view.state !== 'proximity') return [...offers].sort(byEditorialOrder);
  return [...offers].sort((a, b) => {
    const da = a.distance_m ?? Number.POSITIVE_INFINITY;
    const db = b.distance_m ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return byEditorialOrder(a, b);
  });
}

// --- React bindings (hooks as controllers, 19 §2.2) ---------------------------

const STATUS_POLL_MS = 500;

export function useNearbySurface(
  binding: NearbySurfaceBinding | undefined,
): { surface: NearbySurfaceState | null; locationView: NearbyLocationView; locale: string } {
  const store = binding?.store;
  const surface = useStoreState(store);
  const location = binding?.location;
  const locale = binding?.locale ?? 'be';
  const [locationView, setLocationView] = useState<NearbyLocationView>({ state: 'absent' });
  useEffect(() => {
    if (!location) {
      setLocationView({ state: 'absent' });
      return;
    }
    let armedByUs = false;
    let foreground = false;
    let disposed = false;
    const releaseLocation = () => {
      if (armedByUs && location.currentMode() === 'city-surface') location.setMode('idle');
      armedByUs = false;
    };
    const read = () => {
      if (disposed) return;
      if (!foreground) {
        releaseLocation();
        setLocationView({ state: 'absent' });
        return;
      }
      // The arming decision is re-evaluated every tick, not only on mount: a
      // walk that starts (or ends) while the surface stays mounted changes
      // the mode under us — the guard arms whenever the mode is free again,
      // whether the surface armed first or the walk did, and never touches a
      // walk's own subscription (criterion 4, 11 §7: the named state never
      // sticks).
      const mode = location.currentMode();
      if (mode !== 'city-surface') armedByUs = false;
      if (nearbyArmingDecision(mode) === 'arm' && mode !== 'city-surface') {
        location.setMode('city-surface');
        armedByUs = true;
      }
      setLocationView(nearbyLocationView(location));
    };
    // Pure Node consumers call controller decisions without a native runtime;
    // React mounts this lifecycle observer only on the rendered surface.
    const { AppState }: typeof import('react-native') = require('react-native');
    foreground = AppState.currentState === 'active';
    const appStateSubscription = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      read();
    });
    read();
    // The service emits no status change event; the surface polls its
    // status() read while open (a permission answer, a grant or a watchdog
    // step land within one poll — the render suite's waits rely on it).
    const timer = setInterval(read, STATUS_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
      // 09 §20: the subscription is released when the surface closes — only
      // what this surface armed, never a walk's own mode.
      appStateSubscription.remove();
      releaseLocation();
    };
  }, [location]);
  return { surface, locationView, locale };
}

// --- Words (BE/EN; the language canon is 09 §0 — be + en) ---------------------

export type { NearbyStrings } from '../../contracts/ui-message-types.ts';

const STRINGS = NEARBY_STRINGS_DATA;

export function nearbyStrings(locale: string): NearbyStrings {
  return locale === 'fr' ? STRINGS.fr : locale === 'de' ? STRINGS.de : locale === 'en' ? STRINGS.en : locale === 'uk' ? STRINGS.uk : STRINGS.be;
}
