// G08.01 — canonical device-registration core per docs/architecture/09 §5:
// the server generates `device_id` (UUID) and `device_secret` (32 bytes,
// returned exactly once), stores only the SHA-256 hash of the secret in
// `devices`, and every later call authenticates with
// `Authorization: Bearer <device_secret>` (ADR G00.03 §2.1). The same bearer
// path is the single auth module for every device-scoped endpoint, feedback
// included (`21` §2 — feedback functions import this module; no second
// identity system).
//
// Platform-neutral by contract: only `node:crypto` (native under both Deno
// and Node ≥ 22). Storage, clock and randomness injection points are named
// below — the Deno edge function injects the SQL storage, tests inject
// fakes or run the real statements against Postgres (PGlite).

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export interface DeviceRegistration {
  deviceId: string;
  /** Returned to the client exactly once; only `secretHash` is persisted. */
  deviceSecret: string;
  secretHash: string;
}

/** SHA-256 of the raw secret as lowercase hex — the only stored form (ADR G00.03 §2.1). */
export function hashSecret(deviceSecret: string): string {
  return createHash('sha256').update(deviceSecret, 'utf8').digest('hex');
}

/**
 * One device registration: fresh UUID + a 32-byte secret (base64url, the
 * G00.03 spike shape). A 32-byte random secret needs no salt (ADR G00.03
 * §2.1); the caller persists `secretHash` and must send `deviceSecret` to
 * the client once.
 */
export function registerDevice(): DeviceRegistration {
  const deviceSecret = randomBytes(32).toString('base64url');
  return {
    deviceId: randomUUID(),
    deviceSecret,
    secretHash: hashSecret(deviceSecret),
  };
}

export type BearerVerification =
  | { ok: true; deviceId: string }
  | { ok: false; reason: 'malformed_header' | 'unknown_device' };

/**
 * Verify an `Authorization: Bearer <device_secret>` header. `lookup` maps a
 * stored secret hash to its device id. The production lookup is
 * `DEVICE_LOOKUP_SQL` (equality on the indexed 256-bit hash — a timing
 * channel there is not measurable); scan-based lookups (in-memory tests,
 * demos) go through `createMemoryLookup`, which keeps the spike's
 * constant-time idiom (ADR G00.03 §2.1). The exact `Bearer ` scheme
 * spelling is required — lower-case or other schemes are malformed, per the
 * spike's negative cases.
 */
export function verifyBearer(
  header: string | null | undefined,
  lookup: (secretHash: string) => string | null,
): BearerVerification {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return { ok: false, reason: 'malformed_header' };
  }
  const deviceId = lookup(hashSecret(header.slice('Bearer '.length)));
  if (deviceId === null) return { ok: false, reason: 'unknown_device' };
  return { ok: true, deviceId };
}

/**
 * In-memory hash → device-id lookup with the spike's constant-time compare
 * (full scan, `timingSafeEqual`), for tests and local demos. Production
 * uses the indexed SQL lookup instead.
 */
export function createMemoryLookup(entries: Map<string, string>): (secretHash: string) => string | null {
  return (secretHash: string) => {
    const candidate = Buffer.from(secretHash, 'hex');
    for (const [hash, deviceId] of entries) {
      const known = Buffer.from(hash, 'hex');
      if (known.length === candidate.length && timingSafeEqual(known, candidate)) {
        return deviceId;
      }
    }
    return null;
  };
}

/**
 * Rate limiting per registration attempt (`09` §5: "няма, rate-limit па IP").
 * Fixed window; the raw IP is never stored — the caller passes only its
 * SHA-256 (`hashIp`). `20` per hour is a defensive implementation choice
 * (registration happens once per install; no canonical number exists in
 * `09`), documented in docs/agent-tasks/results/G08.01.md.
 */
export const DEVICE_RATE_WINDOW_MS = 60 * 60 * 1000;
export const DEVICE_RATE_LIMIT = 20;

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip, 'utf8').digest('hex');
}

export function rateWindowStart(nowMs: number, windowMs = DEVICE_RATE_WINDOW_MS): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

export interface RateStorage {
  /** Atomically bumps the window counter and returns the new count. */
  increment(ipHash: string, windowStartMs: number): number;
}

export interface RateDecision {
  allowed: boolean;
  attempts: number;
  /** Seconds until the current window ends (for `Retry-After`). */
  retryAfterSeconds: number;
}

export function checkRateLimit(
  storage: RateStorage,
  ipHash: string,
  nowMs: number,
  limit = DEVICE_RATE_LIMIT,
  windowMs = DEVICE_RATE_WINDOW_MS,
): RateDecision {
  const windowStart = rateWindowStart(nowMs, windowMs);
  const attempts = storage.increment(ipHash, windowStart);
  return {
    allowed: attempts <= limit,
    attempts,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000)),
  };
}

/** SQL for the per-window counter against `device_registration_rate` (19 §2.4 migrations); `$2` is the window start in epoch ms. */
export const RATE_INCREMENT_SQL =
  'insert into device_registration_rate (ip_hash, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 1) ' +
  'on conflict (ip_hash, window_start) do update set attempts = device_registration_rate.attempts + 1 ' +
  'returning attempts';

/** SQL inserting the freshly registered device — only the hash is stored. */
export const DEVICE_INSERT_SQL =
  'insert into devices (device_id, secret_hash) values ($1, $2)';

/** Lookup statement for `verifyBearer` — indexes by the stored hash. */
export const DEVICE_LOOKUP_SQL =
  'select device_id from devices where secret_hash = $1';
