// G08.06 — behavioral proof of the optional /v1/rc-webhook core on a real
// Postgres (PGlite). Contract: docs/architecture/09 §5/§5.1 — HMAC over the
// raw body before parsing, constant-time compare, the 5-minute timestamp
// window, idempotency by the event id, 200 only after the durable persist,
// and the refund/expiration/TRANSFER effects on the rights bookkeeping.
// Reverting any of those rules fails the matching test here
// (implementation-rules 1): the tampered-signature test proves the rights
// rows unchanged, the duplicate test proves one effect per event id, and the
// fault tests prove the handler never answers 200 over a failed persist.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { freshMigratedDatabase, pgliteWebhookRunner } from './test-db.ts';
import {
  affectedDeviceIds,
  handleWebhook,
  parseWebhookEvent,
  WEBHOOK_ID_MAX_LENGTH,
  WEBHOOK_TYPE_MAX_LENGTH,
} from './rc-webhook-core.ts';

const SECRET = 'rc-webhook-signing-secret-fixture';
// Fixed clock: every signature below is minted for this instant.
const NOW_MS = 1_700_000_000_000;

type Database = Awaited<ReturnType<typeof freshMigratedDatabase>>;

function signBody(body: string, secret: string = SECRET, tSeconds: number = Math.floor(NOW_MS / 1000)): string {
  return signBytes(new TextEncoder().encode(body), secret, tSeconds);
}

// The HMAC the core verifies is computed over the raw bytes exactly as
// received — the signing helper mirrors that instead of re-encoding a string.
function signBytes(bytes: Uint8Array, secret: string = SECRET, tSeconds: number = Math.floor(NOW_MS / 1000)): string {
  const hex = createHmac('sha256', secret).update(`${tSeconds}.`).update(bytes).digest('hex');
  return `t=${tSeconds},v1=${hex}`;
}

function requestOf(
  event: Record<string, unknown>,
  overrides: Partial<{ header: string | null; secret: string; nowMs: number }> = {},
): { signatureHeader: string | null; rawBody: Uint8Array; secret: string; nowMs: number } {
  const body = JSON.stringify({ event });
  return {
    signatureHeader: overrides.header === undefined ? signBody(body) : overrides.header,
    rawBody: new TextEncoder().encode(body),
    secret: overrides.secret ?? SECRET,
    nowMs: overrides.nowMs ?? NOW_MS,
  };
}

async function seedDeviceWithCache(db: Database, deviceId: string) {
  await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [deviceId]);
  await db.query(
    "insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) values ($1, 'g08-06-spike', 'extended', jsonb_build_object('environment', 'sandbox'), now() + make_interval(hours => 24))",
    [deviceId],
  );
}

async function cacheRowCount(db: Database, deviceId: string): Promise<number> {
  const result = await db.query('select count(*)::int as count from entitlement_cache where device_id = $1', [deviceId]);
  return (result.rows as Array<{ count: number }>)[0]!.count;
}

async function webhookEventCount(db: Database): Promise<number> {
  const result = await db.query('select count(*)::int as count from webhook_events');
  return (result.rows as Array<{ count: number }>)[0]!.count;
}

test('a signed refund (CANCELLATION) persists the event and drops the cached rights of app_user_id and uuid aliases', async () => {
  const db = await freshMigratedDatabase();
  const deviceA = randomUUID();
  const deviceC = randomUUID();
  await seedDeviceWithCache(db, deviceA);
  await seedDeviceWithCache(db, deviceC);

  const event = {
    id: randomUUID(),
    type: 'CANCELLATION',
    event_timestamp_ms: 1_699_999_000_000,
    app_user_id: deviceA,
    aliases: [deviceC, '$RCAnonymousID:not-a-device'],
    product_id: 'kudy.route.ext',
    environment: 'SANDBOX',
    store: 'APP_STORE',
    cancel_reason: 'CUSTOMER_SUPPORT',
  };
  const answer = await handleWebhook(requestOf(event), { store: pgliteWebhookRunner(db) });

  assert.deepEqual(answer, { status: 200 });
  assert.equal(await cacheRowCount(db, deviceA), 0, 'the refunded device loses its cached rights');
  assert.equal(await cacheRowCount(db, deviceC), 0, 'uuid aliases of the identity group lose them too');
  const stored = await db.query('select type, effects_applied, event_at from webhook_events where event_id = $1', [event.id]);
  const row = (stored.rows as Array<Record<string, unknown>>)[0]!;
  assert.equal(row['type'], 'CANCELLATION');
  assert.equal(row['effects_applied'], true, '200 only after the durable persist + effects');
  assert.ok(row['event_at'] !== null, 'the event timestamp is persisted');
});

