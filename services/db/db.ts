// G04.01 — services/db: opening the store, zone A rebuild and the
// transactional session boundaries. Transaction ownership is this module's by
// contract (ADR G01.03 §3.3: "Уладальнік транзакцый — services/db; яны не
// робяць сеткавых/OS-выклікаў"). Conditions are checked before the
// transaction; the database itself decides simultaneous Start/switch races
// through the one_live_session index (§3.1). Failure paths roll back and
// never wipe data: a migration error fails the open with diagnostics (§3.8),
// and drop-and-recreate physically exists only for zone A (`09` §7).
import {
  migrationSteps,
  ZONE_A_DDL,
  ZONE_A_TABLES,
  type MigrationStep,
} from './schema.ts';
import type {
  AssetKey,
  BundleAssetRow,
  BundleAssetStatus,
  EventInput,
  EventQueueRow,
  GuideHintRecordInput,
  GuideHintStateRow,
  SessionProgress,
  SessionRow,
  SessionStartInput,
  SessionState,
  SessionHistoryCursor,
  SessionHistoryPage,
  SessionHistorySummary,
  SqlDriver,
  SqlValue,
} from './types.ts';

// Named failure rules surface as diagnostics, not crashes (each rule is
// asserted by a test): 'migration-failed', 'schema-newer-than-code',
// 'live-session-exists', 'session-write-failed', 'guide-hint-transfer-failed',
// 'session-not-found', 'session-not-active', 'session-not-paused',
// 'session-not-live', 'guide-hint-input-invalid', 'guide-hint-write-failed',
// 'guide-hint-dismiss-unknown-guide'.
export class DbError extends Error {
  rule: string;

  constructor(rule: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DbError';
    this.rule = rule;
  }
}

// The transaction boundary every multi-statement zone B write shares
// (ADR G01.03 §3.3: transaction ownership is this module's). Exported for the
// feedback repository/sync (G16.02) so their writes reuse the one idiom
// instead of pasting a second BEGIN/COMMIT variant (jscpd gate).
export function inTransaction<T>(driver: SqlDriver, body: () => T): T {
  driver.execSql('BEGIN IMMEDIATE');
  try {
    const result = body();
    driver.execSql('COMMIT');
    return result;
  } catch (error) {
    // The primary error below is what the caller must see; a failing
    // ROLLBACK means the connection is unusable anyway and the caller
    // discards it once open() throws.
    try {
      driver.execSql('ROLLBACK');
    } catch {
      /* secondary — reported through the primary error */
    }
    throw error;
  }
}

function readUserVersion(driver: SqlDriver): number {
  const row = driver.prepare('PRAGMA user_version').get();
  return row ? Number(row.user_version) : 0;
}

// Applies pending migration steps, one transaction per step (ADR G01.03
// §3.8). On a step failure the transaction rolls back — schema version and
// all rows stay at the previous state — and the open fails with
// 'migration-failed' diagnostics carrying the original error as cause.
// Reopening a store already at the latest version is a no-op.
export function openDatabase(driver: SqlDriver, steps: MigrationStep[] = migrationSteps): void {
  const current = readUserVersion(driver);
  const latest = steps.length > 0 ? steps[steps.length - 1]!.version : 0;
  if (current > latest) {
    throw new DbError(
      'schema-newer-than-code',
      `store schema version ${current} is newer than the code's latest migration ${latest}; downgrade is not supported`,
    );
  }
  for (const step of steps) {
    if (step.version <= current) continue;
    try {
      inTransaction(driver, () => {
        step.up(driver);
        driver.execSql(`PRAGMA user_version = ${step.version}`);
      });
    } catch (error) {
      throw new DbError(
        'migration-failed',
        `migration step ${step.version} failed; the store stays at version ${current} with its data intact`,
        { cause: error },
      );
    }
  }
}

// `09` §7: drop-and-recreate is allowed only for the derived zone, as this
// separate function that physically cannot see zone B tables — it references
// ZONE_A_TABLES/ZONE_A_DDL exclusively and the name-level guard in db.test.ts
// fails if a zone B name ever appears here.
export function rebuildDerived(driver: SqlDriver): void {
  inTransaction(driver, () => {
    for (const table of ZONE_A_TABLES) {
      driver.execSql(`DROP TABLE IF EXISTS ${table}`);
      driver.execSql(ZONE_A_DDL[table]);
    }
  });
}

