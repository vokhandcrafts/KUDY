// Build-time assembly of the site's page data from the public layer. Every
// read result must be ok:true — any defined rejection throws SiteDataError and
// fails the build loudly, because a broken catalog pointer must never render
// as an empty page (plan §5: pointer-driven pages over immutable bundles).
// View models keep the contract field names verbatim (implementation-rules 2)
// wherever they restate one; href/languages/stop_count are site-derived.
import path from 'node:path';
import {
  readBundleCatalog,
  readBundleDiscoveryIndex,
  readBundlePlacesGeo,
  readBundlePreviews,
  readBundleRoute,
  readPlaceProjection,
} from './bundle.ts';
import type {
  CatalogRouteEntry,
  DiscoveryIndex,
  DiscoveryOffer,
  LocalizedText,
  ReadResult,
  RejectionCode,
  RouteDoc,
} from './types.ts';
import type { UiLocale } from '../i18n/index.ts';

export class SiteDataError extends Error {
  readonly code: RejectionCode;
  readonly dataPath: string;

  constructor(code: RejectionCode, dataPath: string) {
    super(`${code} at ${dataPath}`);
    this.code = code;
    this.dataPath = dataPath;
  }
}

function unwrap<T>(res: ReadResult<T>, dataPath: string): T {
  if (!res.ok) throw new SiteDataError(res.code, dataPath);
  return res.data;
}

// Locale prefix of a web path (plan §4): be is the default locale at the root,
// every other UI locale is a URL prefix. The single mapping point for hrefs.
export function localePath(locale: UiLocale, pagePath: string): string {
  return locale === 'be' ? pagePath : `/${locale}${pagePath}`;
}

// The content root: build-bundle public output dropped into web/content/
// (the conventional drop point, gitignored). KUDY_CONTENT_ROOT overrides it —
// e.g. a real CDN mirror layout; catalog publication lives in
// tools/publish-catalog (G02.04).
export function getContentRoot(): string {
  return process.env.KUDY_CONTENT_ROOT ?? path.join(process.cwd(), 'content', 'public');
}

interface SiteCatalog {
  routes: CatalogRouteEntry[];
  index: DiscoveryIndex;
  cityId: string;
}

const POINTER_PATTERN = /^discovery\/([a-z0-9._-]{1,64})\/([a-z0-9._-]{1,64})\/index\.json$/;

function readSiteCatalog(root: string): SiteCatalog {
  const catalog = unwrap(readBundleCatalog(root), 'catalog.json');
  const pointer = catalog.discovery_index;
  if (!pointer) throw new SiteDataError('not-found', 'catalog.json:discovery_index');
  const match = POINTER_PATTERN.exec(pointer.path);
  if (!match) throw new SiteDataError('schema-invalid', 'catalog.json:discovery_index.path');
  const index = unwrap(readBundleDiscoveryIndex(root, match[1]!, match[2]!), pointer.path);
  return { routes: catalog.routes, index, cityId: match[1]! };
}

function guideOffer(index: DiscoveryIndex, routeId: string, version: string): DiscoveryOffer {
  const offer = index.offers.find(
    (o) => o.ref.kind === 'guide' && o.ref.route_id === routeId && o.ref.version === version,
  );
  if (!offer) throw new SiteDataError('not-found', `discovery:offers:${routeId}@${version}`);
  return offer;
}

function pickText(text: LocalizedText | undefined, locale: UiLocale, dataPath: string): string {
  const value = text?.[locale];
  if (!value) throw new SiteDataError('unknown-locale', dataPath);
  return value;
}

export interface LanguageFact {
  locale: string;
  audio: boolean;
}

// Per-locale availability is shown by fact (09 §8): the row lists the locales
// the index declares for text, and marks which of them actually have audio.
function languageFacts(offer: DiscoveryOffer): LanguageFact[] {
  return offer.availability.text_locales.map((locale) => ({
    locale,
    audio: offer.availability.audio_locales.includes(locale),
  }));
}

