// G06.01.a (issue #313) — the city catalog service: the published catalog
// envelope plus its optional discovery index, projected into the guide-card
// view state. Reader policy per 09 §4 and 21 §3.3: refresh at every load, a
// failure is fatal only with no previous result (offline over the last valid
// cache, otherwise the error that renders the normal city page); the index
// pointer's declared size is checked before fetching, the fetched text is
// pinned to the declared sha256, and any index trouble degrades to
// route-entry cards without inventing content. All inputs are untrusted:
// corrupt text answers with a named state, never a thrown error.
import { isSafeRel } from '../contentRepo/inventory.ts';
import type { Sha256 } from '../contentRepo/types.ts';
import { readCatalogEnvelope, type CatalogEnvelope } from './envelope.ts';
import type {
  CatalogGuideCard,
  CatalogLoadState,
  CatalogOfferFacts,
  CatalogPathLoader,
  CatalogService,
  GuidePreview,
  PreviewLoadState,
  PreviewStop,
} from './types.ts';

export interface CatalogDeps {
  readonly loader: CatalogPathLoader;
  readonly sha256: Sha256;
}

// Display-locale preference for the localized labels; callers inject the UI
// locale order (MVP wiring: be first), the service never guesses one.
export interface CatalogDisplayOptions {
  readonly localePreference: readonly string[];
}

const CATALOG_PATH = 'catalog.json';

const DEFAULT_LOCALE_PREFERENCE: readonly string[] = ['be', 'en'];

function localizedLabel(value: unknown, preference: readonly string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  const labels = value as Record<string, unknown>;
  for (const locale of preference) {
    const label = labels[locale];
    if (typeof label === 'string' && label.length > 0) return label;
  }
  // No preferred label published — fall back to any published one rather
  // than rendering an untitled card; the availability list stays the honest
  // language statement.
  for (const label of Object.values(labels)) {
    if (typeof label === 'string' && label.length > 0) return label;
  }
  return null;
}

function projectOffer(value: unknown, preference: readonly string[]): CatalogOfferFacts | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.offer_id !== 'string' || v.offer_id.length === 0) return null;
  const ref = v.ref as Record<string, unknown> | undefined;
  if (!ref || ref.kind !== 'guide' || typeof ref.route_id !== 'string' || ref.route_id.length === 0) {
    return null;
  }
  if (typeof v.editorial_order !== 'number' || !Number.isFinite(v.editorial_order)) return null;
  const localized = (v.localized ?? {}) as Record<string, unknown>;
  const availability = (v.availability ?? {}) as Record<string, unknown>;
  const textLocales = Array.isArray(availability.text_locales)
    ? availability.text_locales.filter((l): l is string => typeof l === 'string')
    : [];
  const audioLocales = Array.isArray(availability.audio_locales)
    ? availability.audio_locales.filter((l): l is string => typeof l === 'string')
    : [];
  let duration: CatalogOfferFacts['estimated_duration'] = null;
  const rawDuration = v.estimated_duration as Record<string, unknown> | undefined;
  if (
    rawDuration &&
    typeof rawDuration.min_minutes === 'number' &&
    typeof rawDuration.max_minutes === 'number' &&
    typeof rawDuration.basis === 'string'
  ) {
    duration = {
      min_minutes: rawDuration.min_minutes,
      max_minutes: rawDuration.max_minutes,
      basis: rawDuration.basis,
    };
  }
  // The access enum of 21 §3.2 is free | paid | mixed; anything else is
  // corrupt projection input — the offer is dropped rather than rendered
  // with a claimed tariff nothing published.
  if (v.access !== 'free' && v.access !== 'paid' && v.access !== 'mixed') return null;
  const access: 'free' | 'paid' | 'mixed' = v.access;
  return {
    offer_id: v.offer_id,
    route_id: ref.route_id,
    editorial_order: v.editorial_order,
    title: localizedLabel(localized.title, preference),
    summary: localizedLabel(localized.summary, preference),
    text_locales: textLocales,
    audio_locales: audioLocales,
    access,
    estimated_duration: duration,
  };
}

