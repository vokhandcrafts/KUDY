// G09.03 — retention sweep tests. The term semantics live in the pure
// cutoff functions (14 months for raw events per 09 §10, day-clamped month
// arithmetic), and the pinned statements run against real Postgres
// (PGlite, committed migrations) with synthetic events — the criterion-2
// walk: term (the cutoff boundary deletes exactly the rows past it),
// volume (a bounded insert ages out in one pass), order (a repeated sweep
// deletes nothing). Every assertion here fails when the sweep stops
// filtering by the cutoff or stops running (implementation-rules 1/14).
import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVICE_INSERT_SQL, registerDevice } from './device-core.ts';

import {
  eventRetentionCutoffMs,
  EVENT_RETENTION_MONTHS,
  RATE_RETENTION_HOURS,
  rateRetentionCutoffMs,
  runRetentionSweep,
  subMonthsClamped,
  WEBHOOK_RETENTION_DAYS,
  webhookRetentionCutoffMs,
} from './retention-core.ts';
import { freshMigratedDatabase } from './test-db.ts';

const NOW_MS = 1_759_276_800_000; // 2026-10-01T00:00:00Z — the events-core suite's fixed clock
const HOUR_MS = 60 * 60 * 1000;

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

test('term: 14 months subtract with day-of-month clamping, matching SQL interval arithmetic', () => {
  assert.equal(eventRetentionCutoffMs(NOW_MS), utc(2024, 8, 1), '2025-10-01 minus 14 months is 2024-08-01');
  assert.equal(EVENT_RETENTION_MONTHS, 14, '09 §10: raw events are kept 14 months');
  assert.equal(subMonthsClamped(utc(2025, 3, 31), 1), utc(2025, 2, 28), 'Mar 31 clamps to Feb 28');
  assert.equal(subMonthsClamped(utc(2024, 3, 31), 1), utc(2024, 2, 29), 'the leap year keeps Feb 29');
  assert.equal(subMonthsClamped(utc(2025, 1, 31), 1), utc(2024, 12, 31), 'Jan 31 minus one month is Dec 31');
});

test('rate counters: a window older than the bound is dead, a fresh one is never touched', () => {
  assert.equal(rateRetentionCutoffMs(NOW_MS), NOW_MS - RATE_RETENTION_HOURS * HOUR_MS);
  assert.equal(RATE_RETENTION_HOURS, 24, 'a one-hour window that started 24h ago can never gate again');
});