type SessionDbRow = Record<string, SqlValue>;

// The single snake_case → camelCase mapping point (see types.ts header).
function toSessionRow(row: SessionDbRow): SessionRow {
  return {
    sessionId: String(row.session_id),
    routeId: String(row.route_id),
    version: String(row.version),
    locale: String(row.locale),
    tier: JSON.parse(String(row.tier)) as string[],
    state: String(row.state) as SessionState,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
    autoFired: JSON.parse(String(row.auto_fired)) as string[],
    heard: JSON.parse(String(row.heard)) as string[],
    lastStopId: row.last_stop_id === null || row.last_stop_id === undefined ? null : String(row.last_stop_id),
    playSeq: Number(row.play_seq),
  };
}

const SESSION_COLUMNS =
  'session_id, route_id, version, locale, tier, state, started_at, finished_at, auto_fired, heard, last_stop_id, play_seq';

function getSessionRow(driver: SqlDriver, sessionId: string): SessionDbRow | undefined {
  return driver.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE session_id = ?`).get(sessionId);
}

export function getSession(driver: SqlDriver, sessionId: string): SessionRow | null {
  const row = getSessionRow(driver, sessionId);
  return row ? toSessionRow(row) : null;
}

// The live session is the app-wide active/paused row (ADR G01.03 §3.1: no
// more than one across the whole app); finished rows are history.
export function getLiveSession(driver: SqlDriver): SessionRow | null {
  const row = driver
    .prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE state IN ('active', 'paused') LIMIT 1`)
    .get();
  return row ? toSessionRow(row) : null;
}

// My KUDY history read (G06.04): every session row of the app — the live
// walk (active/paused) beside the finished previous runs, newest first.
// Read-only: history is never deleted or overwritten (ADR §3.1).
export function listSessionHistory(driver: SqlDriver): SessionRow[] {
  return driver
    .prepare(`SELECT ${SESSION_COLUMNS} FROM session ORDER BY started_at DESC, session_id DESC`)
    .all()
    .map(toSessionRow);
}

// G22.06 (spec E6): My KUDY reads the completed history in bounded pages —
// the keyset cursor (started_at, session_id) walks `started_at DESC,
// session_id DESC`, the page never carries more than SESSION_HISTORY_PAGE_SIZE
// completed summaries and never touches an offset. The live walk is read in
// the same snapshot, separately from the completed rows (spec: «бягучая
// прагулка даступная асобна ад старонак завершанай гісторыі»). Full-history
// reads stay in listSessionHistory for the actual-progress uses.
// G22.06 names a malformed cursor 'history-page-invalid' — a bad key is a
// named diagnostic, never a wrong page or a crash (implementation-rules 14).
export const SESSION_HISTORY_PAGE_SIZE = 50;

const SESSION_SUMMARY_COLUMNS =
  'session_id, route_id, version, locale, state, started_at, finished_at, heard';

function toSessionHistorySummary(row: SessionDbRow): SessionHistorySummary {
  return {
    sessionId: String(row.session_id),
    routeId: String(row.route_id),
    version: String(row.version),
    locale: String(row.locale),
    state: String(row.state) as SessionState,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
    // Derived in the mapper, not in SQL: the summary needs only the count, and
    // JSON functions must not be assumed of the real target driver (spec E6
    // criterion 6). The array itself never leaves the store here.
    heardCount: (JSON.parse(String(row.heard)) as string[]).length,
  };
}

