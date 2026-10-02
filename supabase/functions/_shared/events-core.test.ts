// G09.02 — behavioral tests for the /v1/events core. Every rule here fails
// when the corresponding gate in events-core.ts is reverted (implementation-
// rules 1/14): device-bearer auth (the single G08.01 identity path), the
// size/rate limits, the allowlist walk against the canonical event table
// (each negative fixture isolates exactly one violation and the reason names
// its class), and the idempotent all-or-nothing insert. The SQL port runs
// its production statements against real Postgres (PGlite, committed
// migrations applied); auth storage and the clock are fakes — the thin Deno
// adapter is exercised at deploy time (device/grant precedent).
//
// The closed-list cross-check keeps the server answers aligned with the
// client contract (services/analytics.ts AnalyticsError rules): a status the
// server emits must be handled by the client transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { AnalyticsError, createEventsTransport } from '../../../services/analytics.ts';

import { hashSecret, registerDevice } from './device-core.ts';
import {
  createSqlEventsPort,
  defaultEventsConfig,
  EVENT_MAX_BATCH_EVENTS,
  EVENT_MAX_BODY_BYTES,
  EVENT_RATE_LIMIT,
  EVENT_RATE_WINDOW_MS,
  eventInsertSql,
  forbiddenEnforcement,
  handleEventsRequest,
  validateEventBatch,
  type EventTableSpec,
  type EventsConfig,
  type EventsPort,
} from './events-core.ts';
import { freshMigratedDatabase } from './test-db.ts';
import { ISO_AT, wireEvent } from './wire-test-support.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(
  fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'contracts', 'events', 'event-table.v1.json'), 'utf8'),
) as EventTableSpec;

const NOW_MS = 1_759_276_800_000; // fixed clock; the rate window derives from it

function config(overrides: Partial<EventsConfig> = {}): EventsConfig {
  return { ...defaultEventsConfig(NOW_MS), ...overrides };
}

// The fake port: auth through the real G08.01 hash, an in-memory rate
// counter, an idempotent insert (dedupe by event_id) — the intake decision
// is proven without storage; the real statements run in the PGlite tests.
function fakePort(deviceSecrets: Map<string, string> = new Map()): EventsPort & {
  inserted: Array<{ deviceId: string; rows: Array<unknown> }>;
} {
  const inserted: Array<{ deviceId: string; rows: Array<unknown> }> = [];
  const seen = new Set<string>();
  const rate = new Map<string, number>();
  return {
    inserted,
    async lookupDeviceId(secretHash) {
      return deviceSecrets.get(secretHash) ?? null;
    },
    incrementEventRate(deviceId, windowStartMs) {
      const key = `${deviceId}@${windowStartMs}`;
      const next = (rate.get(key) ?? 0) + 1;
      rate.set(key, next);
      return next;
    },
    async insertEventBatch(deviceId, rows) {
      inserted.push({ deviceId, rows });
      let fresh = 0;
      for (const row of rows) {
        if (!seen.has(row.eventId)) {
          seen.add(row.eventId);
          fresh += 1;
        }
      }
      return fresh;
    },
  };
}

function registeredPort(): {
  port: ReturnType<typeof fakePort>;
  authorization: string;
  deviceId: string;
} {
  const registration = registerDevice();
  const port = fakePort(new Map([[hashSecret(registration.deviceSecret), registration.deviceId]]));
  return { port, authorization: `Bearer ${registration.deviceSecret}`, deviceId: registration.deviceId };
}

function raw(body: unknown): Uint8Array {
  return new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
}

test('method: only POST exists', async () => {
  const { port, authorization } = registeredPort();
  const answer = await handleEventsRequest(
    { method: 'GET', authorization, rawBody: raw({ events: [] }) },
    port,
    TABLE,
    config(),
  );
  assert.deepEqual(answer, { status: 404, code: 'not_found' });
});

