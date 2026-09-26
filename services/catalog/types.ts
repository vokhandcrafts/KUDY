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
// from the catalog.schema.json route shape.
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

// The service the composition root hands to the catalog controller: one
// load call re-runs the reader policy over the ports and returns the next
// surface state; `previous` is the last ready/offline projection (09 §4 —
// a failure is fatal only with no previous result).
export interface CatalogService {
  load(previous: readonly CatalogGuideCard[] | null): Promise<CatalogLoadState>;
}
