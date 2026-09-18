// Typed public-layer readers (pure, no React, no network at module scope).
// Every consumed JSON is validated against its contract source in
// contracts/schemas/ via the shared reader bridge; unknown schema_version and
// malformed input produce a defined safe rejection, never a partial render.
import {
  schemaCheck,
  indexRulesCheck,
  readCatalogEnvelope,
} from './contract.ts';
import type {
  CatalogRouteEntry,
  CatalogView,
  ContractError,
  DiscoveryIndex,
  Locale,
  LockedStopPreview,
  PublicProjection,
  ReadResult,
  RejectionCode,
  RouteDoc,
  Story,
} from './types.ts';

function reject(code: RejectionCode, errors: ContractError[]): ReadResult<never> {
  return { ok: false, code, errors };
}

// Catalog envelope per 09 §4 and the G01.06 decision; web policy renders the
// v1 envelope only (see contract.ts readCatalogEnvelope).
export function readCatalog(doc: unknown): ReadResult<CatalogView> {
  const res = readCatalogEnvelope(doc);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      routes: res.data.routes as CatalogRouteEntry[],
      discovery_index: (res.data.discovery_index as CatalogView['discovery_index']) ?? null,
    },
  };
}

// DiscoveryIndexV1 per 21 §3.2: schema first, then the named cross-record rules.
export function readDiscoveryIndex(doc: unknown): ReadResult<DiscoveryIndex> {
  const schemaErrors = schemaCheck('schemas/discovery-index.schema.json', doc);
  if (schemaErrors.length > 0) return reject('schema-invalid', schemaErrors);
  const rules = indexRulesCheck(doc);
  if (rules) return reject(rules.code, rules.errors);
  return { ok: true, data: doc as DiscoveryIndex };
}

// route.json of one bundle (route_id × version), route.schema.json.
export function readRoute(doc: unknown): ReadResult<RouteDoc> {
  const schemaErrors = schemaCheck('schemas/route.schema.json', doc);
  if (schemaErrors.length > 0) return reject('schema-invalid', schemaErrors);
  return { ok: true, data: doc as RouteDoc };
}

// Per-locale base stops.json: an array of Story entries — story.schema.json
// describes one entry, so the file is checked item by item. Web policy: the
// base layer must only ever carry base-tier stories (09 §2: the web gives the
// free base layer) — an extended entry is a misassembled input and is
// rejected whole.
export function readBaseStories(doc: unknown): ReadResult<Story[]> {
  if (!Array.isArray(doc)) {
    return reject('schema-invalid', [{ rule: 'stops-not-an-array', path: '$' }]);
  }
  const schemaErrors = doc.flatMap((entry, i) =>
    schemaCheck('schemas/story.schema.json', entry).map((e) => ({ ...e, path: `stops[${i}].${e.path}` })),
  );
  if (schemaErrors.length > 0) return reject('schema-invalid', schemaErrors);
  const stories = doc as Story[];
  const extended = stories.filter((s) => s.tier !== 'base');
  if (extended.length > 0) {
    return reject('non-base-story', extended.map((s) => ({ rule: 'non-base-story', path: s.story_id })));
  }
  return { ok: true, data: stories };
}

// previews.json — 09 §5: the closed field set stop_id/place_id/name/announce
// is the leak boundary for locked stops. No dedicated schema exists, so the
// shape is checked structurally and each field against its contract schema
// (identifier.schema.json, localized-text.schema.json).
const PREVIEW_KEYS = ['stop_id', 'place_id', 'name', 'announce'];

export function readPreviews(doc: unknown): ReadResult<LockedStopPreview[]> {
  if (!Array.isArray(doc)) {
    return reject('invalid-preview', [{ rule: 'previews-not-an-array', path: '$' }]);
  }
  const errors: { rule: string; path: string }[] = [];
  doc.forEach((entry, i) => {
    const at = `previews[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ rule: 'invalid-preview', path: at });
      return;
    }
    const keys = Object.keys(entry).sort();
    if (keys.join(',') !== [...PREVIEW_KEYS].sort().join(',')) {
      errors.push({ rule: 'invalid-preview-fields', path: at });
      return;
    }
    for (const idField of ['stop_id', 'place_id'] as const) {
      errors.push(...schemaCheck('schemas/identifier.schema.json', (entry as Record<string, unknown>)[idField]).map((e) => ({ ...e, path: `${at}.${idField}` })));
    }
    for (const textField of ['name', 'announce'] as const) {
      errors.push(...schemaCheck('schemas/localized-text.schema.json', (entry as Record<string, unknown>)[textField]).map((e) => ({ ...e, path: `${at}.${textField}` })));
    }
  });
  if (errors.length > 0) return reject('invalid-preview', errors);
  return { ok: true, data: doc as LockedStopPreview[] };
}

// public.json projections of places and collections, public-projection.schema.json.
export function readPublicProjection(doc: unknown): ReadResult<PublicProjection> {
  const schemaErrors = schemaCheck('schemas/public-projection.schema.json', doc);
  if (schemaErrors.length > 0) return reject('schema-invalid', schemaErrors);
  return { ok: true, data: doc as PublicProjection };
}

// Locales are known when localized-text.schema.json accepts a probe record —
// the allowlist (21 §3.2) stays owned by its contract schema, not by a second list.
export function isKnownLocale(candidate: string): candidate is Locale {
  return schemaCheck('schemas/localized-text.schema.json', { [candidate]: 'probe' }).length === 0;
}