export interface CatalogCard {
  route_id: string;
  href: string;
  title: string;
  summary: string;
  duration_min: number;
  distance_m: number;
  stop_count: number;
  languages: LanguageFact[];
}

export interface CatalogPageData {
  cityId: string;
  cards: CatalogCard[];
  // The static /map route exists since the founder's tile-provider decision
  // (2026-09-21, recorded in docs/agent-tasks/results/G10.01.b.md) — until
  // then the entry stayed hidden (TR-8: a dead link is the worst option).
  mapHref: string;
}

// The published routes in catalog order: discovery editorial_order first, the
// catalog file order breaking ties. One ordering for the catalog cards and the
// map route list, so every page shows the same sequence.
function orderedOffers(index: DiscoveryIndex, routes: CatalogRouteEntry[]): { entry: CatalogRouteEntry; offer: DiscoveryOffer }[] {
  return routes
    .map((entry, order) => ({ entry, order, offer: guideOffer(index, entry.route_id, entry.version) }))
    .sort((a, b) => a.offer.editorial_order - b.offer.editorial_order || a.order - b.order)
    .map(({ entry, offer }) => ({ entry, offer }));
}

export function readSiteCatalogPage(root: string, locale: UiLocale): CatalogPageData {
  const { routes, index, cityId } = readSiteCatalog(root);
  const cards = orderedOffers(index, routes).map(({ entry, offer }): CatalogCard => {
    const route = unwrap(readBundleRoute(root, entry.route_id, entry.version), `bundle/${entry.route_id}/${entry.version}/route.json`);
    return {
      route_id: entry.route_id,
      href: localePath(locale, `/guides/${entry.route_id}`),
      title: pickText(offer.localized.title, locale, `discovery:offers:${entry.route_id}:${locale}`),
      summary: pickText(offer.localized.summary, locale, `discovery:offers:${entry.route_id}:${locale}`),
      duration_min: route.duration_min,
      distance_m: route.distance_m,
      stop_count: route.stops.length,
      languages: languageFacts(offer),
    };
  });
  return { cityId, cards, mapHref: localePath(locale, '/map') };
}

export interface StopRow {
  stop_id: string;
  place_id: string;
  locked: boolean;
  name: string;
  announce: string | null;
}

export interface GuidePageData {
  route_id: string;
  title: string;
  summary: string;
  cover: string | null;
  duration_min: number;
  distance_m: number;
  stop_count: number;
  languages: LanguageFact[];
  stops: StopRow[];
}

// Stop rows of one route, position order: base stops read their name from the
// place projection, locked stops from the four-field previews (09 §5). Shared
// by the guide page and the map page — one derivation, not two.
function siteStopRows(root: string, locale: UiLocale, routeId: string, version: string, route: RouteDoc): StopRow[] {
  const previews = unwrap(
    readBundlePreviews(root, routeId, version, locale),
    `bundle/${routeId}/${version}/${locale}/base/previews.json`,
  );
  return [...route.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop): StopRow => {
      if (stop.access_tier === 'extended') {
        const preview = previews.find((p) => p.stop_id === stop.id);
        if (!preview) throw new SiteDataError('invalid-preview', `previews:${stop.id}`);
        return {
          stop_id: preview.stop_id,
          place_id: preview.place_id,
          locked: true,
          name: pickText(preview.name, locale, `previews:${stop.id}:${locale}`),
          announce: pickText(preview.announce, locale, `previews:${stop.id}:${locale}`),
        };
      }
      const projection = unwrap(readPlaceProjection(root, stop.place_id), `places/${stop.place_id}/public.json`);
      return {
        stop_id: stop.id,
        place_id: stop.place_id,
        locked: false,
        name: pickText(projection.name, locale, `places/${stop.place_id}:${locale}`),
        announce: null,
      };
    });
}