export function listSessionHistoryPage(
  driver: SqlDriver,
  cursor: SessionHistoryCursor | null,
): SessionHistoryPage {
  let cursorSql = '';
  const params: SqlValue[] = [];
  if (cursor !== null) {
    if (typeof cursor.sessionId !== 'string' || cursor.sessionId === '' || !Number.isSafeInteger(cursor.startedAt)) {
      throw new DbError(
        'history-page-invalid',
        `history page cursor must be a (startedAt safe integer, sessionId non-empty string) pair, got (${String(cursor.startedAt)}, ${String(cursor.sessionId)})`,
      );
    }
    cursorSql = ' AND (started_at < ? OR (started_at = ? AND session_id < ?))';
    params.push(cursor.startedAt, cursor.startedAt, cursor.sessionId);
  }
  // One snapshot for the live row and the page: a walk finishing between the
  // two reads must not surface twice (as the live walk and as a history row).
  return inTransaction(driver, () => {
    const live = getLiveSession(driver);
    const rows = driver
      .prepare(
        `SELECT ${SESSION_SUMMARY_COLUMNS} FROM session WHERE state = 'finished'${cursorSql}
         ORDER BY started_at DESC, session_id DESC LIMIT ?`,
      )
      .all(...params, SESSION_HISTORY_PAGE_SIZE)
      .map(toSessionHistorySummary);
    const last = rows[rows.length - 1];
    return {
      live,
      rows,
      // A full page carries the key of its last row even when the next page
      // comes back empty — the final empty page is how the walk ends (the
      // controller clears its load-more state on it, spec E6 criterion 4).
      nextCursor:
        rows.length === SESSION_HISTORY_PAGE_SIZE && last
          ? { startedAt: last.startedAt, sessionId: last.sessionId }
          : null,
    };
  });
}

