// G06.01.a (issue #313) — the city catalog service types. The service turns
// the published catalog envelope (09 §4, 21 §3.3) plus its optional discovery
// index into the guide-card view state the City and Guides surfaces render.
// Ports only — no transport and no digest API live here (the loader port is
// the seam _layout wires to the configured public origin; Node tests pass
// fixtures, the device passes its adapter when the origin and crypto land).
import type { Sha256 } from '../contentRepo/types.ts';

// Text of a published file by its origin-relative path (21 §3.3: only the
// configured public origin; the pointer's `path` is origin-relative without
// the `public/` prefix).
export type CatalogPathLoader = (relPath: string) => Promise<string>;

export type { Sha256 };

// What the envelope's route entry publishes ("спіс усяго, што існуе", 09 §4):
// route_id, version, locales, layers, sizes, product_id — copied verbatim
// from the catalog.schema.json route shape. The strict v1 wire owner is the
// generated contracts/wire/wire-types.ts; THIS projection is intentionally
// looser (string locales, optional sizes) because the same shape serves the
// legacy-v0 and unknown-major routes the envelope routes through it — that
// looseness is a documented mapping, not a schema defect (G20.19, issue #490).
export interface CatalogRouteEntry {
  readonly route_id: string;
  readonly version: string;
  readonly locales: readonly string[];
  readonly layers: readonly string[];
  readonly product_id?: string;
  readonly sizes?: Readonly<Record<string, number>>;
}

// The guide-facing projection of a discovery offer (21 §3.2). Only the fields
// the card renders; places and collections belong to G07.02/G15.03 and are
// not projected here.
export interface CatalogOfferFacts {
  readonly offer_id: string;
  readonly route_id: string;
  readonly editorial_order: number;
  readonly title: string | null;
  readonly summary: string | null;
  readonly text_locales: readonly string[];
  readonly audio_locales: readonly string[];
  readonly access: 'free' | 'paid' | 'mixed';
  readonly estimated_duration:
    | { readonly min_minutes: number; readonly max_minutes: number; readonly basis: string }
    | null;
}

// One guide card. Offer-backed cards carry the offer's editorial facts and
// the availability split (text vs audio — the fact the card renders honestly
// per 21 §3.2). Route-only cards (legacy catalog or a route without an offer)
// know the layer locales only: `localesKnown: false` says the text/audio
// split is not published here, nothing is invented.
export interface CatalogGuideCard {
  readonly routeId: string;
  readonly version: string;
  readonly offerId: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly textLocales: readonly string[];
  readonly audioLocales: readonly string[];
  readonly localesKnown: boolean;
  readonly access: 'free' | 'paid' | 'mixed';
  readonly editorialOrder: number | null;
  readonly estimatedDuration: CatalogOfferFacts['estimated_duration'];
}