// The offer→card projection, shared by the city list (projectGuides) and the
// guide preview (loadPreview) — one mapping, two consumers
// (implementation-rules 3, 8).
function offerCard(
  offer: CatalogOfferFacts,
  version: string,
): CatalogGuideCard {
  return {
    routeId: offer.route_id,
    version,
    offerId: offer.offer_id,
    title: offer.title ?? offer.route_id,
    summary: offer.summary,
    textLocales: offer.text_locales,
    audioLocales: offer.audio_locales,
    localesKnown: true,
    access: offer.access,
    editorialOrder: offer.editorial_order,
    estimatedDuration: offer.estimated_duration,
  };
}

function routeOnlyCard(route: CatalogEnvelope['routes'][number]): CatalogGuideCard {
  return {
    routeId: route.route_id,
    version: route.version,
    offerId: null,
    title: route.route_id,
    summary: null,
    textLocales: route.locales,
    audioLocales: [],
    localesKnown: false,
    access: route.product_id ? 'paid' : 'free',
    editorialOrder: null,
    estimatedDuration: null,
  };
}

// Offers first (editorial_order, then offer_id for stability — 21 §4), then
// the routes no offer backs, deterministically by route_id (the canon orders
// offers only; the route-only tail needs a stable order and takes the
// identifier).
export function projectGuides(
  envelope: CatalogEnvelope,
  offers: readonly CatalogOfferFacts[],
): CatalogGuideCard[] {
  const routeIds = new Set(envelope.routes.map((route) => route.route_id));
  const publishedOffers = offers
    .filter((offer) => routeIds.has(offer.route_id))
    .sort((a, b) =>
      a.editorial_order !== b.editorial_order
        ? a.editorial_order - b.editorial_order
        : a.offer_id < b.offer_id
          ? -1
          : 1,
    )
    .map<CatalogGuideCard>((offer) =>
      offerCard(offer, envelope.routes.find((route) => route.route_id === offer.route_id)?.version ?? ''),
    );
  const offeredRouteIds = new Set(publishedOffers.map((card) => card.routeId));
  const routeOnly = envelope.routes
    .filter((route) => !offeredRouteIds.has(route.route_id))
    .map(routeOnlyCard)
    .sort((a, b) => (a.routeId < b.routeId ? -1 : 1));
  return [...publishedOffers, ...routeOnly];
}

