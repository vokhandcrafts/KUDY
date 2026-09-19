// Typed shapes of the public layer the web reads. Field names are copied
// verbatim from the versioned contracts (contracts/schemas/) — the bundle
// format is a public contract (09 §4), nothing is invented at the call site.

export type Locale = 'be' | 'en' | 'uk';

// localized-text.schema.json: subset of the be/en/uk allowlist, non-empty strings.
export type LocalizedText = { [K in Locale]?: string };

export type RejectionCode =
  | 'unknown-schema-version'
  | 'schema-invalid'
  | 'index-rules-invalid'
  | 'invalid-json'
  | 'not-found'
  | 'non-base-story'
  | 'invalid-preview'
  | 'unknown-locale'
  | 'unsafe-path';

export interface ContractError {
  rule: string;
  path: string;
}

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: RejectionCode; errors: ContractError[] };

// catalog.schema.json envelope, v1 only (web policy: unknown catalog_schema_version
// is a defined safe rejection, not a partial render — G02.05 rule).
export interface CatalogRouteEntry {
  route_id: string;
  version: string;
  locales: Locale[];
  layers: string[];
  product_id?: string;
  // catalog.schema.json: sizes is required and requires base (09 §4: sizes
  // per layer, not bytes); extended is optional; no other keys allowed.
  sizes: { base: number; extended?: number };
}

export interface CatalogPointer {
  schema_version: number;
  revision: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface CatalogView {
  routes: CatalogRouteEntry[];
  discovery_index: CatalogPointer | null;
}

// DiscoveryIndexV1 per 21 §3.2 — fields read by the web channel.
export interface DiscoveryRef {
  kind: 'guide' | 'place';
  route_id?: string;
  version?: string;
  place_id?: string;
  content_version?: string;
}

export interface DiscoveryOffer {
  offer_id: string;
  ref: DiscoveryRef;
  city_id: string;
  editorial_order: number;
  themes: string[];
  localized: Record<string, LocalizedText>;
  estimated_duration?: { min_minutes: number; max_minutes: number; basis: string };
  distance_m?: number;
  suggested_start_place_id?: string;
  season_recommendations: { season: string; reason: LocalizedText }[];
  availability: { text_locales: Locale[]; audio_locales: Locale[] };
  access: 'free' | 'paid' | 'mixed';
  detail_ref: { kind: string; path: string };
}

export interface DiscoveryCollection {
  collection_id: string;
  content_version: string;
  city_id: string;
  localized: Record<string, LocalizedText>;
  members: DiscoveryRef[];
  overlap_note?: LocalizedText;
}

export interface DiscoveryIndex {
  schema_version: number;
  revision: string;
  city_id: string;
  themes: { id: string; labels: LocalizedText }[];
  offers: DiscoveryOffer[];
  collections: DiscoveryCollection[];
}

// route.schema.json / stop.schema.json.
export interface RouteStop {
  // origin — reserved provenance field (stop.schema.json, G02.01).
  origin?: 'official' | 'imported';
  id: string;
  position: number;
  place_id: string;
  access_tier: 'base' | 'extended';
  story_base_id?: string;
  story_extended_id?: string;
  trigger_radius_m?: number;
  optional?: boolean;
  preview?: { name: LocalizedText; announce: LocalizedText };
}

export interface RouteDoc {
  // origin — reserved provenance field (route.schema.json, G02.01).
  origin?: 'official' | 'imported';
  route_id: string;
  version: string;
  city_id: string;
  access: 'free_base' | 'paid';
  product_id_route?: string;
  product_id_extension?: string;
  distance_m: number;
  duration_min: number;
  cover?: string;
  polyline?: string;
  published?: boolean;
  free_stop_count: number;
  stops: RouteStop[];
}

// story.schema.json — one entry of the per-locale base stops.json.
export interface Story {
  story_id: string;
  place_id: string;
  tier: 'base' | 'extended';
  duration_s: number;
  voice_id: string;
  tone: 'standard' | 'memorial';
  text: string;
  transcript: string;
  sources: string[];
  review: { by: string; at: string; decision: 'approved' | 'rejected' | 'pending' };
}

// previews.json — 09 §5: only stop_id, place_id, name, announce, ever.
export interface LockedStopPreview {
  stop_id: string;
  place_id: string;
  name: LocalizedText;
  announce: LocalizedText;
}

// public-projection.schema.json — place or collection public projection.
export interface PlaceProjection {
  place_id: string;
  content_version: string;
  name: LocalizedText;
  summary: LocalizedText;
}

export interface CollectionProjection {
  collection_id: string;
  content_version: string;
  name: LocalizedText;
  description: LocalizedText;
}

export type PublicProjection = PlaceProjection | CollectionProjection;
