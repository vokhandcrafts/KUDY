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
  const seenRoutes = new Set<string>();
  const publishedOffers = offers
    .filter((offer) => routeIds.has(offer.route_id))
    .sort((a, b) =>
      a.editorial_order !== b.editorial_order
        ? a.editorial_order - b.editorial_order
        : a.offer_id < b.offer_id
          ? -1
          : 1,
    )
    // A malformed publication may pin several offers to one route (issue
    // #324): each guide renders exactly once (21 §4) — the sorted-first
    // offer wins, the duplicates are dropped, not echoed.
    .filter((offer) => {
      if (seenRoutes.has(offer.route_id)) return false;
      seenRoutes.add(offer.route_id);
      return true;
    })
    .map<CatalogGuideCard>((offer) => ({
      routeId: offer.route_id,
      version: envelope.routes.find((route) => route.route_id === offer.route_id)?.version ?? '',
      offerId: offer.offer_id,
      title: offer.title ?? offer.route_id,
      summary: offer.summary,
      textLocales: offer.text_locales,
      audioLocales: offer.audio_locales,
      localesKnown: true,
      access: offer.access,
      editorialOrder: offer.editorial_order,
      estimatedDuration: offer.estimated_duration,
    }));
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

export async function loadCatalog(
  deps: CatalogDeps,
  options: CatalogDisplayOptions,
  previous: readonly CatalogGuideCard[] | null,
): Promise<CatalogLoadState> {
  let text: string;
  try {
    text = await deps.loader(CATALOG_PATH);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return previous && previous.length > 0
      ? { kind: 'offline', guides: previous, reason }
      : { kind: 'error', reason };
  }
  let envelope: CatalogEnvelope;
  try {
    envelope = readCatalogEnvelope(JSON.parse(text));
  } catch {
    const reason = 'catalog-json-corrupt';
    return previous && previous.length > 0
      ? { kind: 'offline', guides: previous, reason }
      : { kind: 'error', reason };
  }
  if (envelope.status === 'invalid') {
    const reason = 'catalog-invalid';
    return previous && previous.length > 0
      ? { kind: 'offline', guides: previous, reason }
      : { kind: 'error', reason };
  }
  let offers: CatalogOfferFacts[] | null = null;
  try {
    offers = await loadIndex(deps, options, envelope);
  } catch {
    offers = null;
  }
  const guides = projectGuides(envelope, offers ?? []);
  if (offers === null && envelope.discovery_index !== null) {
    return { kind: 'ready', guides, degraded: 'index-unavailable' };
  }
  return { kind: 'ready', guides, degraded: null };
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
  };
}