test('a tampered signature is 401 and changes no rights (issue proof: падроблены подпіс → правы не змяніліся)', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  const event = { id: randomUUID(), type: 'CANCELLATION', app_user_id: device };
  const request = requestOf(event, { header: `t=1700000000,v1=${'0'.repeat(64)}` });

  const answer = await handleWebhook(request, { store: pgliteWebhookRunner(db) });

  assert.deepEqual(answer, { status: 401 });
  assert.equal(await cacheRowCount(db, device), 1, 'no rights change without a valid signature');
  assert.equal(await webhookEventCount(db), 0, 'nothing is persisted either');
});

test('a signature from a foreign secret, a missing or malformed header, and a stale timestamp are all 401', async () => {
  const db = await freshMigratedDatabase();
  const base = { id: randomUUID(), type: 'CANCELLATION', app_user_id: randomUUID() };
  const rejections = [
    requestOf(base, { secret: 'another-secret' }),
    requestOf(base, { header: null }),
    requestOf(base, { header: `v1=${'a'.repeat(64)}` }),
    requestOf(base, { header: `t=${Math.floor(NOW_MS / 1000)},v1=short` }),
    requestOf(base, { nowMs: NOW_MS + (300 + 1) * 1000 }),
    requestOf(base, { nowMs: NOW_MS - (300 + 1) * 1000 }),
  ];
  for (const request of rejections) {
    const answer = await handleWebhook(request, { store: pgliteWebhookRunner(db) });
    assert.deepEqual(answer, { status: 401 }, String(request.signatureHeader));
  }
  assert.equal(await webhookEventCount(db), 0);
});

test('the HMAC covers the raw bytes: one flipped body byte with the original signature is 401', async () => {
  const db = await freshMigratedDatabase();
  const event = { id: randomUUID(), type: 'CANCELLATION', app_user_id: randomUUID(), product_id: 'kudy.route.ext' };
  const body = JSON.stringify({ event });
  const request = requestOf(event);
  const flipped = new TextEncoder().encode(body.replace('kudy.route.ext', 'kudy.route.ezt'));

  const answer = await handleWebhook({ ...request, rawBody: flipped }, { store: pgliteWebhookRunner(db) });

  assert.deepEqual(answer, { status: 401 });
  assert.equal(await webhookEventCount(db), 0);
});

test('an oversized body is 400 before the signature gate: nothing is persisted or executed', async () => {
  const db = await freshMigratedDatabase();
  const oversized = new Uint8Array(64 * 1024 + 1);
  const answer = await handleWebhook(
    { signatureHeader: 'garbage', rawBody: oversized, secret: SECRET, nowMs: NOW_MS },
    { store: pgliteWebhookRunner(db) },
  );

  assert.deepEqual(answer, { status: 400 });
  assert.equal(await webhookEventCount(db), 0);
});

