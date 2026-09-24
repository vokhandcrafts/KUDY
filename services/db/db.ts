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
  SessionProgress,
  SessionRow,
  SessionStartInput,
  SessionState,
  SqlDriver,
  SqlValue,
} from './types.ts';

// Named failure rules surface as diagnostics, not crashes (each rule is
// asserted by a test): 'migration-failed', 'schema-newer-than-code',
// 'live-session-exists', 'session-write-failed', 'guide-hint-transfer-failed',
// 'session-not-found', 'session-not-active', 'session-not-paused',
// 'session-not-live'.
export class DbError extends Error {
  rule: string;

  constructor(rule: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DbError';
    this.rule = rule;
  }
}

function inTransaction<T>(driver: SqlDriver, body: () => T): T {
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
export function appendEvent(driver: SqlDriver, event: EventInput): void {
  inTransaction(driver, () => {
    driver
      .prepare(
        `INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .run(event.eventId, event.type, event.at, event.schemaVersion, event.payload);
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