test('criterion 4: device-bearer auth is the only identity — malformed, absent, unknown', async () => {
  const { port } = registeredPort();
  const request = (authorization: string | null) =>
    handleEventsRequest({ method: 'POST', authorization, rawBody: raw({ events: [wireEvent()] }) }, port, TABLE, config());

  for (const header of [null, undefined, '', 'Bearer', 'bearer nope', 'Basic abc', 'Bearer '] as Array<string | null | undefined>) {
    const answer = await request(header);
    assert.deepEqual(answer, { status: 403, code: 'device_auth_failed' }, `header ${String(header)} must fail auth`);
  }
  const unknown = await request('Bearer nobody-knows-this-secret');
  assert.deepEqual(unknown, { status: 403, code: 'device_auth_failed' });
  assert.equal(port.inserted.length, 0, 'no storage work happens for unauthenticated requests');
});

test('criterion 4: the G08.01 device secret authenticates — no additional identity fields exist', async () => {
  const { port, authorization, deviceId } = registeredPort();
  const answer = await handleEventsRequest(
    { method: 'POST', authorization, rawBody: raw({ events: [wireEvent()], user_id: 'spoofed-user' }) },
    port,
    TABLE,
    config(),
  );
  assert.equal(answer.status, 200, 'an extra body field cannot become an identity; the device secret decides');
  if (answer.status === 200) assert.equal(answer.body.accepted, 1);
  assert.equal(port.inserted[0]!.deviceId, deviceId, 'the batch is attributed to the bearer identity');
});

test('limits: an oversized raw body is rejected before parsing, with a reason', async () => {
  const { port, authorization } = registeredPort();
  const answer = await handleEventsRequest(
    { method: 'POST', authorization, rawBody: new Uint8Array(EVENT_MAX_BODY_BYTES + 1) },
    port,
    TABLE,
    config(),
  );
  assert.equal(answer.status, 400);
  assert.equal(answer.code, 'invalid_event');
  assert.match((answer as { reason: string }).reason, /byte limit/);
  assert.equal(port.inserted.length, 0);
});

test('limits: a corrupt JSON body is a 400 with a reason, never a 500 (criterion 5)', async () => {
  const { port, authorization } = registeredPort();
  const answer = await handleEventsRequest(
    { method: 'POST', authorization, rawBody: raw('{"events": [not json') },
    port,
    TABLE,
    config(),
  );
  assert.equal(answer.status, 400);
  assert.match((answer as { reason: string }).reason, /not valid JSON/);
});

test('validation: the batch envelope — object body, events array, non-empty, within the limit', async () => {
  const { port, authorization } = registeredPort();
  const request = (body: unknown, maxBatchEvents = EVENT_MAX_BATCH_EVENTS) =>
    handleEventsRequest({ method: 'POST', authorization, rawBody: raw(body) }, port, TABLE, config({ maxBatchEvents }));

  for (const body of [[wireEvent()], 'events', { nope: true }, { events: {} }, { events: [] }]) {
    const answer = await request(body);
    assert.equal(answer.status, 400, `body ${JSON.stringify(body).slice(0, 40)} must be rejected`);
  }
  const over = await request({ events: [wireEvent(), wireEvent(), wireEvent()] }, 2);
  assert.match((over as { reason: string }).reason, /exceeds the 2 event limit/);
  assert.equal(port.inserted.length, 0, 'rejected envelopes never reach storage');
});

