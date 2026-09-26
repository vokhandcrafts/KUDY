// G08.02 — POST /v1/grant (docs/architecture/09 §5 «Мяжа /grant»): device
// bearer auth via the G08.01 device-core, the product → route/tier mapping
// from `grant_products`, RevenueCat entitlement verification of the needed
// environment, exact-manifest path gating, the bounded positive cache, and
// short-lived signed URLs. The contract logic lives in ../_shared/grant-core.ts
// (proven against PGlite by grant-core.test.ts); this file is the Deno wiring
// only — it is exercised on the Supabase runtime at deploy time and marked
// not-run in docs/agent-tasks/results/G08.02.md (G08.01 precedent).
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
//   GRANT_URL_TTL_SECONDS / GRANT_ENTITLEMENT_CACHE_TTL_SECONDS — optional
//     overrides of the grant-core defaults (600s / 86400s)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — Storage signed-URL minting
//   GRANT_STORAGE_BUCKET — the private bucket holding the published
//     manifests and the extended files; the client never names the bucket
import postgres from 'npm:postgres@3.4.9';

import { bearerSecretHash, DEVICE_LOOKUP_SQL } from '../_shared/device-core.ts';
import {
  createSqlEntitlementCache,
  createSqlProductLookup,
  grantRouteKey,
  GRANT_CACHE_CAP_SQL,
  GRANT_CACHE_READ_SQL,
  GRANT_CACHE_SWEEP_EXPIRED_SQL,
  GRANT_CACHE_TTL_SECONDS,
  GRANT_CACHE_WRITE_SQL,
  GRANT_MAX_BODY_BYTES,
  GRANT_PRODUCT_LOOKUP_SQL,
  GRANT_RETRY_AFTER_SECONDS,
  GRANT_URL_TTL_SECONDS,
  handleGrant,
  type GrantAnswer,
  type GrantConfig,
  type GrantPortDeps,
  type GrantSqlRunner,
} from '../_shared/grant-core.ts';
import { database } from '../_shared/postgres-connection.ts';

const REVENUECAT_DEFAULT_BASE = 'https://api.revenuecat.com';
const RC_TIMEOUT_MS = 5000;

interface StorageConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
}

function errors(status: number, code: string, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  // `{ error: { code } }` — the closed-list wire shape the client's
  // responseCode reads (19 §3.6; the spike's fail() agrees).
  return new Response(JSON.stringify({ error: { code } }), { status, headers });
}

// RevenueCat REST adapter — the spike's provider port
// (spikes/G00.03-sandbox-grant/server/provider.mjs). UNVERIFIED OFFLINE, as
// the spike left it: the request shape follows the documented REST contract
// and must be confirmed against the live API in G00.03.c/G08.03. The secret
// travels only in the Authorization header and is never logged.
function createRevenueCatProvider(secretApiKey: string, baseUrl: string): GrantPortDeps['provider'] {
  return {
    async verifyEntitlement({ deviceId, productId }) {
      let response: Response;
      try {
        response = await fetch(
          `${baseUrl.replace(/\/$/, '')}/v1/subscribers/${encodeURIComponent(deviceId)}`,
          {
            headers: { Authorization: `Bearer ${secretApiKey}`, Accept: 'application/json' },
            // A stalled provider call must abort into the fail-closed path
            // instead of holding the grant request open (spike idiom).
            signal: AbortSignal.timeout(RC_TIMEOUT_MS),
          },
        );
      } catch {
        return { ok: false, reason: 'network_error' };
      }
      if (response.status === 401) return { ok: false, reason: 'server_credential_rejected' };
      if (response.status === 404) {
        // ASSUMED to mean subscriber-not-found → "didn't buy" (spike caveat:
        // a transient proxy 404 must not be read as no_entitlement — confirm live).
        return { ok: true, entitled: false, environment: null };
      }
      if (!response.ok) return { ok: false, reason: `http_${response.status}` };
      let subscriber: { subscriber?: { entitlements?: Record<string, { product_identifier?: string }> } };
      try {
        subscriber = await response.json();
      } catch {
        return { ok: false, reason: 'bad_payload' };
      }
      // RevenueCat's documented v1 entitlement payload carries the store
      // product under `product_identifier` (not `product_id`).
      const entitled = Object.values(subscriber?.subscriber?.entitlements ?? {})
        .some((entitlement) => entitlement?.product_identifier === productId);
      if (!entitled) return { ok: true, entitled: false, environment: null };
      // Sandbox/production attribution is not part of this endpoint's
      // documented payload; an entitled answer that cannot be attributed to
      // an environment fails closed (503) instead of guessing (spike, 09 §5).
      return { ok: false, reason: 'environment_undeterminable' };
    },
  };
}

