// G06.01.a (issue #313) — the catalog envelope reading for the device path.
//
// The single interpretation source for the envelope is contracts/reader.mjs
// (09 §4: "Фармат — публічны кантракт"); it is Node-stdlib only (node:fs for
// schema files) and cannot join the RN bundle. This module projects only the
// G01.06 reader DECISION — the status routing and the pointer size check —
// with no deep validation: publication owns the schema verdict, and the test
// suite pins this projection to reader.mjs's verdicts on the committed
// fixtures (catalogService.test.ts "envelope parity"), so a drift fails CI.
import type { CatalogRouteEntry } from './types.ts';

// 21 §3.2: the index file is ≤ 512 KiB, checked before loading — the same
// limit reader.mjs carries as DISCOVERY_INDEX_BYTES (parity-locked).
const DISCOVERY_INDEX_BYTES = 524288;

export interface CatalogPointer {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CatalogEnvelope {
  // reader.mjs readCatalogDoc statuses, same meaning: v1 (use it),
  // legacy-v0 (a bare routes array), unknown-major (routes only, the
  // discovery pointer is not interpreted), invalid (nothing is used).
  readonly status: 'v1' | 'legacy-v0' | 'unknown-major' | 'invalid';
  readonly routes: readonly CatalogRouteEntry[];
  readonly discovery_index: CatalogPointer | null;
  readonly degraded: string | null;
  readonly malformedRoutes: number;
}

function projectRoute(value: unknown): CatalogRouteEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.route_id !== 'string' || v.route_id.length === 0) return null;
  if (typeof v.version !== 'string' || v.version.length === 0) return null;
  return {
    route_id: v.route_id,
    version: v.version,
    locales: Array.isArray(v.locales) ? v.locales.filter((l): l is string => typeof l === 'string') : [],
    layers: Array.isArray(v.layers) ? v.layers.filter((l): l is string => typeof l === 'string') : [],
    ...(typeof v.product_id === 'string' ? { product_id: v.product_id } : {}),
    ...(v.sizes && typeof v.sizes === 'object' && !Array.isArray(v.sizes)
      ? { sizes: v.sizes as Readonly<Record<string, number>> }
      : {}),
  };
}

function projectRoutes(value: unknown): { routes: CatalogRouteEntry[]; malformed: number } {
  if (!Array.isArray(value)) return { routes: [], malformed: 0 };
  const routes: CatalogRouteEntry[] = [];
  let malformed = 0;
  for (const entry of value) {
    const projected = projectRoute(entry);
    if (projected === null) malformed += 1;
    else routes.push(projected);
  }
  return { routes, malformed };
}

function projectPointer(value: unknown): CatalogPointer | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.path !== 'string' || v.path.length === 0) return null;
  if (typeof v.bytes !== 'number' || !Number.isFinite(v.bytes)) return null;
  if (typeof v.sha256 !== 'string' || v.sha256.length === 0) return null;
  // 21 §3.3: the declared size is checked before loading; over the limit the
  // pointer is not fetched at all (the oversized fixture's verdict).
  if (v.bytes > DISCOVERY_INDEX_BYTES) return null;
  return { path: v.path, bytes: v.bytes, sha256: v.sha256 };
}

export function readCatalogEnvelope(doc: unknown): CatalogEnvelope {
  if (Array.isArray(doc)) {
    const { routes, malformed } = projectRoutes(doc);
    return { status: 'legacy-v0', routes, discovery_index: null, degraded: 'legacy-v0', malformedRoutes: malformed };
  }
  if (!doc || typeof doc !== 'object') {
    return { status: 'invalid', routes: [], discovery_index: null, degraded: null, malformedRoutes: 0 };
  }
  const record = doc as Record<string, unknown>;
  if (record.catalog_schema_version !== 1) {
    const { routes, malformed } = projectRoutes(record.routes);
    return {
      status: 'unknown-major',
      routes,
      discovery_index: null,
      degraded: 'catalog-schema-version',
      malformedRoutes: malformed,
    };
  }
  const { routes, malformed } = projectRoutes(record.routes);
  return {
    status: 'v1',
    routes,
    discovery_index: projectPointer(record.discovery_index),
    degraded: null,
    malformedRoutes: malformed,
  };
}