async function loadIndex(
  deps: CatalogDeps,
  options: CatalogDisplayOptions,
  envelope: CatalogEnvelope,
): Promise<CatalogOfferFacts[] | null> {
  const pointer = envelope.discovery_index;
  if (!pointer) return null;
  // 21 §3.3: paths, ids and URLs are untrusted input even from the CDN —
  // the pointer's path is checked against the shared safe-rel idiom before
  // any fetch (no traversal, no absolute, no NUL).
  if (!isSafeRel(pointer.path)) return null;
  let text: string;
  try {
    text = await deps.loader(pointer.path);
  } catch {
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const index = doc as Record<string, unknown>;
  // Integrity pin (21 §3.3): the fetched bytes must match the pointer's
  // declared sha256 and size; a mismatch opens the previous valid cache, it
  // never renders substitute content.
  const bytes = new TextEncoder().encode(text);
  const digest = await deps.sha256(bytes);
  if (digest !== pointer.sha256 || bytes.byteLength !== pointer.bytes) return null;
  if (!Array.isArray(index.offers)) return null;
  const offers: CatalogOfferFacts[] = [];
  for (const raw of index.offers) {
    const projected = projectOffer(raw, options.localePreference);
    if (projected !== null) offers.push(projected);
  }
  return offers;
}

// The shared envelope read of both service methods: fetch the catalog, parse
// it, run the reader projection and reject the invalid status. The callers
// map the failure to their own previous-result policy (09 §4: a failure is
// fatal only with no previous result).
type EnvelopeRead = { ok: true; envelope: CatalogEnvelope } | { ok: false; reason: string };

async function readEnvelope(deps: CatalogDeps): Promise<EnvelopeRead> {
  let text: string;
  try {
    text = await deps.loader(CATALOG_PATH);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  let envelope: CatalogEnvelope;
  try {
    envelope = readCatalogEnvelope(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'catalog-json-corrupt' };
  }
  if (envelope.status === 'invalid') return { ok: false, reason: 'catalog-invalid' };
  return { ok: true, envelope };
}

export async function loadCatalog(
  deps: CatalogDeps,
  options: CatalogDisplayOptions,
  previous: readonly CatalogGuideCard[] | null,
): Promise<CatalogLoadState> {
  const read = await readEnvelope(deps);
  if (!read.ok) {
    return previous && previous.length > 0
      ? { kind: 'offline', guides: previous, reason: read.reason }
      : { kind: 'error', reason: read.reason };
  }
  let offers: CatalogOfferFacts[] | null = null;
  try {
    offers = await loadIndex(deps, options, read.envelope);
  } catch {
    offers = null;
  }
  const guides = projectGuides(read.envelope, offers ?? []);
  if (offers === null && read.envelope.discovery_index !== null) {
    return { kind: 'ready', guides, degraded: 'index-unavailable' };
  }
  return { kind: 'ready', guides, degraded: null };
}

// The route document's projected facts: the typed route-level fields plus the
// ordered stop rows. Only the public projection is built — the document's
// stop entries carry the public `preview` fields by schema (route.schema.json,
// stop.schema.json), and any identity fault drops the row rather than
// rendering a fabricated one (implementation-rules 14: diagnostics, never a
// crash or an invention).
interface RouteDocFacts {
  routeAccess: 'free_base' | 'paid' | null;
  durationMin: number | null;
  freeStopCount: number | null;
  stops: PreviewStop[] | null;
  degraded: string | null;
}

const ROUTE_DOC_UNAVAILABLE: RouteDocFacts = {
  routeAccess: null,
  durationMin: null,
  freeStopCount: null,
  stops: null,
  degraded: 'route-doc-unavailable',
};

// An unknown route `access` fails closed: every stop renders locked until the
// document says otherwise — the preview never grants content by a fault.
function isRouteAccess(value: unknown): value is 'free_base' | 'paid' {
  return value === 'free_base' || value === 'paid';
}

function projectStops(
  value: readonly unknown[],
  routeAccess: 'free_base' | 'paid' | null,
  preference: readonly string[],
): PreviewStop[] {
  const stops: PreviewStop[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const v = raw as Record<string, unknown>;
    if (typeof v.id !== 'string' || v.id.length === 0) continue;
    if (typeof v.position !== 'number' || !Number.isInteger(v.position)) continue;
    if (typeof v.place_id !== 'string' || v.place_id.length === 0) continue;
    if (v.access_tier !== 'base' && v.access_tier !== 'extended') continue;
    const preview =
      v.preview && typeof v.preview === 'object' && !Array.isArray(v.preview)
        ? (v.preview as Record<string, unknown>)
        : null;
    stops.push({
      stopId: v.id,
      position: v.position,
      placeId: v.place_id,
      tier: v.access_tier,
      locked: routeAccess === 'paid' || v.access_tier === 'extended',
      name: localizedLabel(preview?.name ?? null, preference),
      announce: localizedLabel(preview?.announce ?? null, preference),
      optional: v.optional === true,
    });
  }
  // `position` is the recommended showing order (09 §3) — the preview renders
  // the published order; the sort is defensive, never a re-numbering.
  return stops.sort((a, b) => a.position - b.position);
}

async function loadRouteDoc(
  deps: CatalogDeps,
  routeId: string,
  version: string,
  preference: readonly string[],
): Promise<RouteDocFacts> {
  // The build-bundle public layout: bundle/<route_id>/<version>/route.json.
  // Catalog-sourced identifiers are untrusted input even from the CDN
  // (21 §3.3) — the composed path is checked against the shared safe-rel
  // idiom before any fetch.
  const rel = `bundle/${routeId}/${version}/route.json`;
  if (!isSafeRel(rel)) return ROUTE_DOC_UNAVAILABLE;
  let text: string;
  try {
    text = await deps.loader(rel);
  } catch {
    return ROUTE_DOC_UNAVAILABLE;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ...ROUTE_DOC_UNAVAILABLE, degraded: 'route-doc-corrupt' };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ...ROUTE_DOC_UNAVAILABLE, degraded: 'route-doc-corrupt' };
  }
  const v = doc as Record<string, unknown>;
  // A foreign document (another route's or another version's) is not this
  // guide's preview — fail closed to the degraded state, never render it.
  if (v.route_id !== routeId || v.version !== version) {
    return { ...ROUTE_DOC_UNAVAILABLE, degraded: 'route-doc-corrupt' };
  }
  const routeAccess = isRouteAccess(v.access) ? v.access : null;
  const durationMin =
    typeof v.duration_min === 'number' && Number.isInteger(v.duration_min) &&
    v.duration_min >= 1 && v.duration_min <= 1440
      ? v.duration_min
      : null;
  const freeStopCount =
    typeof v.free_stop_count === 'number' && Number.isInteger(v.free_stop_count) &&
    v.free_stop_count >= 0
      ? v.free_stop_count
      : null;
  const stops = Array.isArray(v.stops) ? projectStops(v.stops, routeAccess, preference) : null;
  // A stops array whose every row failed the identity checks is corruption,
  // not an empty route — «Кропкі: 0» would be a fabricated fact (11 §16.1:
  // nothing invented). The honest zero is a published empty array: it stays
  // an empty list and the count of zero is then true.
  const allRowsDropped =
    Array.isArray(v.stops) && v.stops.length > 0 && stops !== null && stops.length === 0;
  return {
    routeAccess,
    durationMin,
    freeStopCount,
    stops: allRowsDropped ? null : stops,
    degraded: stops === null || allRowsDropped ? 'route-doc-corrupt' : null,
  };
}

