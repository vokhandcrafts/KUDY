// Shared contract fixtures for the reader tests on both sides — TR-3/TR-5 of
// docs/architecture/23_technical_remarks.md: the SAME documents feed
// services/contentRepo and the web reader, so a contract drift on either side
// fails on the same input. Field names and enum domains are copied verbatim
// from contracts/schemas/route.schema.json, catalog.schema.json and
// stop.schema.json; the full samples carry every schema property so the
// key-parity tests pin the restatements.

export function routeDoc(access: 'free_base' | 'paid' = 'free_base'): {
  origin: 'official' | 'imported';
  route_id: string;
  version: string;
  city_id: string;
  access: 'free_base' | 'paid';
  product_id_route: string;
  product_id_extension: string;
  distance_m: number;
  duration_min: number;
  cover: string;
  polyline: string;
  published: boolean;
  free_stop_count: number;
  stops: Array<{
    id: string;
    position: number;
    place_id: string;
    access_tier: 'base' | 'extended';
    story_base_id?: string;
    story_extended_id?: string;
  }>;
} {
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

export function catalogEntry(): {
  route_id: string;
  version: string;
  locales: Array<'be' | 'en' | 'uk'>;
  layers: Array<'base' | 'extended'>;
  product_id: string;
  sizes: { base: number; extended: number };
} {
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
