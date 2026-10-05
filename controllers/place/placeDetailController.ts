// G07.02 (issue #282) — the place detail controller (Journey 3: «месца або
// Moment → прэв'ю»): the place offer's facts from the already-validated
// catalog projection (one reader policy — no second place_public fetch path)
// plus the place's moment teasers read from the downloaded packages' root
// manifests. The play/ownership decisions live in the moment controller
// (ADR G01.02); this surface only offers them — a card tap starts no audio
// (R04), the teaser sounds only through its explicit Play.
// One binding per open (the Nearby surface's pattern): the boot load IS the
// refresh-at-every-open policy (09 §4); the store dies with the surface. The
// screen subscribes through the shared useStoreState hook (G07.01) — no
// sibling copies.
import type { CatalogService, NearbyOfferFacts } from '../../services/catalog/types.ts';
import type { MomentFact, MomentFacts } from '../../services/contentRepo/momentFacts.ts';
// G21.09 (issue #542): the message shapes live in the shared pure contract zone.
import type { PlaceDetailStrings } from '../../contracts/ui-message-types.ts';
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import { PLACE_DETAIL_STRINGS_DATA } from './placeDetail-strings.generated.ts';

// The view types the screens render — re-exported here so the UI layer keeps
// importing its view types from the controllers (the nearby controller's
// re-export idiom).
export type { MomentFact };

export interface PlaceDetailDeps {
  readonly service: Pick<CatalogService, 'loadNearby'>;
  // The moment facts reader over the downloaded packages; absent without a
  // bundles store — the detail renders its facts without teasers. G22.05
  // (issue #610): the open passes its place to the reader, so media and
  // text resolve only for this place — the reader scopes before media
  // resolution, never after.
  readonly moments?: (placeId: string) => Promise<MomentFacts>;
  readonly placeId: string;
}

export type PlaceDetailState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly facts: NearbyOfferFacts | null;
      readonly moments: readonly MomentFact[];
      readonly degraded: 'index-unavailable' | null;
    }
  | { readonly kind: 'error'; readonly reason: string };

export interface PlaceDetailBinding {
  readonly store: ControllerStore<PlaceDetailState>;
  readonly placeId: string;
}

const NO_MOMENTS: MomentFacts = { ok: true, moments: [], diagnostics: [] };

export function createPlaceDetailController(deps: PlaceDetailDeps): PlaceDetailBinding {
  const store = createControllerStore<PlaceDetailState>(() => ({ kind: 'loading' }));
  void load(store, deps);
  return { store, placeId: deps.placeId };
}

async function load(store: ControllerStore<PlaceDetailState>, deps: PlaceDetailDeps): Promise<void> {
  try {
    const [nearby, moments] = await Promise.all([
      deps.service.loadNearby(null),
      deps.moments ? deps.moments(deps.placeId) : Promise.resolve(NO_MOMENTS),
    ]);
    // The catalog state decides the facts line; the teasers are library
    // truth and render regardless of the catalog's fate.
    const facts =
      (nearby.kind === 'ready' || nearby.kind === 'offline')
        ? nearby.offers.find((offer) => offer.kind === 'place' && offer.place_id === deps.placeId) ?? null
        : null;
    store.setState({
      kind: 'ready',
      facts,
      moments: moments.ok ? moments.moments.filter((moment) => moment.placeId === deps.placeId) : [],
      degraded: nearby.kind === 'ready' ? nearby.degraded : null,
    });
  } catch {
    store.setState({ kind: 'error', reason: 'place#load-failed' });
  }
}

// The surface words (09 §0: BE first, EN beside — the nearbyStrings idiom).
export type { PlaceDetailStrings } from '../../contracts/ui-message-types.ts';

// The refusal's rendered word: the known map, else the raw reason itself
// (the runMapReason idiom).
export function placeRefusalText(refusal: string, strings: PlaceDetailStrings): string {
  return strings.refusalText[refusal as keyof PlaceDetailStrings['refusalText']] ?? refusal;
}

const STRINGS = PLACE_DETAIL_STRINGS_DATA;

export function placeDetailStrings(locale: string): PlaceDetailStrings {
  return locale === 'fr' ? STRINGS.fr : locale === 'de' ? STRINGS.de : locale === 'en' ? STRINGS.en : locale === 'uk' ? STRINGS.uk : STRINGS.be;
}