test('corrupt payloads answer 400 without a crash, a persist or a rights change', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  const bodies = [
    'not-json',
    '[]',
    '"str"',
    '{}',
    '{"event":42}',
    '{"event":{"type":"CANCELLATION"}}',
    '{"event":{"id":"","type":"CANCELLATION"}}',
    `{"event":{"id":"${'x'.repeat(WEBHOOK_ID_MAX_LENGTH + 1)}","type":"CANCELLATION"}}`,
    `{"event":{"id":"ok","type":"${'y'.repeat(WEBHOOK_TYPE_MAX_LENGTH + 1)}"}}`,
  ];
  const requests = bodies.map((body) => ({ signatureHeader: signBody(body), rawBody: new TextEncoder().encode(body), secret: SECRET, nowMs: NOW_MS }));
  // Non-UTF-8 bytes with a valid signature over those same raw bytes.
  const nonUtf8 = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
  requests.push({ signatureHeader: signBytes(nonUtf8), rawBody: nonUtf8, secret: SECRET, nowMs: NOW_MS });
  for (const request of requests) {
    const answer = await handleWebhook(request, { store: pgliteWebhookRunner(db) });
    assert.deepEqual(answer, { status: 400 }, 'corrupt input is rejected, never 500');
  }
  assert.equal(await cacheRowCount(db, device), 1, 'no rights change');
  assert.equal(await webhookEventCount(db), 0, 'nothing persisted');
});

test('a duplicate delivery answers 200, keeps one event row and applies the effects once (issue proof: дубль → адна змена)', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  const event = { id: randomUUID(), type: 'EXPIRATION', app_user_id: device, expiration_at_ms: 1_699_999_500_000 };
  let invalidations = 0;
  const real = pgliteWebhookRunner(db);
  const countingStore = { ...real, async invalidateEntitlementCache(id: string) { invalidations += 1; return real.invalidateEntitlementCache(id); } };

  const first = await handleWebhook(requestOf(event), { store: countingStore });
  const second = await handleWebhook(requestOf(event), { store: countingStore });

  assert.deepEqual(first, { status: 200 });
  assert.deepEqual(second, { status: 200 });
  assert.equal(invalidations, 1, 'the effect ran exactly once per event id');
  assert.equal(await cacheRowCount(db, device), 0);
  const rows = await db.query('select count(*)::int as count from webhook_events where event_id = $1', [event.id]);
  assert.equal((rows.rows as Array<{ count: number }>)[0]!.count, 1);
});

test('a duplicate after a crash between persist and effects re-applies the idempotent effect (at-least-once, 09 §5.1)', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  const event = { id: randomUUID(), type: 'REFUND_REVERSED', app_user_id: device };
  await db.query(
    "insert into webhook_events (event_id, type, payload, effects_applied) values ($1, 'REFUND_REVERSED', jsonb_build_object(), false)",
    [event.id],
  );

  const answer = await handleWebhook(requestOf(event), { store: pgliteWebhookRunner(db) });

  assert.deepEqual(answer, { status: 200 });
  assert.equal(await cacheRowCount(db, device), 0, 'the interrupted effect is finished on the retry');
  const flag = await db.query('select effects_applied from webhook_events where event_id = $1', [event.id]);
  assert.equal((flag.rows as Array<Record<string, unknown>>)[0]!['effects_applied'], true);
});

test('TRANSFER drops the cached rights of transferred_from devices only; transferred_to stays', async () => {
  const db = await freshMigratedDatabase();
  const fromDevice = randomUUID();
  const toDevice = randomUUID();
  await seedDeviceWithCache(db, fromDevice);
  await seedDeviceWithCache(db, toDevice);

  const event = {
    id: randomUUID(),
    type: 'TRANSFER',
    event_timestamp_ms: 1_699_999_000_000,
    app_user_id: toDevice,
    transferred_from: [fromDevice, '$RCAnonymousID:alias'],
    transferred_to: [toDevice],
  };
  const answer = await handleWebhook(requestOf(event), { store: pgliteWebhookRunner(db) });

  assert.deepEqual(answer, { status: 200 });
  assert.equal(await cacheRowCount(db, fromDevice), 0, 'the losing device re-verifies on its next grant');
  assert.equal(await cacheRowCount(db, toDevice), 1, 'the receiving device needs no action');
});

