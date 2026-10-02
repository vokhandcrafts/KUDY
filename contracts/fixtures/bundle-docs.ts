// Shared contract fixtures for the reader tests on both sides — TR-3/TR-5 of
// docs/architecture/23_technical_remarks.md: the SAME documents feed
// services/contentRepo and the web reader, so a contract drift on either side
// fails on the same input. The sample TYPES are not restated here:
// contracts/wire/wire-types.ts is the generated verbatim projection of
// contracts/schemas/ (G20.19, issue #490) and the imports below are the only
// declaration. The samples themselves still carry every schema property so
// the key-parity tests keep pinning the generated projection.
import type { CatalogRouteEntry, RouteDoc } from '../wire/wire-types.ts';

export function routeDoc(access: 'free_base' | 'paid' = 'free_base'): RouteDoc {
  return {
    origin: 'official',
    route_id: 'route-x',
    version: '1',
    city_id: 'city-x',
    access,
    product_id_route: 'com.kudy.route.x',
    product_id_extension: 'com.kudy.route.x.ext',
    distance_m: 1200,
    duration_min: 45,
    cover: 'cover/cover.jpg',
    polyline: 'aa bb cc dd',
    published: true,
    free_stop_count: 1,
    stops: [
      { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base', story_base_id: 'story-b' },
      { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'extended', story_extended_id: 'story-e' },
    ],
  };
}

// The pre-TR-3 spelling the readers used to accept — never in the schema
// (route.schema.json: access = free_base | paid).
export function routeDocWithLegacyAccess(): Omit<ReturnType<typeof routeDoc>, 'access'> & { access: 'free' } {
  return { ...routeDoc(), access: 'free' };
}

// Corrupt input from 09 §4 as text: JSON.parse succeeds, the document is null.
export const nullRouteText = 'null';

// Truncated JSON: JSON.parse must fail with the reader's invalid-json rule.
export const truncatedRouteText = '{"route_id":"route-x","version":"1"';

export function catalogEntry(): CatalogRouteEntry {
  return {
    route_id: 'route-x',
    version: '1',
    locales: ['be', 'en'],
    layers: ['base', 'extended'],
    product_id: 'com.kudy.route.x',
    sizes: { base: 1024, extended: 2048 },
  };
}

export function catalogEntryWithoutSizes(): Omit<ReturnType<typeof catalogEntry>, 'sizes'> {
  const { sizes, ...entry } = catalogEntry();
  return entry;
}

export function catalogEnvelope(routes: unknown[]): { catalog_schema_version: 1; routes: unknown[] } {
  return { catalog_schema_version: 1, routes };
}