// The object layout is server-owned — <route_id>/<version>/<locale>/<tier>/
// <path> inside GRANT_STORAGE_BUCKET — and the client only ever receives
// signed URLs (09 §5.1: short TTL, minted in portions; a Supabase signed URL
// cannot be revoked early, so the TTL is not a revocation mechanism).
async function signObject(storage: StorageConfig, objectPath: string, ttlSeconds: number, nowMs: number) {
  const key = objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${storage.supabaseUrl}/storage/v1/object/sign/${storage.bucket}/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storage.serviceRoleKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: ttlSeconds }),
  });
  if (!response.ok) throw new Error('storage_sign_failed');
  const doc = await response.json() as { signedURL?: string };
  if (typeof doc.signedURL !== 'string' || doc.signedURL === '') throw new Error('storage_sign_failed');
  return { url: `${storage.supabaseUrl}/storage/v1${doc.signedURL}`, expiresAtMs: nowMs + ttlSeconds * 1000 };
}

// The published manifest of the exact route × version × locale × tier, read
// with the service role from the private bucket. An absent or malformed
// manifest is `null` — the core answers 403 manifest_not_found.
async function loadManifestDoc(storage: StorageConfig, routeId: string, version: string, locale: string, tier: string) {
  const key = [routeId, version, locale, tier, 'manifest.json'].map(encodeURIComponent).join('/');
  const response = await fetch(`${storage.supabaseUrl}/storage/v1/object/${storage.bucket}/${key}`, {
    headers: { Authorization: `Bearer ${storage.serviceRoleKey}` },
  });
  if (!response.ok) return null;
  const doc = await response.json() as { paths?: unknown; lock_url?: unknown };
  if (!Array.isArray(doc.paths) || !doc.paths.every((path) => typeof path === 'string')) return null;
  if (typeof doc.lock_url !== 'string' || doc.lock_url === '') return null;
  return { paths: doc.paths as string[], lockUrl: doc.lock_url };
}

