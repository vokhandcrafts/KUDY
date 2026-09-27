// G06.02 (issue #278) — the run map's package facts: the route's stops with
// their story identities and preview names (route.json) joined with the
// places' geometry and kind (places.json), read from one verified layer
// directory of the device bundles tree. The map screen consumes the join —
// the session's marker unit is the stop (ADR G01.01 §4.5), its position the
// stop's place (09 §3: Place carries lat/lng/trigger_radius_m, the stop only
// place_id), and the POI points are the places no route stop references
// (11 §6: two visually distinct marker kinds).
//
// Diagnostic vocabulary mirrors the sibling readers (access.ts
// access#route-json-*, contentRepo.ts route.json#identity-mismatch): an
// unreadable, invalid or foreign document is a named refusal, never a crash
// (implementation-rules 14). The read is all-or-nothing: a stop whose place
// carries no usable geometry would silently vanish from the map and from the
// geofence window, so a partial join refuses instead of rendering less.
import type { BundlesStore, PackageKey } from './types.ts';

// One route stop's map fact: the identity fields the engine's package stops
// carry (storyBaseId/storyExtendedId — ADR G01.01 §4.1), the place reference
// the geometry join follows, and the localized preview name the marker label
// and the accessibility label render. The canonical document names stay
// snake_case here; the controller maps them onto RunStop in one place (19 §3
// name boundary).
export interface RunStopFact {
  readonly stopId: string;
  readonly placeId: string;
  readonly storyBaseId?: string;
  readonly storyExtendedId?: string;
  readonly name: Readonly<Record<string, string>>;
}

// One place's map fact. kind is the free contract string (stop.schema.json /
// place.schema.json: maxLength 32) the POI marker labels.
export interface RunPlaceFact {
  readonly placeId: string;
  readonly lat: number;
  readonly lng: number;
  readonly radius: number;
  readonly kind: string;
}

export type RunMapFacts =
  | { ok: true; stops: ReadonlyArray<RunStopFact>; places: ReadonlyArray<RunPlaceFact> }
  | { ok: false; diagnostic: string };

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// The localized preview name, sanitized: only string values survive, so a
// corrupted entry degrades to a nameless marker instead of a crash.
function asName(value: unknown): Record<string, string> {
  const name: Record<string, string> = {};
  if (value === null || typeof value !== 'object') return name;
  for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === 'string' && text.length > 0) name[locale] = text;
  }
  return name;
}

function parseRouteDocument(bytes: Uint8Array, key: PackageKey): { ok: true; stops: RunStopFact[] } | { ok: false; diagnostic: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, diagnostic: 'run-map#route-json-invalid' };
  }
  const routeDoc = doc as { route_id?: unknown; version?: unknown; stops?: unknown } | null;
  if (routeDoc?.route_id !== key.routeId || routeDoc?.version !== key.version) {
    return { ok: false, diagnostic: 'run-map#route-json-identity' };
  }
  if (!Array.isArray(routeDoc.stops)) return { ok: false, diagnostic: 'run-map#route-json-invalid' };
  const stops: RunStopFact[] = [];
  for (const stop of routeDoc.stops) {
    if (stop === null || typeof stop !== 'object') continue;
    const record = stop as {
      id?: unknown;
      place_id?: unknown;
      story_base_id?: unknown;
      story_extended_id?: unknown;
      preview?: unknown;
    };
    if (typeof record.id !== 'string' || typeof record.place_id !== 'string') continue;
    stops.push({
      stopId: record.id,
      placeId: record.place_id,
      storyBaseId: typeof record.story_base_id === 'string' ? record.story_base_id : undefined,
      storyExtendedId: typeof record.story_extended_id === 'string' ? record.story_extended_id : undefined,
      name: asName((record.preview as { name?: unknown } | undefined)?.name),
    });
  }
  return { ok: true, stops };
}

function parsePlacesDocument(bytes: Uint8Array): { ok: true; places: RunPlaceFact[] } | { ok: false; diagnostic: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, diagnostic: 'run-map#places-json-invalid' };
  }
  if (!Array.isArray(doc)) return { ok: false, diagnostic: 'run-map#places-json-invalid' };
  const places: RunPlaceFact[] = [];
  for (const place of doc) {
    if (place === null || typeof place !== 'object') {
      return { ok: false, diagnostic: 'run-map#places-json-invalid' };
    }
    const record = place as { id?: unknown; lat?: unknown; lng?: unknown; trigger_radius_m?: unknown; kind?: unknown };
    if (
      typeof record.id !== 'string' ||
      !finiteNumber(record.lat) ||
      !finiteNumber(record.lng) ||
      !finiteNumber(record.trigger_radius_m) ||
      record.trigger_radius_m <= 0 ||
      typeof record.kind !== 'string'
    ) {
      return { ok: false, diagnostic: 'run-map#places-json-invalid' };
    }
    places.push({ placeId: record.id, lat: record.lat, lng: record.lng, radius: record.trigger_radius_m, kind: record.kind });
  }
  return { ok: true, places };
}

/**
 * Read the map facts of one verified layer directory. The layout follows the
 * device bundles tree (09 §7: bundles/<route_id>/<version>/<locale>/<tier>/
 * with the package documents inside — the layer is the lock-verified unit),
 * so the reader asks the same BundlesStore seam the inventory reads.
 */
export async function readRunMapFacts(
  store: BundlesStore,
  layerDir: string,
  key: PackageKey,
): Promise<RunMapFacts> {
  const routeFile = await store.readFile(`${layerDir}/route.json`);
  if (routeFile.kind === 'absent') return { ok: false, diagnostic: 'run-map#route-json-missing' };
  if (routeFile.kind === 'unreadable') return { ok: false, diagnostic: 'run-map#route-json-unreadable' };
  const route = parseRouteDocument(routeFile.bytes, key);
  if (!route.ok) return route;

  const placesFile = await store.readFile(`${layerDir}/places.json`);
  if (placesFile.kind === 'absent') return { ok: false, diagnostic: 'run-map#places-json-missing' };
  if (placesFile.kind === 'unreadable') return { ok: false, diagnostic: 'run-map#places-json-unreadable' };
  const places = parsePlacesDocument(placesFile.bytes);
  if (!places.ok) return places;

  // The join must be total: a stop whose place is absent from places.json
  // contradicts the package contract (contentRepo's places.json#unknown-ref)
  // and would silently vanish from the map and the geofence window — refuse
  // the whole read, not the stop.
  const byPlace = new Map(places.places.map((place) => [place.placeId, place]));
  for (const stop of route.stops) {
    if (!byPlace.has(stop.placeId)) {
      return { ok: false, diagnostic: `run-map#stop-unplaced:${stop.stopId}` };
    }
  }
  return { ok: true, stops: route.stops, places: places.places };
}