// One isolated negative per violation class (implementation-rules 14): the
// reason names the class and the path, nothing is stored, status is 400.
const NEGATIVES: Array<{ name: string; event: Record<string, unknown>; class: string }> = [
  { name: 'element is not an object', event: null as unknown as Record<string, unknown>, class: 'must be a JSON object' },
  { name: 'event_id is not a UUID', event: wireEvent({ event_id: 'nope' }), class: 'event_id' },
  { name: 'type is unknown', event: wireEvent({ type: 'not_an_event' }), class: 'unknown event type' },
  { name: 'at is not ISO-8601 UTC', event: wireEvent({ at: '2026-10-01 noon' }), class: 'at' },
  { name: 'schema_version is not 1', event: wireEvent({ schema_version: 2 }), class: 'schema_version' },
  { name: 'payload is an array', event: wireEvent({ payload: [] }), class: 'payload: must be a JSON object' },
  { name: 'payload is null', event: wireEvent({ payload: null }), class: 'payload: must be a JSON object' },
  { name: 'unknown field', event: wireEvent({ payload: { random_field: 'x' } }), class: 'unknown-field' },
  { name: 'coordinate field name', event: wireEvent({ payload: { lat: 54.4 } }), class: 'forbidden-coordinates' },
  { name: 'free-text field name', event: wireEvent({ payload: { note: 'hello' } }), class: 'forbidden-free-text' },
  { name: 'url/token field name', event: wireEvent({ payload: { url: 'https://kudy.example' } }), class: 'forbidden-url-token' },
  { name: 'rating field name', event: wireEvent({ payload: { rating: 5 } }), class: 'forbidden-feedback-rating' },
  {
    name: 'url value in an identifier field',
    event: wireEvent({ type: 'session_started', payload: { session_id: 'https://evil.example', route_id: 'r', version: '1' } }),
    class: 'forbidden-url-token',
  },
  {
    name: 'coordinate value in an identifier field',
    event: wireEvent({
      type: 'guide_nearby_shown',
      payload: { suggestion_id: '54.4034, 18.6559', shown_guide_ids: ['g1'], context: 'idle' },
    }),
    class: 'forbidden-coordinates',
  },
  {
    name: 'whitespace identifier value (free text)',
    event: wireEvent({ type: 'moment_shown', payload: { kind: 'a b' } }),
    class: 'forbidden-free-text',
  },
  {
    name: 'enum violation',
    event: wireEvent({ type: 'purchase_started', payload: { attempt_id: 'a1', tier: 'premium', route_id: 'r1' } }),
    class: 'outside the closed list',
  },
  {
    name: 'array item violation',
    event: wireEvent({
      type: 'guide_nearby_shown',
      payload: { suggestion_id: 's1', shown_guide_ids: [42], context: 'idle' },
    }),
    class: 'item violation',
  },
  {
    name: 'array minItems violation',
    event: wireEvent({
      type: 'guide_nearby_shown',
      payload: { suggestion_id: 's1', shown_guide_ids: [], context: 'idle' },
    }),
    class: 'at least 1 item',
  },
  {
    name: 'negative count',
    event: wireEvent({
      type: 'download_started',
      payload: { download_id: 'd1', bytes: -5, route_id: 'r1', version: '1', locale: 'be', tier: 'base' },
    }),
    class: 'must not be negative',
  },
  {
    name: 'required field missing',
    event: wireEvent({ type: 'purchase_started', payload: { route_id: 'r1', tier: 'base' } }),
    class: 'required field missing',
  },
  {
    name: 'required context missing',
    event: wireEvent({ type: 'route_preview', payload: {} }),
    class: 'required context missing',
  },
];

