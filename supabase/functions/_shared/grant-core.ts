// G08.02 — the /v1/grant core (docs/architecture/09 §5 «Мяжа /grant», §5.1
// corrected flow; ADR G00.03-payment-evidence §3; behavior reference:
// spikes/G00.03-sandbox-grant/server/grant-server.mjs). The server maps
// route_id × tier → product itself, verifies the entitlement of the needed
// environment by asking RevenueCat, opens only the published manifest of the
// exact route_id × version × locale × tier, and mints short-lived signed URLs
// for exactly the requested paths.
//
// Platform-neutral by contract (the G08.01 device-core idiom): no Deno or
// Node HTTP APIs here — SQL storage, manifest source, entitlement provider,
// URL signer and clock enter as ports below. The SQL statements are pinned
// constants proven against real Postgres (PGlite) by grant-core.test.ts; the
// Deno wiring is supabase/functions/grant/index.ts (not-run until deploy,
// Deno wiring is supabase/functions/grant/index.ts (not-run until deploy,
// G08.01 precedent).

import { createHash } from 'node:crypto';

export type GrantEnvironment = 'sandbox' | 'production';

// 09 §5: «Ліміты памеру спіса і запыту задаюцца кантрактам» — the contract
// reference (spike grant-server.mjs) pins 20 paths per request and a 64 KiB
// body; the client already batches to that size (services/download/grant.ts
// cites the same reference). The URL TTL (600s) and the positive-cache TTL
// (24h) are the ADR G00.03 §3 defaults. GRANT_CACHE_MAX_ROWS_PER_DEVICE is a
// defensive implementation choice (the G08.01 DEVICE_RATE_LIMIT idiom): the
// cache bound lives in exactly one place.
export const GRANT_MAX_PATHS = 20;
export const GRANT_MAX_PATH_LENGTH = 256;
export const GRANT_MAX_BODY_BYTES = 64 * 1024;
export const GRANT_URL_TTL_SECONDS = 600;
export const GRANT_CACHE_TTL_SECONDS = 86_400;
export const GRANT_RETRY_AFTER_SECONDS = 30;
export const GRANT_CACHE_MAX_ROWS_PER_DEVICE = 32;

