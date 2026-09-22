// Build-time assembly of the site's page data from the public layer. Every
// read result must be ok:true — any defined rejection throws SiteDataError and
// fails the build loudly, because a broken catalog pointer must never render
// as an empty page (plan §5: pointer-driven pages over immutable bundles).
// View models keep the contract field names verbatim (implementation-rules 2)
// wherever they restate one; href/languages/stop_count are site-derived.
import fs from 'node:fs';
import path from 'node:path';
import {
  readBundleBaseStories,
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
  Locale,
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
  // Site-derived: the stop page's locale-prefixed URL. The scheme is stable
  // from the first release — the future app deep links (09 §13 M7) mirror it.
  href: string;
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
  const stopHref = (stopId: string) => localePath(locale, `/guides/${routeId}/stops/${stopId}`);
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
          href: stopHref(preview.stop_id),
        };
      }
      const projection = unwrap(readPlaceProjection(root, stop.place_id), `places/${stop.place_id}/public.json`);
      return {
        stop_id: stop.id,
        place_id: stop.place_id,
        locked: false,
        name: pickText(projection.name, locale, `places/${stop.place_id}:${locale}`),
        announce: null,
        href: stopHref(stop.id),
      };
    });
}

// Shared preamble of the guide and stop pages: resolve the catalog entry for
// one route, read its route doc and verify the city — one implementation,
// not two (jscpd gate).
function resolvedCatalogRoute(root: string, routeId: string): {
  entry: CatalogRouteEntry;
  route: RouteDoc;
  offer: DiscoveryOffer;
} {
  const { routes, index, cityId } = readSiteCatalog(root);
  const entry = routes.find((r) => r.route_id === routeId);
  if (!entry) throw new SiteDataError('not-found', `catalog.json:routes:${routeId}`);
  const route: RouteDoc = unwrap(readBundleRoute(root, routeId, entry.version), `bundle/${routeId}/${entry.version}/route.json`);
  if (route.city_id !== cityId) {
    throw new SiteDataError('schema-invalid', `catalog.json:discovery_index.path:${routeId}`);
  }
  const offer = guideOffer(index, routeId, entry.version);
  return { entry, route, offer };
}

export function readSiteGuidePage(root: string, locale: UiLocale, routeId: string): GuidePageData {
  const { entry, route, offer } = resolvedCatalogRoute(root, routeId);
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

// Public bundle assets the pages reference (story audio, covers) are served
// from the content mirror the prebuild drops into web/public/ — see
// scripts/build-content.ts. This is the single mapping point between the
// on-disk public tree and the URL the deployed site serves it at.
const CONTENT_ASSET_BASE = '/content';

function bundleAudioSrc(routeId: string, version: string, locale: string, storyId: string): string {
  return `${CONTENT_ASSET_BASE}/bundle/${routeId}/${version}/${locale}/base/audio/${storyId}.m4a`;
}

function bundleAudioExists(root: string, routeId: string, version: string, locale: string, storyId: string): boolean {
  return fs.existsSync(path.join(root, 'bundle', routeId, version, locale, 'base', 'audio', `${storyId}.m4a`));
}

export interface StopNeighbor {
  stop_id: string;
  name: string;
  href: string;
}

interface StopPageBase {
  route_id: string;
  route_title: string;
  guide_href: string;
  stop_id: string;
  name: string;
  // Recommended order as display order only (09 §3: position is never a
  // playback condition); any stop stays directly openable by URL.
  prev: StopNeighbor | null;
  next: StopNeighbor | null;
}

export interface FreeStopPageData extends StopPageBase {
  locked: false;
  // The full spoken text of the base story, server-rendered for SEO (M3).
  transcript: string;
  // One entry per bundle locale whose base audio file actually exists
  // (09 §8: availability by fact; at launch that is be). An empty list is the
  // player's user-visible failure state — silence is never a state (step 5).
  audio: { locale: Locale; src: string }[];
}

export interface LockedStopPageData extends StopPageBase {
  locked: true;
  announce: string;
  // The leak boundary at the data layer: a locked stop's page data carries no
  // audio and no transcript field at all — there is nothing to render wrongly.
}

export type StopPageData = FreeStopPageData | LockedStopPageData;

export function readSiteStopPage(root: string, locale: UiLocale, routeId: string, stopId: string): StopPageData {
  const { entry, route, offer } = resolvedCatalogRoute(root, routeId);
  const rows = siteStopRows(root, locale, routeId, entry.version, route);
  const at = rows.findIndex((row) => row.stop_id === stopId);
  if (at < 0) throw new SiteDataError('not-found', `route.json:stops:${stopId}`);
  const row = rows[at]!;
  const neighbor = (stop: StopRow | undefined): StopNeighbor | null =>
    stop ? { stop_id: stop.stop_id, name: stop.name, href: stop.href } : null;
  const base = {
    route_id: route.route_id,
    route_title: pickText(offer.localized.title, locale, `discovery:offers:${routeId}:${locale}`),
    guide_href: localePath(locale, `/guides/${routeId}`),
    stop_id: row.stop_id,
    name: row.name,
    prev: neighbor(rows[at - 1]),
    next: neighbor(rows[at + 1]),
  };
  if (row.locked) {
    if (row.announce === null) throw new SiteDataError('invalid-preview', `previews:${stopId}:announce`);
    return { ...base, locked: true, announce: row.announce };
  }
  const rawStop = route.stops.find((stop) => stop.id === stopId)!;
  const storyId = rawStop.story_base_id;
  if (!storyId) throw new SiteDataError('not-found', `route.json:stops:${stopId}:story_base_id`);
  const stories = unwrap(
    readBundleBaseStories(root, routeId, entry.version, locale),
    `bundle/${routeId}/${entry.version}/${locale}/base/stops.json`,
  );
  const story = stories.find((candidate) => candidate.story_id === storyId);
  if (!story) throw new SiteDataError('not-found', `stops.json:${storyId}`);
  const audio = [...entry.locales]
    .sort()
    .filter((candidate) => bundleAudioExists(root, routeId, entry.version, candidate, storyId))
    .map((candidate) => ({ locale: candidate, src: bundleAudioSrc(routeId, entry.version, candidate, storyId) }));
  return { ...base, locked: false, transcript: story.transcript, audio };
}

// Prerender params for the stop pages: one entry per route × stop of the
// catalog, free and locked alike (both render a defined page). An unknown
// stop_id is never prerendered, so an unknown URL reaches the static
// not-found state instead of a partial render (step 4).
export function stopStaticParams(root: string = getContentRoot()): { route_id: string; stop_id: string }[] {
  const { routes } = readSiteCatalog(root);
  const params: { route_id: string; stop_id: string }[] = [];
  for (const entry of routes) {
    const route = unwrap(readBundleRoute(root, entry.route_id, entry.version), `bundle/${entry.route_id}/${entry.version}/route.json`);
    for (const stop of route.stops) {
      params.push({ route_id: entry.route_id, stop_id: stop.id });
    }
  }
  return params;
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