for (const negative of NEGATIVES) {
  test(`criterion 3/5: ${negative.name} → 400 naming ${negative.class}, nothing stored`, async () => {
    const { port, authorization } = registeredPort();
    const answer = await handleEventsRequest(
      { method: 'POST', authorization, rawBody: raw({ events: [negative.event] }) },
      port,
      TABLE,
      config(),
    );
    assert.equal(answer.status, 400, 'an invalid payload is a client error, never a 500');
    assert.equal(answer.code, 'invalid_event');
    const reason = (answer as { reason: string }).reason;
    assert.match(reason, new RegExp(negative.class.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `reason: ${reason}`);
    assert.match(reason, /events\[0\]/, 'the reason names the violating element');
    assert.equal(port.inserted.length, 0, 'a rejected batch stores nothing (all-or-nothing)');
  });
}

test('criterion 3: the allowlist accepts the table-shaped payloads verbatim', async () => {
  const { port, authorization } = registeredPort();
  const batch = {
    events: [
      wireEvent(),
      wireEvent({
        event_id: '55555555-5555-4555-8555-000000000002',
        type: 'guide_nearby_shown',
        payload: { suggestion_id: 's-1', shown_guide_ids: ['g-1', 'g-2'], context: 'active', session_id: 'sess-1' },
      }),
      wireEvent({
        event_id: '55555555-5555-4555-8555-000000000003',
        type: 'session_ended',
        payload: { session_id: 'sess-1', route_id: 'r-1', version: '3', reason: 'user_stop', heard_stories_count: 2 },
      }),
    ],
  };
  const answer = await handleEventsRequest(
    { method: 'POST', authorization, rawBody: raw(batch) },
    port,
    TABLE,
    config(),
  );
  assert.deepEqual(answer, { status: 200, body: { accepted: 3 } });
  assert.equal(port.inserted[0]!.rows.length, 3);
  const stored = port.inserted[0]!.rows[1] as { payload: Record<string, unknown> };
  assert.deepEqual(stored.payload, batch.events[1]!.payload, 'the payload is stored verbatim, not reinterpreted');
});

test('idempotency: a resent batch dedupes by event_id — accepted drops to zero', async () => {
  const { port, authorization } = registeredPort();
  const request = () =>
    handleEventsRequest(
      { method: 'POST', authorization, rawBody: raw({ events: [wireEvent()] }) },
      port,
      TABLE,
      config(),
    );
  const first = await request();
  const second = await request();
  assert.deepEqual(first, { status: 200, body: { accepted: 1 } });
  assert.deepEqual(second, { status: 200, body: { accepted: 0 } }, 'the resend is acked but credits nothing new');
});

test('limits: the per-device rate window answers 429 with a retry-after', async () => {
  const { port, authorization } = registeredPort();
  const request = () =>
    handleEventsRequest(
      { method: 'POST', authorization, rawBody: raw({ events: [wireEvent()] }) },
      port,
      TABLE,
      config({ rateLimit: 2, rateWindowMs: EVENT_RATE_WINDOW_MS }),
    );
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  const third = await request();
  assert.equal(third.status, 429);
  assert.equal(third.code, 'event_rate_limited');
  assert.ok(third.retryAfterSeconds >= 1, 'the answer carries a retry-after');
  assert.equal(port.inserted.length, 2, 'the over-limit batch is never stored');
});

test('spec N1: a rate reply without a valid counter rejects — never a silent allow (criterion 2)', async () => {
  const { port, authorization } = registeredPort();
  // The SQL port answers a missing counter row as undefined; the shared
  // decision must reject it instead of counting it as 0.
  port.incrementEventRate = async () => undefined as unknown as number;
  await assert.rejects(
    handleEventsRequest(
      { method: 'POST', authorization, rawBody: raw({ events: [wireEvent()] }) },
      port,
      TABLE,
      config(),
    ),
    /did not return a valid attempt count/,
  );
  assert.equal(port.inserted.length, 0, 'an invalid counter reply stores nothing');
});

test('validation walk: the table-driven validator agrees with the enforcement block it reads', () => {
  const enforcement = forbiddenEnforcement(TABLE);
  const batch = { events: [wireEvent({ payload: { [enforcement.coordinate_fields[0]!]: 1 } })] };
  const verdict = validateEventBatch(TABLE, batch, EVENT_MAX_BATCH_EVENTS);
  assert.equal(verdict.ok, false);
  assert.match((verdict as { reason: string }).reason, /forbidden-coordinates/);
});

test('eventInsertSql: placeholders only, bounded by the batch contract', () => {
  const sql = eventInsertSql(2);
  assert.match(sql, /insert into event_log \(event_id, device_id, type, at, payload\) values/);
  assert.match(sql, /on conflict \(event_id\) do nothing returning event_id/);
  assert.ok(!/[a-z_]+\s*=\s*\$\d/.test(sql), 'no client-shaped assignments in the statement');
  assert.throws(() => eventInsertSql(0), /outside the 1\.\.\d+ contract/);
  assert.throws(() => eventInsertSql(EVENT_MAX_BATCH_EVENTS + 1), /outside the 1\.\.\d+ contract/);
});

// --- the production statements against real Postgres (PGlite) ---

test('PGlite: the real port inserts the batch, dedupes the resend, and bumps the rate window', async () => {
  const db = await freshMigratedDatabase();
  const deviceId = '66666666-6666-4666-8666-000000000001';
  await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [deviceId]);
  const port = createSqlEventsPort(db);

  const rows = [
    { eventId: '77777777-7777-4777-8777-000000000001', type: 'app_open', at: ISO_AT, payload: {} },
    {
      eventId: '77777777-7777-4777-8777-000000000002',
      type: 'stop_reached',
      at: ISO_AT,
      payload: { session_id: 'sess-9', stop_id: 'stop-9' },
    },
  ];
  assert.equal(await port.insertEventBatch(deviceId, rows), 2, 'the first send stores both events');
  assert.equal(await port.insertEventBatch(deviceId, rows), 0, 'the resend dedupes on the unique event_id');

  const stored = await db.query('select event_id, type, at::text as at, payload from event_log order by event_id');
  assert.equal(stored.rows.length, 2);
  assert.equal(stored.rows[1]!.type, 'stop_reached');

  const windowStart = Math.floor(NOW_MS / EVENT_RATE_WINDOW_MS) * EVENT_RATE_WINDOW_MS;
  assert.equal(await port.incrementEventRate(deviceId, windowStart), 1);
  assert.equal(await port.incrementEventRate(deviceId, windowStart), 2, 'the same window accumulates');
});

