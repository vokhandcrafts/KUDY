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
  const secretHash = bearerSecretHash(header);
  if (secretHash === null) {
    return { ok: false, reason: 'malformed_header' };
  }
  const deviceId = lookup(secretHash);
  if (deviceId === null) return { ok: false, reason: 'unknown_device' };
  return { ok: true, deviceId };
}

/**
 * The secret hash carried by a well-formed bearer header, or null — the
 * parse pre-image of `verifyBearer`. An async-lookup wrapper (the indexed
 * SQL `devices` query cannot run inside `verifyBearer`'s synchronous
 * lookup) extracts the hash with this and answers `device_auth_failed` on
 * no row; the header spelling rules live here only.
 */
export function bearerSecretHash(header: string | null | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return hashSecret(header.slice('Bearer '.length));
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
  /**
   * Atomically bumps the window counter and returns the new count. The
   * production increment is the SQL `returning` value, so this may be a
   * promise — `checkRateLimit` awaits it before the comparison (spec N1).
   */
  increment(ipHash: string, windowStartMs: number): number | Promise<number>;
}

export interface RateDecision {
  allowed: boolean;
  attempts: number;
  /** Seconds until the current window ends (for `Retry-After`). */
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  storage: RateStorage,
  ipHash: string,
  nowMs: number,
  limit = DEVICE_RATE_LIMIT,
  windowMs = DEVICE_RATE_WINDOW_MS,
): Promise<RateDecision> {
  const windowStart = rateWindowStart(nowMs, windowMs);
  // Spec N1: the counter from the database is checked as a correct value
  // before the limit comparison. A missing or malformed reply (and any
  // storage fault thrown by the increment) rejects here instead of surfacing
  // as a limit denial or a silent allow — the wiring maps the rejection to
  // its closed internal-failure answer.
  const attempts = await storage.increment(ipHash, windowStart);
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
    throw new Error('rate counter: the storage did not return a valid attempt count');
  }
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

export type DeviceAuthFailure = { status: 403; code: 'device_auth_failed' };

/**
 * The single bearer-auth preamble for the server handlers that speak the
 * device identity (the events intake and the device-delete handler): a
 * well-formed bearer whose hash matches a live `devices` row passes, every
 * other shape answers the same 403 device_auth_failed. G08.01 owns the
 * identity — no handler builds a second one.
 */
export async function authenticateBearerDevice(
  authorization: string | null | undefined,
  lookupDeviceId: (secretHash: string) => Promise<string | null>,
): Promise<{ deviceId: string } | { answer: DeviceAuthFailure }> {
  const secretHash = bearerSecretHash(authorization);
  if (secretHash === null) {
    return { answer: { status: 403, code: 'device_auth_failed' } };
  }
  const deviceId = await lookupDeviceId(secretHash);
  if (deviceId === null) {
    return { answer: { status: 403, code: 'device_auth_failed' } };
  }
  return { deviceId };
}

/**
 * Device deletion (`09` §5 DELETE /v1/device, G09.03): removing the devices
 * row is the whole server-side action — the FK cascades committed by the
 * migrations clear `event_log` (20260922120000), `entitlement_cache`
 * (20260922120000) and `event_send_rate` (20261001000000). Content rights
 * live in the stores and RevenueCat (`09` §5: «правы на кантэнт не
 * выдаляюцца»), so nothing else is touched here.
 */
export const DEVICE_DELETE_SQL =
  'delete from devices where device_id = $1';

export type DeviceDeleteAnswer =
  | { status: 204 }
  | { status: 403; code: 'device_auth_failed' }
  | { status: 404; code: 'not_found' };

export interface DeviceDeletePort {
  lookupDeviceId(secretHash: string): Promise<string | null>;
  deleteDeviceRow(deviceId: string): Promise<void>;
}

/**
 * The `DELETE /v1/device` half of the device function, structured like
 * `handleEventsRequest`: closed answer list, the single G08.01 auth path.
 * Idempotency answer: a repeated DELETE with the same secret finds no row
 * and answers `device_auth_failed` (403) — there is no separate
 * "already deleted" success code, because the row cannot come back (the
 * registration path is the only writer) and the client's wipe flow treats
 * the 403 as completion (services/device.ts). A port fault is deliberately
 * not caught: it is a server fault, and mapping it to a closed-list answer
 * is the wiring's job (the events-core idiom).
 */
export async function handleDeviceDeleteRequest(
  req: { method: string; authorization: string | null | undefined },
  port: DeviceDeletePort,
): Promise<DeviceDeleteAnswer> {
  if (req.method !== 'DELETE') {
    return { status: 404, code: 'not_found' };
  }
  const auth = await authenticateBearerDevice(req.authorization, (hash) => port.lookupDeviceId(hash));
  if ('answer' in auth) return auth.answer;
  await port.deleteDeviceRow(auth.deviceId);
  return { status: 204 };
}

export interface DeviceSqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Production port over Postgres — the pinned statements, nothing else. */
export function createSqlDeviceDeletePort(db: DeviceSqlRunner): DeviceDeletePort {
  return {
    async lookupDeviceId(secretHash) {
      const { rows } = await db.query(DEVICE_LOOKUP_SQL, [secretHash]);
      const candidate = rows[0]?.['device_id'];
      return typeof candidate === 'string' ? candidate : null;
    },
    async deleteDeviceRow(deviceId) {
      await db.query(DEVICE_DELETE_SQL, [deviceId]);
    },
  };
}