// A requested path must be a plain relative member of the manifest: no
// absolute form, no traversal, no drive/scheme prefix, no empty segments.
// Refused before any catalog or manifest lookup, so a malformed path can
// never probe the mapping or the storage layout (spike gate order).
export function isUnsafePath(candidate: string): boolean {
  if (candidate === '' || candidate.length > GRANT_MAX_PATH_LENGTH) return true;
  // Covers Windows drives (`C:`), URL schemes (`https:`), NUL, backslash,
  // absolute (`/x`), home (`~x`) and traversal/empty segments (`..`, `.`, `//`).
  return /[\0\\]|^[~/]|[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)
    || candidate.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

// The wire request of 09 §5 — snake_case, the same shape the client builds
// (services/download/grant.ts GrantRequestBody); the cross-check test in
// grant-core.test.ts keeps the two projections from drifting.
export interface GrantRequestBody {
  route_id: string;
  version: string;
  locale: string;
  tier: string;
  paths: string[];
}

// The answer of the closed list (`19` §3.6; client GRANT_ERRORS). This
// endpoint emits the grant-side subset — url_expired/url_invalid belong to
// the file source, not to /v1/grant — and the cross-check test proves the
// subset against the client's list. Errors carry `{ error: { code } }` on
// the wire (the spike and the client's responseCode agree).
export type GrantAnswer =
  | { status: 200; body: { lock_url: string; urls: Array<{ path: string; url: string; expires_at: number }> } }
  | { status: 400; code: 'invalid_request' }
  | {
      status: 403;
      code: 'device_auth_failed' | 'unknown_route_tier' | 'manifest_not_found' | 'path_not_allowed'
        | 'no_entitlement' | 'environment_mismatch';
    }
  | { status: 404; code: 'not_found' }
  | { status: 503; code: 'entitlement_unavailable'; retryAfterSeconds: number };

// Spike provider contract (spikes/G00.03-sandbox-grant/server/provider.mjs):
// the server asks the provider about the AUTHENTICATED device only
// (app_user_id = device_id; RevenueCat resolves aliases and transfers itself).
// Any unavailable answer must fail closed (503), never grant.
export type EntitlementVerdict =
  | { ok: true; entitled: boolean; environment: GrantEnvironment | null }
  | { ok: false; reason: string };

// Positive-only cache over the `entitlement_cache` table (09 §5.1: refusals
// are never cached); the payload carries the environment that produced the
// row, so a cache written under one environment never grants under another.
export interface EntitlementCachePort {
  read(deviceId: string, routeId: string, tier: string): Promise<{ environment: string; expiresAtMs: number } | null>;
  /** `nowMs` drives the expiry sweep — the sweep must never use the new row's own expiry as its threshold. */
  write(deviceId: string, routeId: string, tier: string, environment: string, expiresAtMs: number, nowMs: number): Promise<void>;
}

export interface GrantConfig {
  environment: GrantEnvironment;
  urlTtlSeconds?: number;
  cacheTtlSeconds?: number;
  retryAfterSeconds?: number;
  maxPaths?: number;
}

// All server-side concerns are ports: product mapping (SQL `grant_products`),
// the published-manifest source (private storage), the RevenueCat provider,
// the signed-URL minter and the clock. No default transport anywhere — the
// core cannot reach the network or the storage on its own.
export interface GrantPortDeps {
  now(): number;
  products: { find(routeId: string, tier: string): Promise<string | null> };
  manifests: {
    load(routeId: string, version: string, locale: string, tier: string): Promise<{ paths: string[]; lockUrl: string } | null>;
  };
  provider: { verifyEntitlement(input: { deviceId: string; productId: string }): Promise<EntitlementVerdict> };
  /** Async by contract: the production signer (Storage signed URLs) is a network call. */
  signer: {
    mint(input: { path: string; deviceId: string; ttlSeconds: number; nowMs: number }): Promise<{ url: string; expiresAtMs: number }>;
  };
  cache: EntitlementCachePort;
}

// Mapping keys are catalog identifiers, not free text: bounded to a
// conservative charset and length at the boundary (lessons-learned §3 —
// input validated where it enters), so nothing but a catalog-shaped string
// can reach the product lookup, the storage layout or SQL parameters.
const GRANT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function parseGrantRequestBody(request: unknown, maxPaths: number): GrantRequestBody | null {
  if (typeof request !== 'object' || request === null) return null;
  const candidate = request as Record<string, unknown>;
  const routeId = candidate['route_id'];
  const version = candidate['version'];
  const locale = candidate['locale'];
  const tier = candidate['tier'];
  const paths = candidate['paths'];
  if (
    typeof routeId !== 'string' || typeof version !== 'string' || typeof locale !== 'string'
    || typeof tier !== 'string'
  ) return null;
  if (!GRANT_KEY_PATTERN.test(routeId) || !GRANT_KEY_PATTERN.test(version) || !GRANT_KEY_PATTERN.test(locale)
    || !GRANT_KEY_PATTERN.test(tier)) return null;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > maxPaths) return null;
  if (!paths.every((path) => typeof path === 'string')) return null;
  return { route_id: routeId, version, locale, tier, paths };
}

/**
 * One POST /v1/grant round for an already authenticated device (the wrapper
 * runs `verifyBearer` first — the G08.01 module stays the single auth path —
 * and answers `403 device_auth_failed` itself). The gate order is the spike's:
 * shape → unsafe paths → product mapping → manifest → membership →
 * entitlement → signed URLs, so a cheap client fault can never probe the
 * layers behind it.
 */
