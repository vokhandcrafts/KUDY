// G08.06 — deterministic demo of the optional /v1/rc-webhook accounting
// (issue #293). The gate matrix runs against real Postgres (PGlite) with the
// committed migrations applied and the production SQL ports; the signatures
// are minted for a fixed clock with a fixture secret, so every printed line
// is stable. Device identifiers are seeded at runtime and never printed.
import { createHmac, randomUUID } from 'node:crypto';

import { handleWebhook, type WebhookSqlRunner } from './rc-webhook-core.ts';
import { freshMigratedDatabase, pgliteWebhookRunner } from './test-db.ts';

const SECRET = 'demo-fixture-secret';
const NOW_MS = 1_700_000_000_000;

const db = await freshMigratedDatabase();
try {
  const store = pgliteWebhookRunner(db);

  const deviceA = randomUUID();
  const deviceB = randomUUID();
  await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [deviceA]);
  await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [deviceB]);
  const cacheRow = 'insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) values ($1, \'demo-route\', \'extended\', jsonb_build_object(\'environment\', \'sandbox\'), now() + make_interval(hours => 24))';
  await db.query(cacheRow, [deviceA]);
  await db.query(cacheRow, [deviceB]);

  const sign = (body: string) => {
    const hex = createHmac('sha256', SECRET).update(`${Math.floor(NOW_MS / 1000)}.`).update(new TextEncoder().encode(body)).digest('hex');
    return `t=${Math.floor(NOW_MS / 1000)},v1=${hex}`;
  };
  const requestOf = (event: Record<string, unknown>) => {
    const body = JSON.stringify({ event });
    return { signatureHeader: sign(body), rawBody: new TextEncoder().encode(body), secret: SECRET, nowMs: NOW_MS };
  };
  const cacheRows = async () => {
    const result = await db.query('select count(*)::int as count from entitlement_cache');
    return (result.rows as Array<{ count: number }>)[0]!.count;
  };
  const eventRows = async () => {
    const result = await db.query('select count(*)::int as count from webhook_events');
    return (result.rows as Array<{ count: number }>)[0]!.count;
  };
  let invalidations = 0;
  const countingStore: WebhookSqlRunner = {
    ...store,
    async invalidateEntitlementCache(deviceId) {
      invalidations += 1;
      return store.invalidateEntitlementCache(deviceId);
    },
  };

  // 1. A tampered signature → 401; the rights rows are untouched.
  const refund = {
    id: randomUUID(),
    type: 'CANCELLATION',
    event_timestamp_ms: 1_699_999_000_000,
    app_user_id: deviceA,
    aliases: ['$RCAnonymousID:demo'],
    cancel_reason: 'CUSTOMER_SUPPORT',
    environment: 'SANDBOX',
  };
  const forged = { ...requestOf(refund), signatureHeader: `t=${Math.floor(NOW_MS / 1000)},v1=${'0'.repeat(64)}` };
  console.log('forged signature →', JSON.stringify(await handleWebhook(forged, { store: countingStore })), '/ cache rows', await cacheRows());

  // 2. The valid refund → 200 after the durable persist; the device's cached
  //    rights are dropped, so the next /grant re-verifies with RevenueCat.
  console.log('refund →', JSON.stringify(await handleWebhook(requestOf(refund), { store: countingStore })), '/ cache rows', await cacheRows(), '/ events', await eventRows());

  // 3. The duplicate delivery → 200 once more, but the effect ran exactly once.
  const after = invalidations;
  console.log('duplicate →', JSON.stringify(await handleWebhook(requestOf(refund), { store: countingStore })), '/ invalidations', after, '→', invalidations, '/ events', await eventRows());

  // 4. TRANSFER: the losing device re-verifies; the receiving one keeps its row.
  const transfer = {
    id: randomUUID(),
    type: 'TRANSFER',
    event_timestamp_ms: 1_699_999_500_000,
    app_user_id: deviceB,
    transferred_from: [deviceA],
    transferred_to: [deviceB],
  };
  console.log('transfer →', JSON.stringify(await handleWebhook(requestOf(transfer), { store: countingStore })));

  // 5. A corrupt record → 400, nothing persisted, no crash.
  const broken = 'not-json';
  console.log('corrupt →', JSON.stringify(await handleWebhook({ signatureHeader: sign(broken), rawBody: new TextEncoder().encode(broken), secret: SECRET, nowMs: NOW_MS }, { store: countingStore })), '/ events', await eventRows());

  // 6. Bookkeeping (TEST) → durably stored, rights untouched.
  const testEvent = { id: randomUUID(), type: 'TEST', event_timestamp_ms: 1_699_999_900_000 };
  console.log('test →', JSON.stringify(await handleWebhook(requestOf(testEvent), { store: countingStore })), '/ cache rows', await cacheRows(), '/ events', await eventRows());
} finally {
  await db.close();
}
