// G09.03 — the retention sweep (docs/architecture/09 §10: «сырыя падзеі —
// 14 месяцаў, потым выдаляюцца заданнем»; per-route aggregate counts stay
// without device_id — no aggregate table exists yet, so the sweep deletes
// only raw rows, plus the webhook bookkeeping rows added by G20.12, and
// never touches anything else).
//
// The TTL commitments the migrations pin travel with this job: rows of
// `device_registration_rate` are "deletable service-role data ... and get a
// TTL sweep with the G09.03 retention job" (20260922120000), and the
// per-device `event_send_rate` windows live only as long as their counter
// is usable (20261001000000 — the device delete cascade is the other half).
//
// Platform-neutral by contract: pure month arithmetic plus pinned SQL
// statements over an injected runner — the grant/webhook port idiom. The
// scheduled execution (pg_cron or a scheduled invocation on the Supabase
// runtime) is deploy-time wiring: no Supabase project is attached to this
// repo yet, so the schedule itself is not-run (the G08.01/G09.02
// precedent); the term semantics and the statements are proven by
// node --test against PGlite with synthetic events.

/** `09` §10: raw events are kept 14 months, then deleted by the job. */
export const EVENT_RETENTION_MONTHS = 14;

// Dead-weight bound for the fixed-window rate counters: both windows are
// one hour (DEVICE_RATE_WINDOW_MS, EVENT_RATE_WINDOW_MS), so a window that
// started more than 24 hours ago can neither increment nor gate a request
// again. 24 hours is a defensive implementation choice, not a canon number
// (the G09.02 protective-parameters precedent); the sweep only reclaims
// dead windows, never a live one.
export const RATE_RETENTION_HOURS = 24;

/**
 * Subtracts whole months from a UTC instant and clamps the day-of-month to
 * the target month's length (Jan 31 − 1 month → Feb 28/29), matching the
 * month arithmetic a SQL `interval` would apply. The cutoff semantics of
 * the retention term live here only.
 */
export function subMonthsClamped(epochMs: number, months: number): number {
  const moving = new Date(epochMs);
  const dayOfMonth = moving.getUTCDate();
  moving.setUTCDate(1);
  moving.setUTCMonth(moving.getUTCMonth() - months);
  const daysInTargetMonth = new Date(
    Date.UTC(moving.getUTCFullYear(), moving.getUTCMonth() + 1, 0),
  ).getUTCDate();
  moving.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));
  return moving.getTime();
}

/** Events strictly older than this instant are deletable raw rows. */
export function eventRetentionCutoffMs(nowMs: number): number {
  return subMonthsClamped(nowMs, EVENT_RETENTION_MONTHS);
}

/** Counter windows that started before this instant are dead weight. */
export function rateRetentionCutoffMs(nowMs: number): number {
  return nowMs - RATE_RETENTION_HOURS * 60 * 60 * 1000;
}

// G20.12 — protective bound for the webhook bookkeeping rows. Idempotency
// needs them only while RevenueCat may retry the same event id (the
// documented 5/10/20/40/80-minute schedule, 09 §5.1), the minimized payload
// keeps no device identity, and no in-repo consumer reads the log yet — so
// 30 days bounds an unconsumed accounting table without transferring the
// 14-month analytics term onto accounting data (spec N6 forbids that without
// a canonical decision). A protective implementation choice, not a canon
// number (the G09.02 protective-parameters precedent); the accounting
// retention term itself stays the owner's decision recorded in the G20.12
// policy matrix.
export const WEBHOOK_RETENTION_DAYS = 30;

/** Webhook bookkeeping rows stored before this instant are deletable. */
export function webhookRetentionCutoffMs(nowMs: number): number {
  return nowMs - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/** Aged-out `webhook_events` rows (G20.12); `received_at` is the storage clock. */
export const WEBHOOK_RETENTION_DELETE_SQL =
  'delete from webhook_events where received_at < to_timestamp($1 / 1000.0) returning event_id';

/** Raw `event_log` rows past the 14-month term (§10); epoch ms parameter, the grant-core to_timestamp idiom. */
export const EVENT_RETENTION_DELETE_SQL =
  'delete from event_log where at < to_timestamp($1 / 1000.0) returning event_id';

/** Dead `device_registration_rate` windows (20260922120000 retention note). */
export const REGISTRATION_RATE_RETENTION_DELETE_SQL =
  'delete from device_registration_rate where window_start < to_timestamp($1 / 1000.0) returning ip_hash';

/** Dead `event_send_rate` windows for live devices (20261001000000; dead devices cascade instead). */
export const SEND_RATE_RETENTION_DELETE_SQL =
  'delete from event_send_rate where window_start < to_timestamp($1 / 1000.0) returning device_id';

export interface RetentionRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface RetentionSweepResult {
  eventsDeleted: number;
  registrationRateWindowsDeleted: number;
  sendRateWindowsDeleted: number;
  webhookEventsDeleted: number;
}

/**
 * One sweep pass: four independent deletes, each bounded by its own cutoff,
 * each answering the exact rows it removed. Order between the tables carries
 * no semantics (no FK links them), so a partially completed pass converges:
 * the next scheduled pass deletes only what aged past the cutoff since. A
 * runner fault propagates — the scheduling wiring decides the retry, the
 * core never swallows a storage failure into a zero-count success.
 */
export async function runRetentionSweep(
  runner: RetentionRunner,
  nowMs: number,
): Promise<RetentionSweepResult> {
  const events = await runner.query(EVENT_RETENTION_DELETE_SQL, [eventRetentionCutoffMs(nowMs)]);
  const registrationRate = await runner.query(REGISTRATION_RATE_RETENTION_DELETE_SQL, [
    rateRetentionCutoffMs(nowMs),
  ]);
  const sendRate = await runner.query(SEND_RATE_RETENTION_DELETE_SQL, [rateRetentionCutoffMs(nowMs)]);
  const webhookEvents = await runner.query(WEBHOOK_RETENTION_DELETE_SQL, [
    webhookRetentionCutoffMs(nowMs),
  ]);
  return {
    eventsDeleted: events.rows.length,
    registrationRateWindowsDeleted: registrationRate.rows.length,
    sendRateWindowsDeleted: sendRate.rows.length,
    webhookEventsDeleted: webhookEvents.rows.length,
  };
}