async function seedDeviceWithEvents(db: Awaited<ReturnType<typeof freshMigratedDatabase>>, eventRows: Array<{ at: number; id: string }>): Promise<string> {
  const registration = registerDevice();
  await db.query(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
  for (const row of eventRows) {
    await db.query(
      'insert into event_log (event_id, device_id, type, at, payload) values ($1, $2, $3, to_timestamp($4 / 1000.0), \'{}\'::jsonb)',
      [row.id, registration.deviceId, 'app_open', row.at],
    );
  }
  return registration.deviceId;
}

let eventSeq = 0;
function nextEventId(): string {
  eventSeq += 1;
  return `88888888-8884-4888-8888-${String(eventSeq).padStart(12, '0')}`;
}

test('PGlite term: the sweep deletes exactly the events past the 14-month boundary — recent and boundary rows stay', async () => {
  const db = await freshMigratedDatabase();
  const cutoff = eventRetentionCutoffMs(NOW_MS);
  await seedDeviceWithEvents(db, [
    { id: nextEventId(), at: cutoff - 1 }, // strictly past the term — deletable
    { id: nextEventId(), at: cutoff }, // at the boundary — stays (`at < cutoff`)
    { id: nextEventId(), at: NOW_MS - 15 * 30 * 24 * HOUR_MS }, // ~15 months old — deletable
    { id: nextEventId(), at: NOW_MS }, // fresh — stays
  ]);

  const sweep = await runRetentionSweep(db, NOW_MS);
  assert.equal(sweep.eventsDeleted, 2, 'exactly the rows past the term are deleted');
  const left = await db.query('select count(*)::int as count from event_log');
  assert.equal(left.rows[0]!.count, 2, 'the boundary and fresh rows survive the sweep');
});

test('PGlite volume: five hundred aged-out events go in one pass, ordered by the cutoff alone', async () => {
  const db = await freshMigratedDatabase();
  const registration = registerDevice();
  await db.query(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
  await db.query(
    "insert into event_log (event_id, device_id, type, at, payload) select gen_random_uuid(), $1, 'app_open', to_timestamp($2 / 1000.0) - (g || ' hours')::interval, '{}'::jsonb from generate_series(1, 500) g",
    [registration.deviceId, eventRetentionCutoffMs(NOW_MS) - HOUR_MS],
  );

  const sweep = await runRetentionSweep(db, NOW_MS);
  assert.equal(sweep.eventsDeleted, 500, 'the whole aged-out volume is reclaimed in one pass');
  const left = await db.query('select count(*)::int as count from event_log');
  assert.equal(left.rows[0]!.count, 0);
});

test('PGlite order: a second sweep deletes nothing, and the sweep never resurrects newer rows', async () => {
  const db = await freshMigratedDatabase();
  const cutoff = eventRetentionCutoffMs(NOW_MS);
  await seedDeviceWithEvents(db, [{ id: nextEventId(), at: cutoff - 1 }]);

  const first = await runRetentionSweep(db, NOW_MS);
  assert.equal(first.eventsDeleted, 1);
  const second = await runRetentionSweep(db, NOW_MS);
  assert.deepEqual(second, { eventsDeleted: 0, registrationRateWindowsDeleted: 0, sendRateWindowsDeleted: 0, webhookEventsDeleted: 0 });
  const left = await db.query('select count(*)::int as count from event_log');
  assert.equal(left.rows[0]!.count, 0);
});

test('PGlite rate counters: dead windows of live devices are swept, fresh windows and both tables stay usable', async () => {
  const db = await freshMigratedDatabase();
  const registration = registerDevice();
  await db.query(DEVICE_INSERT_SQL, [registration.deviceId, registration.secretHash]);
  const deadWindow = rateRetentionCutoffMs(NOW_MS) - HOUR_MS;
  const liveWindow = NOW_MS;
  await db.query(
    'insert into device_registration_rate (ip_hash, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 5), ($1, to_timestamp($3 / 1000.0), 1)',
    ['a'.repeat(64), deadWindow, liveWindow],
  );
  await db.query(
    'insert into event_send_rate (device_id, window_start, attempts) values ($1, to_timestamp($2 / 1000.0), 9), ($1, to_timestamp($3 / 1000.0), 2)',
    [registration.deviceId, deadWindow, liveWindow],
  );

  const sweep = await runRetentionSweep(db, NOW_MS);
  assert.equal(sweep.registrationRateWindowsDeleted, 1, 'the dead registration window goes');
  assert.equal(sweep.sendRateWindowsDeleted, 1, 'the dead send window goes');
  const registrationLeft = await db.query('select attempts from device_registration_rate');
  const sendLeft = await db.query('select attempts from event_send_rate');
  assert.deepEqual(registrationLeft.rows, [{ attempts: 1 }], 'the live registration window stays');
  assert.deepEqual(sendLeft.rows, [{ attempts: 2 }], 'the live send window stays');
});

async function seedWebhookRow(db: Awaited<ReturnType<typeof freshMigratedDatabase>>, eventId: string, receivedAtMs: number): Promise<void> {
  await db.query(
    'insert into webhook_events (event_id, type, payload, effects_applied, received_at) values ($1, \'TEST\', \'{}\'::jsonb, true, to_timestamp($2 / 1000.0))',
    [eventId, receivedAtMs],
  );
}

test('webhook_expiry_purge: webhook bookkeeping rows past the protective bound are swept by received_at, the boundary row stays, a repeated pass deletes nothing', async () => {
  const db = await freshMigratedDatabase();
  assert.equal(WEBHOOK_RETENTION_DAYS, 30, 'the protective bound is 30 days — the G20.12 matrix proposal, not the analytics term');
  const cutoff = webhookRetentionCutoffMs(NOW_MS);
  assert.equal(cutoff, NOW_MS - WEBHOOK_RETENTION_DAYS * 24 * HOUR_MS);
  await seedWebhookRow(db, 'wh-aged-out', cutoff - 1);
  await seedWebhookRow(db, 'wh-at-boundary', cutoff);
  await seedWebhookRow(db, 'wh-fresh', NOW_MS);

  const sweep = await runRetentionSweep(db, NOW_MS);
  assert.equal(sweep.webhookEventsDeleted, 1, 'exactly the row stored past the bound is deleted');
  const left = await db.query('select event_id from webhook_events order by event_id');
  assert.deepEqual(left.rows, [{ event_id: 'wh-at-boundary' }, { event_id: 'wh-fresh' }], 'the boundary and fresh rows survive');
  const again = await runRetentionSweep(db, NOW_MS);
  assert.equal(again.webhookEventsDeleted, 0, 'the sweep is idempotent');
});