export function readSiteGuidePage(root: string, locale: UiLocale, routeId: string): GuidePageData {
  const { routes, index, cityId } = readSiteCatalog(root);
  const entry = routes.find((r) => r.route_id === routeId);
  if (!entry) throw new SiteDataError('not-found', `catalog.json:routes:${routeId}`);
  const route: RouteDoc = unwrap(readBundleRoute(root, routeId, entry.version), `bundle/${routeId}/${entry.version}/route.json`);
  if (route.city_id !== cityId) {
    throw new SiteDataError('schema-invalid', `catalog.json:discovery_index.path:${routeId}`);
  }
  const offer = guideOffer(index, routeId, entry.version);
  const stops = siteStopRows(root, locale, routeId, entry.version, route);
  return {
    route_id: route.route_id,
    title: pickText(offer.localized.title, locale, `discovery:offers:${routeId}:${locale}`),
    summary: pickText(offer.localized.summary, locale, `discovery:offers:${routeId}:${locale}`),
    cover: route.cover ?? null,
    duration_min: route.duration_min,
    distance_m: route.distance_m,
    stop_count: route.stops.length,
    languages: languageFacts(offer),
    stops,
  };
}

// Prerender params for the guide pages: one entry per catalog route, so an
// unknown route_id is never prerendered and a stale one fails the build here.
export function guideStaticParams(): { route_id: string }[] {
  const { routes } = readSiteCatalog(getContentRoot());
  return routes.map((route) => ({ route_id: route.route_id }));
}

export interface MapStop {
  stop_id: string;
  place_id: string;
  name: string;
  locked: boolean;
  lat: number;
  lng: number;
}

export interface MapRoute {
  route_id: string;
  title: string;
  href: string;
  stops: MapStop[];
}

// GeoJSON point markers for the client map. GeoJSON coordinates are
// [lng, lat] — the map tests assert the order so the axes can never silently
// swap. Properties carry public names only; the client renders markers as
// non-interactive dots.
export interface MapMarkers {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { route_id: string; stop_id: string; name: string; locked: boolean };
  }[];
}

export interface MapPageData {
  cityId: string;
  routes: MapRoute[];
  markers: MapMarkers;
}

// The static city map data (G10.01.b step 3): every catalog route with its
// stops in position order, each stop joined to its place's geo facts from the
// bundle places.json. A stop whose place has no geo entry fails the build
// loudly — a marker-less stop must never render as a silently missing dot.
export function readSiteMapPage(root: string, locale: UiLocale): MapPageData {
  const { routes, index, cityId } = readSiteCatalog(root);
  const mapRoutes: MapRoute[] = [];
  const features: MapMarkers['features'] = [];
  for (const { entry, offer } of orderedOffers(index, routes)) {
    const route: RouteDoc = unwrap(readBundleRoute(root, entry.route_id, entry.version), `bundle/${entry.route_id}/${entry.version}/route.json`);
    const geo = unwrap(readBundlePlacesGeo(root, entry.route_id, entry.version), `bundle/${entry.route_id}/${entry.version}/places.json`);
    const geoById = new Map(geo.map((place) => [place.id, place]));
    const stops = siteStopRows(root, locale, entry.route_id, entry.version, route).map((row): MapStop => {
      const place = geoById.get(row.place_id);
      if (!place) {
        throw new SiteDataError('not-found', `bundle/${entry.route_id}/${entry.version}/places.json:${row.place_id}`);
      }
      return {
        stop_id: row.stop_id,
        place_id: row.place_id,
        name: row.name,
        locked: row.locked,
        lat: place.lat,
        lng: place.lng,
      };
    });
    mapRoutes.push({
      route_id: entry.route_id,
      title: pickText(offer.localized.title, locale, `discovery:offers:${entry.route_id}:${locale}`),
      href: localePath(locale, `/guides/${entry.route_id}`),
      stops,
    });
    for (const stop of stops) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
        properties: { route_id: entry.route_id, stop_id: stop.stop_id, name: stop.name, locked: stop.locked },
      });
    }
  }
  return { cityId, routes: mapRoutes, markers: { type: 'FeatureCollection', features } };
}