test('PGlite: the rate counter dies with the device row (cascade)', async () => {
  const db = await freshMigratedDatabase();
  const deviceId = '66666666-6666-4666-8666-000000000002';
  await db.query('insert into devices (device_id, secret_hash) values ($1, md5(random()::text))', [deviceId]);
  const port = createSqlEventsPort(db);
  await port.incrementEventRate(deviceId, NOW_MS);
  await db.query('delete from devices where device_id = $1', [deviceId]);
  const left = await db.query('select count(*)::int as count from event_send_rate');
  assert.equal(left.rows[0]!.count, 0, 'device delete clears the counter (09 §5)');
});

// --- the closed-list cross-check: every server status is handled by the client ---

test('closed-list cross-check: the client transport handles every answer the core emits', async () => {
  const statuses: Array<{ status: number; rule: AnalyticsError['rule'] }> = [
    { status: 400, rule: 'invalid_payload' },
    { status: 403, rule: 'server_error' },
    { status: 404, rule: 'server_error' },
    { status: 429, rule: 'rate_limited' },
    { status: 500, rule: 'server_error' },
  ];
  for (const { status, rule } of statuses) {
    await assert.rejects(
      createEventsTransport({
        baseUrl: 'https://example.supabase.co/functions/v1',
        identity: { deviceId: '88888888-8888-4888-8888-000000000001', deviceSecret: 's' },
        transport: { async postEvents() { return { status, body: { error: { code: 'x', reason: 'r' } } }; } },
      })([]),
      (error: unknown) => {
        assert.ok(error instanceof AnalyticsError, `status ${status} must surface as AnalyticsError`);
        assert.equal((error as AnalyticsError).rule, rule, `status ${status} must map to ${rule}`);
        return true;
      },
    );
  }
});

test('config: the pinned defaults match the documented constants', () => {
  const config = defaultEventsConfig(NOW_MS);
  assert.equal(config.maxBodyBytes, EVENT_MAX_BODY_BYTES);
  assert.equal(config.maxBatchEvents, EVENT_MAX_BATCH_EVENTS);
  assert.equal(config.rateLimit, EVENT_RATE_LIMIT);
  assert.equal(config.rateWindowMs, EVENT_RATE_WINDOW_MS);
});