function serialize(answer: GrantAnswer): Response {
  if (answer.status === 200) {
    return new Response(JSON.stringify(answer.body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const headers = answer.status === 503 ? { 'retry-after': String(answer.retryAfterSeconds) } : {};
  return errors(answer.status, answer.code, headers);
}

// One request's port set. The manifest base captured during load feeds the
// signer — the core always loads the manifest before minting, so the base is
// the loaded layer's; per-request ports keep requests from sharing it.
function requestDeps(db: postgres.Sql, storage: StorageConfig, config: GrantConfig): GrantPortDeps {
  // Each statement is one of the pinned constants exported by grant-core,
  // executed with its parameters built in place — the client-controlled
  // mapping key only ever appears as the inline sha256 digest
  // (grantRouteKey), the same accepted shape as the device function's
  // db.unsafe calls (no HTTP value enters SQL un-hashed).
  const runner: GrantSqlRunner = {
    async findProduct(routeId, tier) {
      return db.unsafe(GRANT_PRODUCT_LOOKUP_SQL, [grantRouteKey(routeId, tier)]) as Promise<Array<Record<string, unknown>>>;
    },
    async readCache(deviceId, routeId, tier) {
      return db.unsafe(GRANT_CACHE_READ_SQL, [deviceId, grantRouteKey(routeId, tier)]) as Promise<Array<Record<string, unknown>>>;
    },
    async writeCache(input) {
      await db.unsafe(
        GRANT_CACHE_WRITE_SQL,
        [input.deviceId, input.environment, input.expiresAtMs, grantRouteKey(input.routeId, input.tier)],
      );
    },
    async sweepExpiredCache(deviceId, nowMs) {
      await db.unsafe(GRANT_CACHE_SWEEP_EXPIRED_SQL, [deviceId, nowMs]);
    },
    async capCache(deviceId, cap) {
      await db.unsafe(GRANT_CACHE_CAP_SQL, [deviceId, cap]);
    },
  };
  let manifestBase = '';
  return {
    now: Date.now,
    products: createSqlProductLookup(runner),
    manifests: {
      async load(routeId, version, locale, tier) {
        const doc = await loadManifestDoc(storage, routeId, version, locale, tier);
        if (doc !== null) manifestBase = `${routeId}/${version}/${locale}/${tier}`;
        return doc;
      },
    },
    provider: createRevenueCatProvider(config.revenueCatSecret, config.revenueCatBase),
    signer: {
      mint(input) {
        return signObject(storage, `${manifestBase}/${input.path}`, input.ttlSeconds, input.nowMs);
      },
    },
    cache: createSqlEntitlementCache(runner),
  };
}

export async function handleGrantRequest(req: Request, db: postgres.Sql, config: ResolvedConfig): Promise<Response> {
  if (req.method !== 'POST') {
    return errors(404, 'not_found');
  }
  // The G08.01 module stays the single auth path: the header parse runs
  // through device-core (bearerSecretHash/verifyBearer share it), the indexed
  // SQL lookup resolves the hash against `devices`.
  const secretHash = bearerSecretHash(req.headers.get('authorization'));
  if (secretHash === null) {
    return errors(403, 'device_auth_failed');
  }
  const rows = await db.unsafe(DEVICE_LOOKUP_SQL, [secretHash]) as Array<Record<string, unknown>>;
  const candidate = rows[0]?.['device_id'];
  const deviceId = typeof candidate === 'string' ? candidate : null;
  if (deviceId === null) {
    return errors(403, 'device_auth_failed');
  }

  // The 64 KiB contract limit is measured in bytes, not UTF-16 code units
  // (the review round 1 note): the raw body is bounded before decoding.
  const raw = await req.arrayBuffer();
  if (raw.byteLength > GRANT_MAX_BODY_BYTES) {
    return errors(400, 'invalid_request');
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return errors(400, 'invalid_request');
  }

  const storage: StorageConfig = {
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    bucket: config.bucket,
  };
  const answer = await handleGrant(
    body,
    deviceId,
    {
      environment: config.environment,
      urlTtlSeconds: config.urlTtlSeconds,
      cacheTtlSeconds: config.cacheTtlSeconds,
    },
    requestDeps(db, storage, config),
  );
  return serialize(answer);
}

interface ResolvedConfig extends GrantConfig {
  revenueCatSecret: string;
  revenueCatBase: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  urlTtlSeconds: number;
  cacheTtlSeconds: number;
}

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

function resolveConfig(): ResolvedConfig {
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
    urlTtlSeconds: optionalSecondsEnv('GRANT_URL_TTL_SECONDS', GRANT_URL_TTL_SECONDS),
    cacheTtlSeconds: optionalSecondsEnv('GRANT_ENTITLEMENT_CACHE_TTL_SECONDS', GRANT_CACHE_TTL_SECONDS),
  };
}

Deno.serve(async (req) => {
  try {
    const config = resolveConfig();
    return await handleGrantRequest(req, database(), config);
  } catch (error) {
    // The client gets the closed-list 503; the operator gets the reason in
    // stderr — URLs are redacted because connection strings can carry
    // secrets (issue #311).
    console.error(
      'grant: internal fault → 503 entitlement_unavailable:',
      error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '<redacted-url>') : 'unknown',
    );
    // Every fault of this function — a misconfigured environment included —
    // stays inside the documented closed list: the client retries it like any
    // other provider outage (spike idiom; 19 §3.6 forbids codes outside it).
    return errors(503, 'entitlement_unavailable', { 'retry-after': String(GRANT_RETRY_AFTER_SECONDS) });
  }
});