test('bookkeeping events (TEST, INITIAL_PURCHASE, BILLING_ISSUE, …) persist but touch no rights', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  for (const type of ['TEST', 'INITIAL_PURCHASE', 'BILLING_ISSUE', 'PRODUCT_CHANGE', 'RENEWAL']) {
    const event = { id: randomUUID(), type, app_user_id: device };
    const answer = await handleWebhook(requestOf(event), { store: pgliteWebhookRunner(db) });
    assert.deepEqual(answer, { status: 200 }, type);
  }
  assert.equal(await cacheRowCount(db, device), 1, 'accounting events never remove rights');
  assert.equal(await webhookEventCount(db), 5, 'every event is durably stored');
});

test('a store fault never yields 200: the handler propagates it and nothing is half-applied', async () => {
  const db = await freshMigratedDatabase();
  const device = randomUUID();
  await seedDeviceWithCache(db, device);
  const real = pgliteWebhookRunner(db);
  const failingPersist = {
    ...real,
    async persistEvent() { throw new Error('store unavailable'); },
  };
  const event = { id: randomUUID(), type: 'CANCELLATION', app_user_id: device };

  await assert.rejects(
    handleWebhook(requestOf(event), { store: failingPersist }),
    /store unavailable/,
    'the wrapper turns this into 503 so RevenueCat retries',
  );
  assert.equal(await cacheRowCount(db, device), 1, 'no rights change without the durable persist');
  assert.equal(await webhookEventCount(db), 0);

  const failingInvalidate = {
    ...real,
    async invalidateEntitlementCache() { throw new Error('invalidate unavailable'); },
  };
  await assert.rejects(handleWebhook(requestOf(event), { store: failingInvalidate }), /invalidate unavailable/);
  const rows = await db.query('select effects_applied from webhook_events where event_id = $1', [event.id]);
  assert.equal((rows.rows as Array<Record<string, unknown>>)[0]!['effects_applied'], false, 'the crash window is marked, the retry finishes it');
});

test('affectedDeviceIds is total over corrupt shapes: null elements, wrong types and non-uuid strings contribute nothing', () => {
  assert.equal(affectedDeviceIds({ type: 'TRANSFER', transferred_from: [null, 42, 'not-a-uuid', randomUUID()] }).length, 1);
  assert.deepEqual(affectedDeviceIds({ type: 'CANCELLATION', app_user_id: '$RCAnonymousID:x', aliases: [null, ''] }), []);
  assert.deepEqual(affectedDeviceIds({ type: 'INITIAL_PURCHASE', app_user_id: randomUUID() }), []);
  assert.deepEqual(affectedDeviceIds({ type: 'TRANSFER', transferred_from: 'not-an-array' }), []);
});

test('parseWebhookEvent keeps a non-integer event_timestamp_ms out of the persisted row', () => {
  const event = parseWebhookEvent(new TextEncoder().encode(JSON.stringify({ event: { id: 'e1', type: 'TEST', event_timestamp_ms: 'soon' } })));
  assert.ok(event !== null);
  assert.equal(event['event_timestamp_ms'], 'soon', 'the value survives into the stored payload');
});

// The isolation guard files, whitelist-verified and read only from inside
// the functions root (implementation-rules 3: the root-boundary idiom).
const FUNCTIONS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ISOLATION_GUARD_PATHS = ['_shared/grant-core.ts', '_shared/device-core.ts', 'grant/index.ts', 'device/index.ts'];

function readFunctionSource(relativePath: string): string {
  assert.ok(ISOLATION_GUARD_PATHS.includes(relativePath), `unexpected path: ${relativePath}`);
  const target = path.resolve(FUNCTIONS_ROOT, relativePath);
  assert.ok(target.startsWith(FUNCTIONS_ROOT + path.sep), `outside the functions root: ${target}`);
  return readFileSync(target, 'utf8');
}

test('guard: the grant and device paths import nothing from the webhook core — integration off ⇒ grant/restore unchanged', () => {
  for (const relativePath of ISOLATION_GUARD_PATHS) {
    assert.doesNotMatch(readFunctionSource(relativePath), /rc-webhook/, `${relativePath} must not depend on the webhook`);
  }
});