export async function loadPreview(
  deps: CatalogDeps,
  options: CatalogDisplayOptions,
  routeId: string,
  previous: GuidePreview | null,
): Promise<PreviewLoadState> {
  const read = await readEnvelope(deps);
  if (!read.ok) {
    return previous
      ? { kind: 'ready', preview: previous, degraded: read.reason }
      : { kind: 'error', reason: read.reason };
  }
  const entry = read.envelope.routes.find((route) => route.route_id === routeId);
  // The envelope read fine and names no such route — the honest unavailable
  // state, never a fabricated preview (11 §16.1: no invented cards).
  if (!entry) return { kind: 'not-published' };
  let offers: CatalogOfferFacts[] | null = null;
  try {
    offers = await loadIndex(deps, options, read.envelope);
  } catch {
    offers = null;
  }
  const offer = offers?.find((candidate) => candidate.route_id === routeId) ?? null;
  const card = offer
    ? offerCard(offer, entry.version)
    : routeOnlyCard(entry);
  const doc = await loadRouteDoc(deps, routeId, entry.version, options.localePreference);
  const indexDegraded = offers === null && read.envelope.discovery_index !== null;
  const degraded = [doc.degraded, indexDegraded ? 'index-unavailable' : null].find(
    (reason): reason is string => reason !== null,
  ) ?? null;
  return {
    kind: 'ready',
    preview: {
      routeId: card.routeId,
      version: entry.version,
      title: card.title,
      summary: card.summary,
      textLocales: card.textLocales,
      audioLocales: card.audioLocales,
      localesKnown: card.localesKnown,
      access: card.access,
      routeAccess: doc.routeAccess,
      estimatedDuration: card.estimatedDuration,
      durationMin: doc.durationMin,
      freeStopCount: doc.freeStopCount,
      baseSizeBytes:
        typeof entry.sizes?.base === 'number' && Number.isFinite(entry.sizes.base)
          ? entry.sizes.base
          : null,
      stops: doc.stops,
      degradedRouteDoc: doc.degraded,
    },
    degraded,
  };
}

// The composition root constructs the service over its ports (the loader
// bound to the configured public origin, the digest) and hands it to the
// catalog controller; nothing else value-imports this module.
export function createCatalogService(
  deps: CatalogDeps,
  options: CatalogDisplayOptions,
): CatalogService {
  return {
    load: (previous) => loadCatalog(deps, options, previous),
    loadPreview: (routeId, previous) => loadPreview(deps, options, routeId, previous),
  };
}