// The deletion-guard read (G04.04.b, ADR G01.03 §3.4): every non-finished
// walk of this exact package version pins it against local deletion — a
// paused session from yesterday counts exactly like the live one, and
// finished rows are history that never blocks. Read-only: the guard never
// mutates zone B.
export function listUnfinishedSessions(driver: SqlDriver, routeId: string, version: string): SessionRow[] {
  return driver
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM session
       WHERE route_id = ? AND version = ? AND state <> 'finished'
       ORDER BY started_at`,
    )
    .all(routeId, version)
    .map(toSessionRow);
}

function insertSessionRow(driver: SqlDriver, input: SessionStartInput): void {
  driver
    .prepare(
      `INSERT INTO session (session_id, route_id, version, locale, tier, state, started_at, play_seq)
       VALUES (?, ?, ?, ?, ?, 'active', ?, 0)`,
    )
    .run(
      input.sessionId,
      input.routeId,
      input.version,
      input.locale,
      JSON.stringify(input.tier ?? ['base']),
      input.startedAt,
    );
}

// A second live row can only come from a concurrent winner (the pre-check
// above already handles the visible case); anything else is a write defect
// and gets its own rule instead of being mislabeled as a live conflict.
function insertSessionGuarded(driver: SqlDriver, input: SessionStartInput): void {
  try {
    insertSessionRow(driver, input);
  } catch (error) {
    if (error instanceof Error && error.message.includes('one_live_session')) {
      throw new DbError('live-session-exists', 'the one_live_session index rejected a second live row', {
        cause: error,
      });
    }
    throw new DbError('session-write-failed', `session insert failed for ${input.sessionId}`, { cause: error });
  }
}

function transferGuideHints(driver: SqlDriver, sessionId: string, guideIds: string[]): void {
  // ADR G01.03 §3.9: Start carries the current foreground window's shown/
  // dismissed guide_ids into session scope, so R07 does not repeat them at
  // once; they survive the session's restarts. Foreground rows are consumed
  // by the move; guide_hint_last keeps holding the cross-opening cooldown.
  const placeholders = guideIds.map(() => '?').join(', ');
  driver
    .prepare(
      `UPDATE guide_hint_state SET scope = 'session', session_id = ?
       WHERE scope = 'foreground' AND guide_id IN (${placeholders})`,
    )
    .run(sessionId, ...guideIds);
}

// A failing hint transfer (e.g. two foreground rows for one guide) must roll
// the whole Start/switch back and surface as a named rule, not a raw sqlite
// error.
function transferGuideHintsGuarded(driver: SqlDriver, sessionId: string, guideIds: string[]): void {
  try {
    transferGuideHints(driver, sessionId, guideIds);
  } catch (error) {
    throw new DbError('guide-hint-transfer-failed', `guide hint transfer for session ${sessionId} failed`, {
      cause: error,
    });
  }
}

// Start transaction (ADR G01.03 §3.3): INSERT of the new active row plus the
// R07 hint transfer, one transaction; effects (geofences, audio, wakelock)
// belong to the controller after commit. Conditions are checked before the
// transaction; a simultaneous second Start still falls to the
// one_live_session index and rolls back clean.
export function startSession(driver: SqlDriver, input: SessionStartInput): void {
  if (getLiveSession(driver) !== null) {
    throw new DbError('live-session-exists', 'another session is active or paused; finish or switch it first');
  }
  inTransaction(driver, () => {
    insertSessionGuarded(driver, input);
    if (input.carryGuideHints && input.carryGuideHints.length > 0) {
      transferGuideHintsGuarded(driver, input.sessionId, input.carryGuideHints);
    }
  });
}

function checkpointSets(driver: SqlDriver, sessionId: string, progress: SessionProgress): void {
  // Verbatim write of controller state (§3.3 checkpoint): monotonicity and
  // event ordering are the engine reducer's contract, not the store's.
  if (progress.autoFired !== undefined) {
    driver
      .prepare('UPDATE session SET auto_fired = ? WHERE session_id = ?')
      .run(JSON.stringify(progress.autoFired), sessionId);
  }
  if (progress.heard !== undefined) {
    driver
      .prepare('UPDATE session SET heard = ? WHERE session_id = ?')
      .run(JSON.stringify(progress.heard), sessionId);
  }
  if (progress.lastStopId !== undefined) {
    driver
      .prepare('UPDATE session SET last_stop_id = ? WHERE session_id = ?')
      .run(progress.lastStopId, sessionId);
  }
  if (progress.playSeq !== undefined) {
    driver
      .prepare('UPDATE session SET play_seq = ? WHERE session_id = ?')
      .run(progress.playSeq, sessionId);
  }
}

// Pause transaction (ADR G01.03 §3.3): UPDATE state='paused' plus the
// checkpoint of the sets in the same transaction.
export function pauseSession(driver: SqlDriver, sessionId: string, progress?: SessionProgress): void {
  const row = getSessionRow(driver, sessionId);
  if (!row) throw new DbError('session-not-found', `no session row ${sessionId}`);
  if (String(row.state) !== 'active') {
    throw new DbError('session-not-active', `session ${sessionId} is ${String(row.state)}, pause needs active`);
  }
  inTransaction(driver, () => {
    driver.prepare("UPDATE session SET state = 'paused' WHERE session_id = ?").run(sessionId);
    if (progress) checkpointSets(driver, sessionId, progress);
  });
}

// Resume transaction (ADR G01.03 §3.3): UPDATE state='active' only. Audio
// never restarts by itself after a restore — that is the controller's
// autoplay_suspended rule, not a store concern.
export function resumeSession(driver: SqlDriver, sessionId: string): void {
  const row = getSessionRow(driver, sessionId);
  if (!row) throw new DbError('session-not-found', `no session row ${sessionId}`);
  if (String(row.state) !== 'paused') {
    throw new DbError('session-not-paused', `session ${sessionId} is ${String(row.state)}, resume needs paused`);
  }
  inTransaction(driver, () => {
    driver.prepare("UPDATE session SET state = 'active' WHERE session_id = ?").run(sessionId);
  });
}

// End transaction (ADR G01.03 §3.3): UPDATE state='finished', finished_at and
// the final checkpoint, one transaction. Legal from active and paused alike.
export function finishSession(
  driver: SqlDriver,
  sessionId: string,
  input: { finishedAt: number; progress?: SessionProgress },
): void {
  const row = getSessionRow(driver, sessionId);
  if (!row) throw new DbError('session-not-found', `no session row ${sessionId}`);
  if (row.state !== 'active' && row.state !== 'paused') {
    throw new DbError('session-not-live', `session ${sessionId} is already finished`);
  }
  inTransaction(driver, () => {
    driver
      .prepare("UPDATE session SET state = 'finished', finished_at = ? WHERE session_id = ?")
      .run(input.finishedAt, sessionId);
    if (input.progress) checkpointSets(driver, sessionId, input.progress);
  });
}

// switch-guide transaction (ADR G01.03 §3.3): UPDATE of the old row to
// finished plus INSERT of the new row in one transaction; a failure rolls
// back both legs — the old session stays in its previous state, no half
// switch.
export function switchSession(
  driver: SqlDriver,
  oldSessionId: string,
  next: SessionStartInput,
  input: { finishedAt: number },
): void {
  const row = getSessionRow(driver, oldSessionId);
  if (!row) throw new DbError('session-not-found', `no session row ${oldSessionId}`);
  if (row.state !== 'active' && row.state !== 'paused') {
    throw new DbError('session-not-live', `session ${oldSessionId} is already finished`);
  }
  inTransaction(driver, () => {
    driver
      .prepare("UPDATE session SET state = 'finished', finished_at = ? WHERE session_id = ?")
      .run(input.finishedAt, oldSessionId);
    insertSessionGuarded(driver, next);
    if (next.carryGuideHints && next.carryGuideHints.length > 0) {
      transferGuideHintsGuarded(driver, next.sessionId, next.carryGuideHints);
    }
  });
}

// Checkpoint transaction (ADR G01.03 §3.3 PersistProgress): the controller
// issues it after every accepted mutating event; rewriting the same or a
// newer state is idempotent. A crash between an event and its checkpoint
// honestly loses that last fact — the store does not fabricate progress.
export function checkpointProgress(driver: SqlDriver, sessionId: string, progress: SessionProgress): void {
  const row = getSessionRow(driver, sessionId);
  if (!row) throw new DbError('session-not-found', `no session row ${sessionId}`);
  inTransaction(driver, () => {
    checkpointSets(driver, sessionId, progress);
  });
}

// `09` §10: client-generated event_id carries idempotency — a repeated send
// of the same event lands as one row (upsert targeted at event_id only, so
// malformed payloads still fail loudly instead of being silently ignored).
// G22.03: the row also gets its durable enqueue_seq key, allocated in this
// same transaction through the durable `event_queue_seq` counter; a duplicate event_id
// leaves a gap in the sequence — monotonic without reuse is the contract,
// gaps are free.
export function appendEvent(driver: SqlDriver, event: EventInput): void {
  inTransaction(driver, () => {
    driver
      .prepare(
        `INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent, enqueue_seq)
         VALUES (?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .run(event.eventId, event.type, event.at, event.schemaVersion, event.payload, allocateEnqueueSeq(driver));
  });
}