export async function handleGrant(
  request: unknown,
  deviceId: string,
  config: GrantConfig,
  deps: GrantPortDeps,
): Promise<GrantAnswer> {
  const maxPaths = config.maxPaths ?? GRANT_MAX_PATHS;
  const retryAfterSeconds = config.retryAfterSeconds ?? GRANT_RETRY_AFTER_SECONDS;
  const body = parseGrantRequestBody(request, maxPaths);
  if (body === null) return { status: 400, code: 'invalid_request' };
  if (body.paths.some(isUnsafePath)) return { status: 403, code: 'path_not_allowed' };

  // The client never chooses the store product or the storage bucket: the
  // server maps route_id × tier → product itself (09 §5 boundary).
  const productId = await deps.products.find(body.route_id, body.tier);
  if (productId === null) return { status: 403, code: 'unknown_route_tier' };

  const manifest = await deps.manifests.load(body.route_id, body.version, body.locale, body.tier);
  if (manifest === null) return { status: 403, code: 'manifest_not_found' };
  // Every requested path must be an exact member of this manifest — a safe
  // prefix is not enough (09 §5 «Мяжа /grant»).
  const members = new Set(manifest.paths);
  if (body.paths.some((path) => !members.has(path))) return { status: 403, code: 'path_not_allowed' };

  // Entitlement is verified by the server against the provider for the
  // authenticated device only; a client-side «bought» flag never substitutes
  // for this (09 §5.1). The positive cache never bypasses the environment
  // check and never outlives its TTL: an expired or foreign-environment row
  // falls through to a fresh provider verification.
  const nowMs = deps.now();
  const cached = await deps.cache.read(deviceId, body.route_id, body.tier);
  const cacheHit = cached !== null
    && cached.environment === config.environment
    && cached.expiresAtMs > nowMs;
  if (!cacheHit) {
    const verdict = await deps.provider.verifyEntitlement({ deviceId, productId });
    if (!verdict.ok) {
      return { status: 503, code: 'entitlement_unavailable', retryAfterSeconds };
    }
    if (!verdict.entitled) return { status: 403, code: 'no_entitlement' };
    if (verdict.environment !== config.environment) return { status: 403, code: 'environment_mismatch' };
    const cacheTtlSeconds = config.cacheTtlSeconds ?? GRANT_CACHE_TTL_SECONDS;
    if (cacheTtlSeconds > 0) {
      await deps.cache.write(deviceId, body.route_id, body.tier, config.environment, nowMs + cacheTtlSeconds * 1000, nowMs);
    }
  }

  const ttlSeconds = config.urlTtlSeconds ?? GRANT_URL_TTL_SECONDS;
  const urls: Array<{ path: string; url: string; expires_at: number }> = [];
  for (const path of body.paths) {
    const minted = await deps.signer.mint({ path, deviceId, ttlSeconds, nowMs });
    urls.push({ path, url: minted.url, expires_at: minted.expiresAtMs });
  }
  return {
    status: 200,
    body: { lock_url: manifest.lockUrl, urls },
  };
}

/**
 * The SHA-256 of (route_id, tier) — the only form of a client-controlled
 * mapping key that ever reaches SQL. The server-side `route_key` is a
 * generated column on `grant_products` (migration 20260926130000) computing
 * the identical digest, so lookups and cache rows join through values the
 * client never supplies: the HTTP body feeds only this hash (and the
 * charset-validated manifest tuple for storage fetches), never a SQL
 * parameter.
 */
export function grantRouteKey(routeId: string, tier: string): string {
  return createHash('sha256').update(`${routeId}|${tier}`, 'utf8').digest('hex');
}

// The SQL execution port, shaped per statement instead of a generic
// (sql, params) runner: the implementations (postgres.js in the Deno
// wrapper, PGlite in the tests) build each parameter list with the
// sha256-derived route key inline at the executing call — the exact shape
// the device function's accepted `db.unsafe(DEVICE_INSERT_SQL, […])` calls
// use, so no client-controlled value ever sits in a SQL argument un-hashed.
export interface GrantSqlRunner {
  findProduct(routeId: string, tier: string): Promise<Array<Record<string, unknown>>>;
  readCache(deviceId: string, routeId: string, tier: string): Promise<Array<Record<string, unknown>>>;
  writeCache(input: { deviceId: string; routeId: string; tier: string; environment: string; expiresAtMs: number }): Promise<unknown>;
  sweepExpiredCache(deviceId: string, nowMs: number): Promise<unknown>;
  capCache(deviceId: string, cap: number): Promise<unknown>;
}

