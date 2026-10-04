// G08.02 — POST /v1/grant (docs/architecture/09 §5 «Мяжа /grant»): the Deno
// wiring for the grant edge function. The production handler — device bearer
// auth via the G08.01 device-core, the product → route/tier mapping from
// `grant_products`, RevenueCat entitlement verification of the needed
// environment, exact-manifest path gating, the bounded positive cache and
// short-lived signed URLs — lives in ../_shared/grant-wire.ts (contract
// logic in ../_shared/grant-core.ts, proven against PGlite by
// grant-core.test.ts and driven end-to-end by grant-wire.test.ts, G20.25);
// this file is the Supabase-runtime wiring only.
//
// Path mapping: the canonical `POST /v1/grant` is served by this function at
// `https://<project-ref>.supabase.co/functions/v1/grant`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role
//   GRANT_ENVIRONMENT — `sandbox` | `production`; a sandbox entitlement never
//     opens production files (09 §5, ADR G00.03 §3)
//   REVENUECAT_SECRET_API_KEY — Secret API key; never client-side, never logged
//   REVENUECAT_BASE_URL — optional https override (spike canonical name)
//   GRANT_URL_TTL_SECONDS — optional override of the 600 s default; any
//     out-of-policy value (N5: zero, negative, fractional, non-finite,
//     malformed, above the cap) fails closed — the function never mints
//   GRANT_ENTITLEMENT_CACHE_TTL_SECONDS — optional override of the 86400s
//     cache default; a distinct policy, not the URL TTL
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — Storage signed-URL minting
//   GRANT_STORAGE_BUCKET — the private bucket holding the published
//     manifests and the extended files; the client never names the bucket
//
// N8 rate gate: no environment knob — the per-device window/limit constants
// live in grant-core (one owner, the device/events idiom); the counter table
// is grant_request_rate (migration 20261002000000) and a limiter fault lands
// on the closed 503 below, never on an open gate.
import {
  GRANT_CACHE_TTL_SECONDS,
  GRANT_URL_TTL_SECONDS,
  isUnsafeUrlTtl,
  type GrantConfig,
} from '../_shared/grant-core.ts';
import { serveGrantRequest, type GrantRuntimeConfig } from '../_shared/grant-wire.ts';
import { database } from '../_shared/postgres-connection.ts';

const REVENUECAT_DEFAULT_BASE = 'https://api.revenuecat.com';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} is required (fail-closed env gate, ADR G00.03 §2.1 idiom)`);
  }
  return value;
}

function optionalSecondsEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// N5: the URL TTL is fail-closed at the configuration boundary — an absent
// setting uses the 600 s default, and any present but out-of-policy value
// (zero, negative, fractional, non-finite, malformed, above the cap) stops
// the function before it can mint, instead of silently falling back. The
// cache TTL above keeps its own lenient policy.
function requireCanonicalUrlTtlEnv(name: string): number {
  const raw = Deno.env.get(name);
  if (typeof raw !== 'string' || raw.trim() === '') return GRANT_URL_TTL_SECONDS;
  const parsed = Number(raw);
  if (isUnsafeUrlTtl(parsed)) {
    throw new Error(`${name} must be a positive integer of at most ${GRANT_URL_TTL_SECONDS} seconds (N5)`);
  }
  return parsed;
}

function resolveConfig(): GrantRuntimeConfig {
  const environment = requireEnv('GRANT_ENVIRONMENT');
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('GRANT_ENVIRONMENT must be sandbox or production');
  }
  const revenueCatBase = Deno.env.get('REVENUECAT_BASE_URL') ?? REVENUECAT_DEFAULT_BASE;
  // The Secret API key travels in the Authorization header: a cleartext base
  // would ship it in the open — the spike's https guard (review round 1).
  if (!/^https:\/\//.test(revenueCatBase)) {
    throw new Error('REVENUECAT_BASE_URL must use https');
  }
  return {
    environment,
    revenueCatSecret: requireEnv('REVENUECAT_SECRET_API_KEY'),
    revenueCatBase,
    supabaseUrl: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: requireEnv('GRANT_STORAGE_BUCKET'),
    urlTtlSeconds: requireCanonicalUrlTtlEnv('GRANT_URL_TTL_SECONDS'),
    cacheTtlSeconds: optionalSecondsEnv('GRANT_ENTITLEMENT_CACHE_TTL_SECONDS', GRANT_CACHE_TTL_SECONDS),
  };
}

// The connection and the configuration are opened inside the wire's fault
// boundary, so their fail-closed gates answer the same closed 503 as any
// handler fault (the documented retry path, 19 §3.6).
Deno.serve((req) => serveGrantRequest(req, database, resolveConfig));
