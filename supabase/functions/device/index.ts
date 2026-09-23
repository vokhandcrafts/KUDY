// G08.01 — POST /v1/device (docs/architecture/09 §5): the server generates
// `device_id` (UUID) and `device_secret` (32 bytes, returned exactly once),
// stores only the SHA-256 hash in `devices`, and rate-limits registrations
// per IP. The contract logic lives in ../_shared/device-core.ts (proven by
// node --test and the PGlite RLS suite); this file is the Deno wiring only —
// it is exercised on the Supabase runtime at deploy time and marked not-run
// in docs/agent-tasks/results/G08.01.md (no Supabase project is attached to
// this repo yet).
//
// Path mapping: the canonical `POST /v1/device` is served by this function at
// `https://<project-ref>.supabase.co/functions/v1/device`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
// Non-POST requests and missing env never reach the database.
import postgres from 'npm:postgres@3.4.9';

import {
  checkRateLimit,
  DEVICE_INSERT_SQL,
  DEVICE_RATE_LIMIT,
  hashIp,
  RATE_INCREMENT_SQL,
  registerDevice,
} from '../_shared/device-core.ts';

interface RequestLike {
  method: string;
  headers: { get(name: string): string | null };
}

const errors = (status: number, code: string, extraHeaders: Record<string, string> = {}): Response => {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error: code }), { status, headers });
};

const clientIp = (req: RequestLike): string => {
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

export async function handleDeviceRequest(req: RequestLike, db: postgres.Sql): Promise<Response> {
  if (req.method !== 'POST') {
    return errors(404, 'not_found');
  }
  const ipHash = hashIp(clientIp(req));
  const rate = checkRateLimit(
    {
      increment: (hash, windowStartMs) => {
        const rows = db.unsafe(RATE_INCREMENT_SQL, [hash, windowStartMs]) as Array<{ attempts: number }>;
        return rows[0]!.attempts;
      },
    },
    ipHash,
    Date.now(),
    DEVICE_RATE_LIMIT,
  );
  if (!rate.allowed) {
    return errors(429, 'rate_limited', { 'retry-after': String(rate.retryAfterSeconds) });
  }

  const registration = registerDevice();
  try {
    await db.unsafe(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
  } catch {
    return errors(500, 'server_error');
  }

  return new Response(JSON.stringify({ device_id: registration.deviceId, device_secret: registration.deviceSecret }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

let sql: postgres.Sql | null = null;

function database(): postgres.Sql {
  if (sql === null) {
    const url = Deno.env.get('DATABASE_URL');
    if (typeof url !== 'string' || url === '') {
      throw new Error('DATABASE_URL is required (fail-closed env gate, ADR G00.03 §2.1 idiom)');
    }
    sql = postgres(url, { prepare: false, max: 1 });
  }
  return sql;
}

Deno.serve(async (req) => {
  try {
    return await handleDeviceRequest(req, database());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL')) {
      return errors(500, 'server_configuration_error');
    }
    return errors(500, 'server_error');
  }
});