// G22.03 — the durable insertion key. The counter is the zone B singleton
// `event_queue_seq` (created by migration step 3): queue rows go away with
// clearDeviceAccountState, the counter does not — deletion never reuses an
// enqueue_seq, so a flush snapshot stays meaningful after an account clearing.
// Both readers answer with a named diagnostic when the counter row is
// missing or malformed, never with a guess.
function readEnqueueSeqCounter(driver: SqlDriver): number {
  const row = driver.prepare('SELECT next FROM event_queue_seq WHERE singleton = 1').get();
  const next = row === undefined ? null : Number(row.next);
  if (next === null || !Number.isSafeInteger(next) || next < 1) {
    throw new DbError(
      'event-seq-state-invalid',
      'event_queue_seq.next is missing or not a safe integer; the enqueue_seq counter is broken',
    );
  }
  return next;
}

// Allocates the next key; must run inside the caller's transaction (the
// appendEvent one) so the read and the bump cannot interleave.
function allocateEnqueueSeq(driver: SqlDriver): number {
  const next = readEnqueueSeqCounter(driver);
  driver
    .prepare('UPDATE event_queue_seq SET next = ? WHERE singleton = 1')
    .run(String(next + 1));
  return next;
}

// The last allocated enqueue_seq — the bound a flush freezes before its
// first page read (spec E3): events appended later carry keys above the
// bound and wait for the next flush, so an in-flight batch never grows.
export function latestEnqueueSeq(driver: SqlDriver): number {
  return readEnqueueSeqCounter(driver) - 1;
}

// G09.01: the pending tail of the queue in stable dispatch order — the
// event's own clock, event_id as the tie-break, so a restart cannot reorder
// the batch. Sent rows are never re-sent (09 §10: one event = one credit; a
// batch whose ack was lost resends with the same event_id and the server
// dedupes it).
// G22.03: the read is page-bounded — `page.limit` caps the rows per query
// and `page.upToSeq` freezes the enqueue_seq bound, so a flush never selects
// the whole unsent tail and rows appended mid-flush stay out of it. Bounds
// are validated numbers, never interpolated SQL; a malformed bound is a
// named diagnostic ('event-page-invalid'), not a crash or a wrong page.
function toEventQueueRow(row: Record<string, SqlValue>): EventQueueRow {
  return {
    eventId: String(row.event_id),
    type: String(row.type),
    at: Number(row.at),
    schemaVersion: Number(row.schema_version),
    payload: String(row.payload),
    enqueueSeq: Number(row.enqueue_seq),
    sent: Number(row.sent) === 1,
  };
}

