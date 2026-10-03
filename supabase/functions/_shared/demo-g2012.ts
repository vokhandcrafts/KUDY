// G20.12 — deterministic demo of the webhook payload minimization and the
// retention sweep over `webhook_events` (issue #483, spec N6 of the
// architecture-hardening set). PGlite with the committed migrations and the
// production ports; the signature is minted for a fixed clock with a fixture
// secret, so every printed line is stable. The subscriber personal fields
// (email/ip/country) are synthetic fixtures and never leave the script.
import { createHmac, randomUUID } from 'node:crypto';

import { handleWebhook } from './rc-webhook-core.ts';
import { runRetentionSweep, webhookRetentionCutoffMs } from './retention-core.ts';
import { freshMigratedDatabase, pgliteWebhookRunner } from './test-db.ts';

const SECRET = 'demo-g2012-secret';
const NOW_MS = 1_759_276_800_000; // 2026-10-01T00:00:00Z

const db = await freshMigratedDatabase();
const store = pgliteWebhookRunner(db);
const sweepRunner = { query: (sql: string, params?: unknown[]) => db.query(sql, params) };
const count = async (sql: string) => {
  const result = await db.query(sql);
  return (result.rows as Array<{ count: number }>)[0]!.count;
};

const device = randomUUID();
await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [device]);
await db.query(
  "insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) values ($1, 'demo-route', 'extended', jsonb_build_object('environment', 'sandbox'), now() + make_interval(hours => 24))",
  [device],
);

// Part 1 — the durable payload keeps the accounting fields only: the device
// identity and the synthetic subscriber personal data drive the delivery
// (the cache drop below) and never reach the stored row.
const event = {
  id: 'demo-g2012-event',
  type: 'CANCELLATION',
  event_timestamp_ms: NOW_MS - 1000,
  app_user_id: device,
  aliases: [randomUUID(), '$RCAnonymousID:not-a-device'],
  product_id: 'kudy.route.ext',
  environment: 'SANDBOX',
  store: 'APP_STORE',
  cancel_reason: 'CUSTOMER_SUPPORT',
  expiration_at_ms: NOW_MS + 24 * 60 * 60 * 1000,
  email: 'subscriber@example.com',
  ip: '203.0.113.9',
  country: 'PL',
};
const body = new TextEncoder().encode(JSON.stringify({ event }));
const seconds = Math.floor(NOW_MS / 1000);
const signature = `t=${seconds},v1=${createHmac('sha256', SECRET).update(`${seconds}.`).update(body).digest('hex')}`;
const request = { signatureHeader: signature, rawBody: body, secret: SECRET, nowMs: NOW_MS };

console.log('answer:', JSON.stringify(await handleWebhook(request, { store })));
console.log('cache rows after the refund effect:', await count('select count(*)::int as count from entitlement_cache'));
const stored = (await db.query('select payload from webhook_events')).rows[0] as { payload: Record<string, unknown> };
console.log('stored payload:', JSON.stringify(stored.payload));

// Part 2 — the protective sweep purges the aged row; the replay of the same
// delivery re-persists it and can only drop cache rows again: rights data
// and the device account never come back.
await db.query('update webhook_events set received_at = to_timestamp($1 / 1000.0)', [webhookRetentionCutoffMs(NOW_MS) - 1]);
console.log('sweep:', JSON.stringify(await runRetentionSweep(sweepRunner, NOW_MS)));
console.log('replay:', JSON.stringify(await handleWebhook(request, { store })));
console.log('after replay — events:', await count('select count(*)::int as count from webhook_events'), '/ cache rows:', await count('select count(*)::int as count from entitlement_cache'), '/ devices:', await count('select count(*)::int as count from devices'));
