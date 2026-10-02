// G20.01 — the production POST /v1/device handler, moved out of the Deno
// entrypoint so the node suites can drive it end-to-end (spec N1: «Прыёмка
// праходзіць сапраўдныя апрацоўшчыкі і асінхронныя SQL-парты»). The rate
// counter is awaited before the limit comparison — the old wiring read
// `db.unsafe(...)` as already-resolved rows and crashed (audit A26-01,
// [key: async-sql-result-not-awaited]). Internal failure paths answer the
// existing closed codes and emit exactly one redacted server diagnostic.
//
// `db` is the narrow postgres.js surface this handler uses: `unsafe()` answers
// a thenable array-like, which the structural type below captures (the real
// `postgres.Sql` satisfies it). The rate-increment adapter returns the raw
// `attempts` cell — validation is checkRateLimit's single shared decision,
// not a second per-endpoint algorithm.
import { logServerDiagnostic } from './server-diagnostics.ts';
import {
  checkRateLimit,
  DEVICE_INSERT_SQL,
  DEVICE_RATE_LIMIT,
  hashIp,
  RATE_INCREMENT_SQL,
  registerDevice,
  type RateDecision,
} from './device-core.ts';

export interface RequestLike {
  method: string;
  headers: { get(name: string): string | null };
}

/** The `unsafe` statement surface of the pinned postgres.js driver. */
export interface DeviceSqlClient {
  unsafe(sql: string, params: readonly unknown[]): PromiseLike<ArrayLike<unknown>>;
}

export function deviceErrorResponse(status: number, code: string, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

export const deviceClientIp = (req: RequestLike): string => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    // Rightmost address is the one our own edge appended; the leftmost is
    // client-controlled (standard proxy_add_x_forwarded_for behavior), so
    // trusting it would let a rotating header bypass the rate limit.
    const parts = forwarded.split(',').map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  // Fail closed: without an address every such client shares one bucket.
  return 'unknown';
};

export async function handleDeviceRequest(req: RequestLike, db: DeviceSqlClient): Promise<Response> {
  if (req.method !== 'POST') {
    return deviceErrorResponse(404, 'not_found');
  }
  const ipHash = hashIp(deviceClientIp(req));
  let rate: RateDecision;
  try {
    rate = await checkRateLimit(
      {
        increment: async (hash, windowStartMs) => {
          const rows = await db.unsafe(RATE_INCREMENT_SQL, [hash, windowStartMs]);
          const row = rows[0] as Record<string, unknown> | undefined;
          // Returned raw: checkRateLimit owns the counter validation, so a
          // missing or malformed cell fails closed instead of counting as 0.
          return row?.['attempts'] as number;
        },
      },
      ipHash,
      Date.now(),
      DEVICE_RATE_LIMIT,
    );
  } catch {
    logServerDiagnostic('device_registration', 'rate_increment_failed');
    return deviceErrorResponse(500, 'server_error');
  }
  if (!rate.allowed) {
    return deviceErrorResponse(429, 'rate_limited', { 'retry-after': String(rate.retryAfterSeconds) });
  }

  const registration = registerDevice();
  try {
    await db.unsafe(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
  } catch {
    logServerDiagnostic('device_registration', 'device_insert_failed');
    return deviceErrorResponse(500, 'server_error');
  }

  return new Response(JSON.stringify({ device_id: registration.deviceId, device_secret: registration.deviceSecret }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}
