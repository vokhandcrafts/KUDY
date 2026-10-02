// Typed shapes of the public layer the web reads. The catalog and bundle wire
// definitions and the locale allowlist are NOT restated here:
// contracts/wire/wire-types.ts (generated verbatim from contracts/schemas/,
// G20.19 issue #490) is their single owner and this module re-exports it.
// Declared below are only the shapes no schema owns yet: reader-result
// envelopes, the discovery wire, story, previews and the public projections.
export type {
  CatalogPointer,
  CatalogRouteEntry,
  CatalogView,
  Locale,
  LocalizedText,
  RouteDoc,
  RouteStop,
} from '../../../contracts/wire/wire-types.ts';

import type { Locale, LocalizedText } from '../../../contracts/wire/wire-types.ts';

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
// is a defined safe rejection, not a partial render — G02.05 rule). The wire
// shapes (CatalogRouteEntry, CatalogPointer, CatalogView) come from the
// generated contracts/wire/wire-types.ts re-export above.

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

// place.schema.json — one entry of the bundle places.json (locale-neutral geo
// facts, 09 §3): lat/lng/trigger_radius_m/kind without names or descriptions,
// which live in the per-locale projections. Field names verbatim from the
// schema; the map page reads lat/lng for the static overview markers.
export interface PlaceGeoDoc {
  origin?: 'official' | 'imported';
  id: string;
  content_version: string;
  lat: number;
  lng: number;
  trigger_radius_m: number;
  district?: string;
  kind: string;
  photo?: string;
  name_audio_refs?: Partial<Record<Locale, string>>;
}