export interface PendingEventsPage {
  /** Row cap per query (the flush page size). */
  limit?: number;
  /** Frozen enqueue_seq bound; rows keyed above it stay pending. */
  upToSeq?: number;
}

export function listPendingEvents(driver: SqlDriver, page?: PendingEventsPage): EventQueueRow[] {
  const conditions: string[] = ['sent = 0'];
  const params: SqlValue[] = [];
  if (page?.upToSeq !== undefined) {
    if (!Number.isSafeInteger(page.upToSeq) || page.upToSeq < 0) {
      throw new DbError(
        'event-page-invalid',
        `pending page upToSeq must be a non-negative safe integer, got ${String(page.upToSeq)}`,
      );
    }
    conditions.push('enqueue_seq <= ?');
    params.push(page.upToSeq);
  }
  let limitSql = '';
  if (page?.limit !== undefined) {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1) {
      throw new DbError(
        'event-page-invalid',
        `pending page limit must be a positive safe integer, got ${String(page.limit)}`,
      );
    }
    limitSql = ' LIMIT ?';
    params.push(page.limit);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return driver
    .prepare(
      `SELECT event_id, type, at, schema_version, payload, sent, enqueue_seq
       FROM event_queue${where}
       ORDER BY at, event_id${limitSql}`,
    )
    .all(...params)
    .map(toEventQueueRow);
}

// G09.04 diagnostics read: the full log window — sent and pending rows alike,
// the sent flag included so the report can name the server-visibility
// boundary. Read-only (the queue is never modified here); the window is
// inclusive on both ends and optional on either side, in the queue's stable
// dispatch order.
export interface EventWindow {
  from?: number;
  to?: number;
}