// The load outcome, named after the state coverage table
// (docs/design/screens-and-transitions.md): ready (incl. the NAV3 empty city,
// guides: []), offline (last valid cache + banner) and error (no cache — the
// normal city page without discovery, 21 §3.3).
export type CatalogLoadState =
  | { readonly kind: 'ready'; readonly guides: readonly CatalogGuideCard[]; readonly degraded: 'index-unavailable' | null }
  | { readonly kind: 'offline'; readonly guides: readonly CatalogGuideCard[]; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

// G07.01 (issue #281) — the Nearby (Побач) projection of a discovery offer:
// guide and place offers of the validated index. The collection kind belongs
// to G07.02 and is not projected here (the G06.08 canon: collection cards are
// G15.03/G07.02 surfaces). `distance_m` is the authored figure 21 §3.2
// publishes per offer — never a user-relative distance: the index carries no
// user data at all (21 §4: «сігналы nearby не ўваходзяць»), so the surface
// orders by it and renders no «ад вас» numbers (P02, 15 §P02: «без выдуманай
// адлегласці»).
export interface NearbyOfferFacts {
  readonly offer_id: string;
  readonly kind: 'guide' | 'place';
  readonly route_id: string | null;
  readonly place_id: string | null;
  readonly editorial_order: number;
  readonly title: string | null;
  readonly summary: string | null;
  readonly distance_m: number | null;
  readonly text_locales: readonly string[];
  readonly audio_locales: readonly string[];
  readonly access: 'free' | 'paid' | 'mixed';
  readonly estimated_duration: CatalogOfferFacts['estimated_duration'];
  // G16.03 (issue #74) — the opened place card's content identity: the ref's
  // content_version and the locale the card's text actually rendered in (21
  // §5.1: the place rating binds to the opened card's version and the used
  // content locale). A card without a published version carries null and
  // offers no rating — no version is ever invented. A guide offer carries
  // null for both: its rating target is the ended session's own pinned
  // version/locale, never the catalog's current one.
  readonly content_version: string | null;
  readonly content_locale: string | null;
}

// The Nearby load outcome — the same reader-policy states the city list uses
// (09 §4: a failure is fatal only with no previous result).
export type NearbyLoadState =
  | { readonly kind: 'ready'; readonly offers: readonly NearbyOfferFacts[]; readonly degraded: 'index-unavailable' | null }
  | { readonly kind: 'offline'; readonly offers: readonly NearbyOfferFacts[]; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

// The service the composition root hands to the catalog controller: one
// load call re-runs the reader policy over the ports and returns the next
// surface state; `previous` is the last ready/offline projection (09 §4 —
// a failure is fatal only with no previous result).
export interface CatalogService {
  load(previous: readonly CatalogGuideCard[] | null): Promise<CatalogLoadState>;
  // G06.01.b — the guide preview (RouteDetail) assembly for one route: the
  // envelope's route entry + offer facts, plus the route's public document
  // (route.json at bundle/<route_id>/<version>/route.json, the build-bundle
  // public layout) read through the same origin loader — the shared reader
  // policy, no second parser. `previous` is the last ready projection of
  // THIS route (09 §4: a failure is fatal only with no previous result).
  loadPreview(routeId: string, previous: GuidePreview | null): Promise<PreviewLoadState>;
  // G07.01 (issue #281) — the Nearby (Побач) offer list: the validated
  // index's guide and place offers projected for the proximity/review views,
  // canon-ordered and deduped per ref (21 §4 rule 6, the #324 discipline).
  loadNearby(previous: readonly NearbyOfferFacts[] | null): Promise<NearbyLoadState>;
}

// One stop row of the preview. Locked = the stop's narrative is not in the
// free package: an extended-tier stop, or any stop of a `paid` route
// (11 §16.4, 09 §3 `free_stop_count`). Locked rows render name, place,
// announce and lock only — full texts, transcripts and media are never
// projected here (NAV5); the route document's stop entries carry only the
// public `preview` fields by schema, so nothing private can leak through.
export interface PreviewStop {
  readonly stopId: string;
  readonly position: number;
  readonly placeId: string;
  // The place's human title from the discovery index's place offer
  // (localized per the display preference). Null when the index names no
  // such place or publishes no title — the row hides the place line, the
  // raw place_id never renders (UX 05, issue #351).
  readonly placeName: string | null;
  readonly tier: 'base' | 'extended';
  readonly locked: boolean;
  // Localized per the display preference; null when nothing published —
  // the row renders the ordinal position instead of an invented name.
  readonly name: string | null;
  readonly announce: string | null;
  readonly optional: boolean;
}

// The guide preview view state (09 §6.5 RouteDetail row): the card's canon
// facts plus the route document's published facts. Every field stays null
// when its source did not publish it — nothing is invented.
export interface GuidePreview {
  readonly routeId: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string | null;
  readonly textLocales: readonly string[];
  readonly audioLocales: readonly string[];
  readonly localesKnown: boolean;
  readonly access: 'free' | 'paid' | 'mixed';
  // route.json `access` verbatim (route.schema.json: free_base | paid);
  // null when the route document is unavailable.
  readonly routeAccess: 'free_base' | 'paid' | null;
  // route.json `product_id_route` verbatim (route.schema.json) — the store
  // product the commerce offer purchases (G08.05); null when the document
  // did not publish it or is unavailable (no invented product id).
  readonly productId: string | null;
  // The recommended route time: the offer's estimated_duration range when
  // published, else the route document's duration_min (AC1).
  readonly estimatedDuration: CatalogOfferFacts['estimated_duration'];
  readonly durationMin: number | null;
  // 09 §3 Route.free_stop_count — shown for a paid preview (AC2).
  readonly freeStopCount: number | null;
  // The catalog entry's base-layer size in bytes, when published (the
  // «42 МБ» counts line of 09 §6.5).
  readonly baseSizeBytes: number | null;
  // Ordered stops of the route document; null when the document is
  // unavailable or corrupt (degradedRouteDoc carries the named reason).
  readonly stops: readonly PreviewStop[] | null;
  readonly degradedRouteDoc: string | null;
}

// The load outcome for one route's preview: ready (with the degraded note
// when the route document or the index did not serve), not-published (the
// envelope read fine and names no such route — the honest unavailable
// state, never a fabricated preview) and error (the envelope itself could
// not be read and no previous result exists, 09 §4).
export type PreviewLoadState =
  | { readonly kind: 'ready'; readonly preview: GuidePreview; readonly degraded: string | null }
  | { readonly kind: 'not-published' }
  | { readonly kind: 'error'; readonly reason: string };
