// G08.06 — POST /v1/rc-webhook (docs/architecture/09 §5, §5.1): the optional
// RevenueCat accounting webhook — HMAC verification over the raw body, the
// durable event bookkeeping (`webhook_events`), and the rights effects
// (refund/expiration/TRANSFER drop the device's positive entitlement_cache
// rows). The contract logic lives in ../_shared/rc-webhook-core.ts (proven
// against PGlite by rc-webhook-core.test.ts); this file is the Deno wiring
// only — it is exercised on the Supabase runtime at deploy time and marked
// not-run in docs/agent-tasks/results/G08.06.md (G08.01/G08.02 precedent).
//
// Path mapping: the canonical `POST /v1/rc-webhook` is served by this
// function at `https://<project-ref>.supabase.co/functions/v1/rc-webhook`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role
//   RC_WEBHOOK_SECRET — the RevenueCat webhook signing secret; 09 §5.1:
//     «без наладжанага сакрэту endpoint не разгортваецца» — a missing secret
//     fails the boot, it never serves unsigned bodies. The integration
//     switch is RevenueCat-side: without it no deliveries arrive and grant /
//     restore are unaffected (the webhook is not on the grant path).
import postgres from 'npm:postgres@3.4.9';

import {
  handleWebhook,
  WEBHOOK_CACHE_INVALIDATE_SQL,
  WEBHOOK_EVENT_EFFECTS_READ_SQL,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_MARK_APPLIED_SQL,
  type WebhookAnswer,
  type WebhookPortDeps,
  type WebhookSqlRunner,
} from '../_shared/rc-webhook-core.ts';
import { database } from '../_shared/postgres-connection.ts';

interface ResolvedConfig {
  webhookSecret: string;
}

function requestDeps(db: postgres.Sql): WebhookPortDeps {
  // Each statement is one of the pinned constants exported by
  // rc-webhook-core, executed with its parameters built in place — the same
  // accepted shape as the grant/device functions' db.unsafe calls. The only
  // client-side value that reaches SQL as a device identity is the
  // uuid-shaped id filtered by affectedDeviceIds (WEBHOOK_CACHE_INVALIDATE_SQL
  // casts it again at the driver boundary).
  const runner: WebhookSqlRunner = {
    async persistEvent(input) {
      const rows = await db.unsafe(
        WEBHOOK_EVENT_INSERT_SQL,
        [input.eventId, input.type, input.eventTimestampMs, JSON.stringify(input.payload)],
      ) as Array<Record<string, unknown>>;
      return rows.length > 0;
    },
    async readEffectsApplied(eventId) {
      const rows = await db.unsafe(WEBHOOK_EVENT_EFFECTS_READ_SQL, [eventId]) as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return null;
      return row['effects_applied'] === true;
    },
    async markEffectsApplied(eventId) {
      await db.unsafe(WEBHOOK_EVENT_MARK_APPLIED_SQL, [eventId]);
    },
    async invalidateEntitlementCache(deviceId) {
      await db.unsafe(WEBHOOK_CACHE_INVALIDATE_SQL, [deviceId]);
    },
  };
  return { store: runner };
}

function serialize(answer: WebhookAnswer): Response {
  // Empty bodies: RevenueCat reads only the status; no wire codes are
  // invented beyond the 401 the contract names (rc-webhook-core.ts).
  if (answer.status === 200) {
    return new Response(null, { status: 200 });
  }
  return new Response(null, { status: answer.status });
}

export async function handleWebhookRequest(req: Request, db: postgres.Sql, config: ResolvedConfig): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(null, { status: 404 });
  }
  const raw = await req.arrayBuffer();
  const answer = await handleWebhook(
    {
      signatureHeader: req.headers.get('x-revenuecat-webhook-signature'),
      rawBody: new Uint8Array(raw),
      secret: config.webhookSecret,
      nowMs: Date.now(),
    },
    requestDeps(db),
  );
  return serialize(answer);
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} is required (fail-closed env gate, ADR G00.03 §2.1 idiom)`);
  }
  return value;
}

function resolveConfig(): ResolvedConfig {
  return { webhookSecret: requireEnv('RC_WEBHOOK_SECRET') };
}

Deno.serve(async (req) => {
  try {
    return await handleWebhookRequest(req, database(), resolveConfig());
  } catch (error) {
    // Any fault (store included) answers 503 so RevenueCat retries the
    // at-least-once delivery — a 200 never goes out before the durable
    // persist. The operator gets the reason in stderr; URLs are redacted
    // because connection strings can carry secrets (issue #311 idiom).
    console.error(
      'rc-webhook: internal fault → 503:',
      error instanceof Error
        ? error.message.replace(/(?:https?|postgres(?:ql)?):\/\/\S+/g, '<redacted-url>')
        : 'unknown',
    );
    return new Response(null, { status: 503 });
  }
});