/** Single-match product lookup by the generated `route_key` — at most one row per (route_id, tier) by unique index. */
export const GRANT_PRODUCT_LOOKUP_SQL
  = 'select product_id from grant_products where route_key = $1';

/** Fresh-or-expired row joined through the mapping table, so the client-controlled key enters only as its hash (`::float8`: extract() is numeric, which both drivers deliver as a string). */
export const GRANT_CACHE_READ_SQL
  = 'select (extract(epoch from c.expires_at) * 1000)::float8 as expires_at_ms, c.payload ->> \'environment\' as environment '
  + 'from entitlement_cache c join grant_products gp on gp.route_id = c.route_id and gp.tier = c.tier '
  + 'where c.device_id = $1::uuid and gp.route_key = $2';

/**
 * Upsert of the positive-only cache row (refusals never reach this
 * statement). The route_id/tier columns are pulled from `grant_products` by
 * the hash — the caller-supplied strings never enter the statement, so a row
 * deleted between the product lookup and the write simply inserts nothing
 * (fail closed: the next request re-verifies).
 */
export const GRANT_CACHE_WRITE_SQL
  = 'insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) '
  + 'select $1::uuid, gp.route_id, gp.tier, jsonb_build_object(\'environment\', $2::text), to_timestamp($3 / 1000.0) '
  + 'from grant_products gp where gp.route_key = $4 '
  + 'on conflict (device_id, route_id, tier) do update set payload = excluded.payload, expires_at = excluded.expires_at';

/** Drops the device's rows that are already expired at `now` — never keyed to the row just written. */
export const GRANT_CACHE_SWEEP_EXPIRED_SQL
  = 'delete from entitlement_cache where device_id = $1::uuid and expires_at <= to_timestamp($2 / 1000.0)';

/** Keeps only the freshest-expiry GRANT_CACHE_MAX_ROWS_PER_DEVICE rows of the device — the cache size bound. */
export const GRANT_CACHE_CAP_SQL
  = 'delete from entitlement_cache where device_id = $1::uuid and (route_id, tier) not in ('
  + 'select route_id, tier from entitlement_cache where device_id = $1::uuid '
  + 'order by expires_at desc, route_id, tier limit $2)';

export function createSqlProductLookup(runner: GrantSqlRunner): GrantPortDeps['products'] {
  return {
    async find(routeId: string, tier: string): Promise<string | null> {
      const rows = await runner.findProduct(routeId, tier);
      const productId = rows[0]?.['product_id'];
      return typeof productId === 'string' ? productId : null;
    },
  };
}

export function createSqlEntitlementCache(runner: GrantSqlRunner): EntitlementCachePort {
  return {
    async read(deviceId, routeId, tier) {
      const rows = await runner.readCache(deviceId, routeId, tier);
      const row = rows[0];
      if (!row) return null;
      const environment = row['environment'];
      const expiresAtMs = row['expires_at_ms'];
      if (typeof environment !== 'string' || typeof expiresAtMs !== 'number') return null;
      return { environment, expiresAtMs };
    },
    async write(deviceId, routeId, tier, environment, expiresAtMs, nowMs) {
      await runner.writeCache({ deviceId, routeId, tier, environment, expiresAtMs });
      // The cache stays bounded (criterion 4): expired rows are swept on
      // every write and a device never holds more than the cap.
      await runner.sweepExpiredCache(deviceId, nowMs);
      await runner.capCache(deviceId, GRANT_CACHE_MAX_ROWS_PER_DEVICE);
    },
  };
}