export function listEvents(driver: SqlDriver, window: EventWindow = {}): EventQueueRow[] {
  const conditions: string[] = [];
  const params: SqlValue[] = [];
  if (window.from !== undefined) {
    conditions.push('at >= ?');
    params.push(window.from);
  }
  if (window.to !== undefined) {
    conditions.push('at <= ?');
    params.push(window.to);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return driver
    .prepare(
      `SELECT event_id, type, at, schema_version, payload, sent, enqueue_seq
       FROM event_queue${where}
       ORDER BY at, event_id`,
    )
    .all(...params)
    .map(toEventQueueRow);
}

// One transaction marks the acknowledged batch; a crash before the commit
// leaves the rows pending and the next flush resends them unchanged. The
// sent = 0 guard keeps the return value the honest "marked now" count —
// SQLite would otherwise report a matched-but-already-marked row as changed.
export function markEventsSent(driver: SqlDriver, eventIds: string[]): number {
  if (eventIds.length === 0) return 0;
  return inTransaction(driver, () => {
    const placeholders = eventIds.map(() => '?').join(', ');
    const result = driver
      .prepare(`UPDATE event_queue SET sent = 1 WHERE event_id IN (${placeholders}) AND sent = 0`)
      .run(...eventIds);
    return Number(result.changes);
  });
}

export function setSetting(driver: SqlDriver, key: string, value: string): void {
  inTransaction(driver, () => {
    driver
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  });
}

export function getSetting(driver: SqlDriver, key: string): string | null {
  const row = driver.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? String(row.value) : null;
}

// `09` §7 zone B: the `device` table holds one row and only the device_id —
// the secret lives in expo-secure-store (services/device), never here.
export function setDeviceId(driver: SqlDriver, deviceId: string): void {
  inTransaction(driver, () => {
    driver
      .prepare(
        `INSERT INTO device (singleton, device_id) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET device_id = excluded.device_id`,
      )
      .run(deviceId);
  });
}

export function getDeviceId(driver: SqlDriver): string | null {
  const row = driver.prepare('SELECT device_id FROM device WHERE singleton = 1').get();
  return row ? String(row.device_id) : null;
}

// The durable `settings` key holding the analytics consent state (`09` §10:
// «Стан згоды — у settings»). The literal lives here — with the settings SQL
// — as the single definition; services/analytics reads and writes through it.
export const ANALYTICS_CONSENT_KEY = 'analytics_consent';

// G09.03 — the client half of device data deletion (09 §5): after the server
// answers, the device row, the local event queue, the feedback tables (`21`
// §6 — the old outbox never restores the server-side feedback) and the
// consent state go away in one transaction; the next identity starts from
// the "never asked" consent. Row-level deletes only: zone B tables and their
// DDL stay (schema.ts) — deletion is a data action, never a migration.
// Downloaded bundles (zone A) and run progress (`session`) are deliberately
// untouched (09 §5, `21` §6).
export function clearDeviceAccountState(driver: SqlDriver): void {
  inTransaction(driver, () => {
    driver.prepare('DELETE FROM event_queue').run();
    driver.prepare('DELETE FROM feedback_local').run();
    driver.prepare('DELETE FROM feedback_outbox').run();
    driver.prepare('DELETE FROM settings WHERE key = ?').run(ANALYTICS_CONSENT_KEY);
    driver.prepare('DELETE FROM device WHERE singleton = 1').run();
  });
}

// `09` §7 bundle_asset (zone A): the download channel's resume registry
// (G04.02.a). Rows are derived state — rebuilt by re-hashing what lies on
// disk; no zone B table is ever touched here.
export function upsertBundleAsset(driver: SqlDriver, row: BundleAssetRow): void {
  inTransaction(driver, () => {
    driver
      .prepare(
        `INSERT INTO bundle_asset (route_id, version, locale, tier, path, status, bytes_total, bytes_done, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(route_id, version, locale, tier, path) DO UPDATE SET
           status = excluded.status,
           bytes_total = excluded.bytes_total,
           bytes_done = excluded.bytes_done,
           sha256 = excluded.sha256`,
      )
      .run(
        row.routeId,
        row.version,
        row.locale,
        row.tier,
        row.path,
        row.status,
        row.bytesTotal,
        row.bytesDone,
        row.sha256,
      );
  });
}

// Rebuild write (G04.02.a criterion 5): one transaction drops the key's rows
// and inserts the re-hashed ones, so a rebuild never shows half the registry.
export function replaceBundleAssets(driver: SqlDriver, key: AssetKey, rows: BundleAssetRow[]): void {
  inTransaction(driver, () => {
    driver
      .prepare('DELETE FROM bundle_asset WHERE route_id = ? AND version = ? AND locale = ? AND tier = ?')
      .run(key.routeId, key.version, key.locale, key.tier);
    for (const row of rows) {
      driver
        .prepare(
          `INSERT INTO bundle_asset (route_id, version, locale, tier, path, status, bytes_total, bytes_done, sha256)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.routeId,
          row.version,
          row.locale,
          row.tier,
          row.path,
          row.status,
          row.bytesTotal,
          row.bytesDone,
          row.sha256,
        );
    }
  });
}

function toBundleAssetRow(row: Record<string, SqlValue>): BundleAssetRow {
  return {
    routeId: String(row.route_id),
    version: String(row.version),
    locale: String(row.locale),
    tier: String(row.tier),
    path: String(row.path),
    status: String(row.status) as BundleAssetStatus,
    bytesTotal: Number(row.bytes_total),
    bytesDone: Number(row.bytes_done),
    sha256: String(row.sha256),
  };
}

export function getBundleAssets(driver: SqlDriver, key: AssetKey): BundleAssetRow[] {
  return driver
    .prepare(
      `SELECT route_id, version, locale, tier, path, status, bytes_total, bytes_done, sha256
       FROM bundle_asset
       WHERE route_id = ? AND version = ? AND locale = ? AND tier = ?
       ORDER BY path`,
    )
    .all(key.routeId, key.version, key.locale, key.tier)
    .map(toBundleAssetRow);
}

// The whole package's registry rows (G04.04.b): a deletion removes every
// layer of route_id@version at once, so the key here is the package identity
// — locale and tier stay open. Zone A only; returns the removed row count.
export function deletePackageAssets(driver: SqlDriver, routeId: string, version: string): number {
  return inTransaction(driver, () => {
    const statement = driver.prepare('DELETE FROM bundle_asset WHERE route_id = ? AND version = ?');
    const result = statement.run(routeId, version);
    return Number(result.changes);
  });
}

// R07 hint records (ADR G01.03 §3.9, ADR G07.04 §5) — the nearby controller
// is the only writer (09 §20: «запіс толькі праз nearby controller»). A shown
// row per factually presented guide_id plus the guide_hint_last upsert that
// carries the cross-opening cooldown. The unique session-scope index is the
// durable backstop of the one-show-per-session limit: a repeat lands as a
// named write failure, never as a silent second row.
function guideHintRecordInputOrThrow(input: GuideHintRecordInput): void {
  if (input.guideIds.length === 0) {
    throw new DbError('guide-hint-input-invalid', 'a hint record needs at least one guide_id');
  }
  if (input.scope === 'session' && (input.sessionId === undefined || input.sessionId === '')) {
    throw new DbError('guide-hint-input-invalid', 'a session-scope hint record requires the session_id');
  }
}

export function recordGuideHintShown(driver: SqlDriver, input: GuideHintRecordInput): void {
  guideHintRecordInputOrThrow(input);
  inTransaction(driver, () => {
    try {
      for (const guideId of input.guideIds) {
        driver
          .prepare(
            'INSERT INTO guide_hint_state (scope, guide_id, session_id, shown_at) VALUES (?, ?, ?, ?)',
          )
          .run(input.scope, guideId, input.sessionId ?? null, input.at);
      }
    } catch (error) {
      throw new DbError('guide-hint-write-failed', `guide hint shown record failed (${String(input.scope)})`, {
        cause: error,
      });
    }
    for (const guideId of input.guideIds) {
      driver
        .prepare(
          `INSERT INTO guide_hint_last (guide_id, last_shown_at, last_dismissed_at)
           VALUES (?, ?, NULL)
           ON CONFLICT(guide_id) DO UPDATE SET last_shown_at = excluded.last_shown_at`,
        )
        .run(guideId, input.at);
    }
  });
}

export function recordGuideHintDismissed(driver: SqlDriver, input: GuideHintRecordInput): void {
  guideHintRecordInputOrThrow(input);
  inTransaction(driver, () => {
    // Only rows a shown record created may gain a dismissal — the limits are
    // facts of presentations (R07), a dismissal of a never-shown guide is a
    // caller defect, not data.
    const sessionClause = input.scope === 'session' ? ' AND session_id = ?' : '';
    const params: SqlValue[] =
      input.scope === 'session'
        ? [input.at, input.scope, ...input.guideIds, input.sessionId ?? null]
        : [input.at, input.scope, ...input.guideIds];
    let changes = 0;
    try {
      changes = Number(
        driver
          .prepare(
            `UPDATE guide_hint_state SET dismissed_at = ?
             WHERE scope = ? AND guide_id IN (${input.guideIds.map(() => '?').join(', ')})${sessionClause}`,
          )
          .run(...params).changes,
      );
    } catch (error) {
      throw new DbError('guide-hint-write-failed', 'guide hint dismissal record failed', { cause: error });
    }
    if (changes === 0) {
      throw new DbError('guide-hint-dismiss-unknown-guide', `no shown row to dismiss for ${String(input.guideIds.length)} guide_id(s)`);
    }
    for (const guideId of input.guideIds) {
      driver
        .prepare(
          `INSERT INTO guide_hint_last (guide_id, last_shown_at, last_dismissed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(guide_id) DO UPDATE SET last_dismissed_at = excluded.last_dismissed_at`,
        )
        .run(guideId, input.at, input.at);
    }
  });
}

export function listSessionGuideHints(driver: SqlDriver, sessionId: string): GuideHintStateRow[] {
  return driver
    .prepare(
      `SELECT guide_id, shown_at, dismissed_at FROM guide_hint_state
       WHERE scope = 'session' AND session_id = ? ORDER BY shown_at, guide_id`,
    )
    .all(sessionId)
    .map((row) => ({
      guideId: String(row.guide_id),
      shownAt: Number(row.shown_at),
      dismissedAt: row.dismissed_at === null ? null : Number(row.dismissed_at),
    }));
}

// The cross-opening cooldown set (ADR G07.04 §3: one foreground_cooldown_s
// for shown and dismissed): guide_ids whose last shown or dismissed fact is
// younger than the window. A guide outside the set is free in a new window.
export function listGuidesInHintCooldown(
  driver: SqlDriver,
  nowMs: number,
  cooldownMs: number,
): string[] {
  const cutoff = nowMs - cooldownMs;
  return driver
    .prepare(
      `SELECT guide_id FROM guide_hint_last
       WHERE last_shown_at > ? OR (last_dismissed_at IS NOT NULL AND last_dismissed_at > ?)
       ORDER BY guide_id`,
    )
    .all(cutoff, cutoff)
    .map((row) => String(row.guide_id));
}
