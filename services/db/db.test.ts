// G04.01 — acceptance suite for services/db (issue #59). Criteria:
// 1. rebuilding the cache never deletes session/settings/events;
// 2. a migration error does not wipe progress — the open fails with
//    diagnostics, version and rows stay put, partial DDL rolls back;
// 3. one unfinished (active/paused) session is enforced in a transaction —
//    by the pre-check, by the one_live_session index at the schema level,
//    and by the both-legs rollback of switch;
// 4. the G16.02 feedback durable tables survive a discovery-cache rebuild.
// Plus the TR-5 level-3 name guards: the zone A rebuild source physically
// names no zone B table, and the DDL/zone lists cannot drift apart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appendEvent,
  checkpointProgress,
  clearDeviceAccountState,
  DbError,
  finishSession,
  getBundleAssets,
  getDeviceId,
  getSession,
  getLiveSession,
  getSetting,
  latestEnqueueSeq,
  listGuidesInHintCooldown,
  listPendingEvents,
  listSessionGuideHints,
  listSessionHistory,
  listSessionHistoryPage,
  markEventsSent,
  openDatabase,
  pauseSession,
  rebuildDerived,
  recordGuideHintDismissed,
  recordGuideHintShown,
  replaceBundleAssets,
  resumeSession,
  setSetting,
  startSession,
  switchSession,
  upsertBundleAsset,
} from './db.ts';
import { INITIAL_SCHEMA_DDL, migrationSteps, ZONE_A_DDL, ZONE_A_TABLES, ZONE_B_DDL, ZONE_B_TABLES } from './schema.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from './test-fixture.ts';
import type { SessionHistoryCursor, SqlDriver } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function openFresh(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

function rowCount(driver: SqlDriver, table: string): number {
  return Number(driver.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
}

const START = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  routeId: 'gdansk-old-town',
  version: '2026-09-09.1',
  locale: 'be',
  startedAt: 1_700_000_000_000,
};

test('criterion 1: rebuildDerived keeps every durable row and recreates zone A empty', () => {
  const driver = openFresh();
  startSession(driver, START);
  checkpointProgress(driver, START.sessionId, { heard: ['story-1'], autoFired: ['stop-1'], playSeq: 3 });
  pauseSession(driver, START.sessionId);
  setSetting(driver, 'analytics_consent', 'granted');
  setSetting(driver, 'locale', 'be');
  appendEvent(driver, { eventId: 'evt-1', type: 'session_started', at: 1, schemaVersion: 1, payload: '{}' });
  driver
    .prepare("INSERT INTO guide_hint_state (scope, guide_id, session_id, shown_at) VALUES ('session', 'g1', ?, 5)")
    .run(START.sessionId);
  driver.prepare("INSERT INTO device (device_id) VALUES ('dev-1')").run();
  driver
    .prepare(
      "INSERT INTO bundle_asset (route_id, version, locale, tier, path, status, bytes_total, sha256) VALUES ('r', 'v', 'be', 'base', 'be/base/stops.json', 'complete', 10, 'abc')",
    )
    .run();
  driver.prepare("INSERT INTO catalog_cache (route_id, payload) VALUES ('r', '{}')").run();
  driver.prepare("INSERT INTO discovery_cache (cache_key, payload, updated_at) VALUES ('k', '{}', 1)").run();

  rebuildDerived(driver);

  const session = getSession(driver, START.sessionId);
  assert.ok(session);
  assert.equal(session.state, 'paused');
  assert.deepEqual(session.heard, ['story-1']);
  assert.deepEqual(session.autoFired, ['stop-1']);
  assert.equal(session.playSeq, 3);
  assert.equal(getSetting(driver, 'analytics_consent'), 'granted');
  assert.equal(rowCount(driver, 'event_queue'), 1);
  assert.equal(rowCount(driver, 'guide_hint_state'), 1);
  assert.equal(rowCount(driver, 'device'), 1);
  assert.equal(rowCount(driver, 'bundle_asset'), 0);
  assert.equal(rowCount(driver, 'catalog_cache'), 0);
  assert.equal(rowCount(driver, 'discovery_cache'), 0);
  // the rebuilt tables keep their contract shape — a row still fits
  driver
    .prepare(
      "INSERT INTO bundle_asset (route_id, version, locale, tier, path, status, bytes_total, sha256) VALUES ('r', 'v', 'be', 'base', 'p', 'partial', 10, 'abc')",
    )
    .run();
});

test('criterion 1: rebuild is repeatable and the second pass changes nothing durable', () => {
  const driver = openFresh();
  startSession(driver, START);
  rebuildDerived(driver);
  rebuildDerived(driver);
  assert.equal(rowCount(driver, 'session'), 1);
});

test('criterion 2: a failing migration rolls back its step, keeps version and rows, and names the failure', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver, [migrationSteps[0]!]);
  startSession(driver, START);
  const failingSteps = [
    migrationSteps[0]!,
    {
      version: 2,
      up: (step: SqlDriver) => {
        step.execSql('CREATE TABLE half_applied (id INTEGER)');
        throw new Error('boom');
      },
    },
  ];
  assert.throws(
    () => openDatabase(driver, failingSteps),
    (error: unknown) =>
      error instanceof DbError &&
      error.rule === 'migration-failed' &&
      error.message.includes('step 2') &&
      error.message.includes('stays at version 1') &&
      error.cause instanceof Error &&
      error.cause.message === 'boom',
  );
  assert.equal(Number(driver.prepare('PRAGMA user_version').get()!.user_version), 1);
  assert.ok(getSession(driver, START.sessionId));
  // transactional DDL: the half-applied step left no table behind
  assert.equal(driver.prepare("SELECT name FROM sqlite_master WHERE name = 'half_applied'").get(), undefined);
  // repairing the step and reopening migrates forward without touching rows
  const repaired = [
    migrationSteps[0]!,
    {
      version: 2,
      up: (step: SqlDriver) => {
        step.execSql('CREATE TABLE half_applied (id INTEGER)');
      },
    },
  ];
  openDatabase(driver, repaired);
  assert.equal(Number(driver.prepare('PRAGMA user_version').get()!.user_version), 2);
  assert.ok(getSession(driver, START.sessionId));
});

test('criterion 2: a store newer than the code fails the open with named diagnostics', () => {
  const driver = nodeSqliteDriver();
  driver.execSql(INITIAL_SCHEMA_DDL);
  driver.execSql('PRAGMA user_version = 5');
  assert.throws(
    () => openDatabase(driver),
    (error: unknown) =>
      error instanceof DbError &&
      error.rule === 'schema-newer-than-code' &&
      error.message.includes('newer than the code'),
  );
});

test('criterion 3: start writes the ADR §3.1 defaults and the row is live', () => {
  const driver = openFresh();
  startSession(driver, { ...START, tier: ['base'] });
  const live = getLiveSession(driver);
  assert.ok(live);
  assert.deepEqual(live.tier, ['base']);
  assert.deepEqual(live.autoFired, []);
  assert.deepEqual(live.heard, []);
  assert.equal(live.playSeq, 0);
  assert.equal(live.finishedAt, null);
  assert.equal(live.lastStopId, null);
});

// G06.04: the My KUDY read — the live walk beside the finished runs,
// newest first; history is never filtered away (ADR §3.1).
test('G06.04: listSessionHistory returns the live walk beside the finished runs, newest first', () => {
  const driver = openFresh();
  startSession(driver, { ...START, sessionId: 'a', startedAt: 1_000 });
  finishSession(driver, 'a', { finishedAt: 2_000 });
  startSession(driver, { ...START, sessionId: 'b', startedAt: 3_000 });
  finishSession(driver, 'b', { finishedAt: 4_000 });
  startSession(driver, { ...START, sessionId: 'c', startedAt: 5_000 });
  pauseSession(driver, 'c');

  const history = listSessionHistory(driver);
  assert.deepEqual(history.map((row) => row.sessionId), ['c', 'b', 'a']);
  assert.equal(history[0]?.state, 'paused'); // the live walk is on the list
  assert.equal(history[1]?.state, 'finished');
  assert.equal(history[2]?.finishedAt, 2_000);
});

test('criterion 3: a second Start is rejected and leaves exactly one live row', () => {
  const driver = openFresh();
  startSession(driver, START);
  assert.throws(
    () => startSession(driver, { ...START, sessionId: '22222222-2222-4222-8222-222222222222' }),
    (error: unknown) => error instanceof DbError && error.rule === 'live-session-exists',
  );
  assert.equal(rowCount(driver, 'session'), 1);
  assert.equal(getSession(driver, START.sessionId)?.state, 'active');
});

test('criterion 3: the one_live_session index enforces the invariant at the schema level', () => {
  const driver = openFresh();
  startSession(driver, START);
  assert.throws(
    () =>
      driver
        .prepare(
          "INSERT INTO session (session_id, route_id, version, locale, started_at) VALUES ('33333333-3333-4333-8333-333333333333', 'r', 'v', 'be', 1)",
        )
        .run(),
    /one_live_session/,
  );
  // finished rows do not compete: NULL keys do not conflict
  finishSession(driver, START.sessionId, { finishedAt: 2 });
  driver
    .prepare(
      "INSERT INTO session (session_id, route_id, version, locale, started_at) VALUES ('33333333-3333-4333-8333-333333333333', 'r', 'v', 'be', 1)",
    )
    .run();
  assert.equal(getLiveSession(driver)?.sessionId, '33333333-3333-4333-8333-333333333333');
});

test('criterion 3: pause, resume, finish follow the §3.3 boundaries and reject wrong states', () => {
  const driver = openFresh();
  startSession(driver, START);
  assert.throws(() => resumeSession(driver, START.sessionId), (error: unknown) => error instanceof DbError && error.rule === 'session-not-paused');
  pauseSession(driver, START.sessionId, { heard: ['s1'] });
  assert.equal(getSession(driver, START.sessionId)?.state, 'paused');
  assert.throws(() => pauseSession(driver, START.sessionId), (error: unknown) => error instanceof DbError && error.rule === 'session-not-active');
  resumeSession(driver, START.sessionId);
  assert.equal(getSession(driver, START.sessionId)?.state, 'active');
  finishSession(driver, START.sessionId, { finishedAt: 42, progress: { heard: ['s1', 's2'] } });
  const done = getSession(driver, START.sessionId);
  assert.equal(done?.state, 'finished');
  assert.equal(done?.finishedAt, 42);
  assert.deepEqual(done?.heard, ['s1', 's2']);
  assert.equal(getLiveSession(driver), null);
  assert.throws(() => finishSession(driver, START.sessionId, { finishedAt: 43 }), (error: unknown) => error instanceof DbError && error.rule === 'session-not-live');
});

test('criterion 3: switch finishes the old row and starts the new one in one transaction', () => {
  const driver = openFresh();
  startSession(driver, START);
  pauseSession(driver, START.sessionId);
  const nextId = '44444444-4444-4444-8444-444444444444';
  switchSession(
    driver,
    START.sessionId,
    { ...START, sessionId: nextId, routeId: 'gdansk-motte' },
    { finishedAt: 7 },
  );
  const oldRow = getSession(driver, START.sessionId);
  assert.equal(oldRow?.state, 'finished');
  assert.equal(oldRow?.finishedAt, 7);
  const newRow = getLiveSession(driver);
  assert.equal(newRow?.sessionId, nextId);
  assert.equal(newRow?.routeId, 'gdansk-motte');
  assert.equal(newRow?.state, 'active');
});

test('criterion 3: a failing switch insert rolls back both legs — the old row keeps its state', () => {
  const driver = openFresh();
  startSession(driver, START);
  pauseSession(driver, START.sessionId);
  // the INSERT leg fails after the UPDATE leg ran: reusing the old row's id
  // collides with the just-finished row — both legs must roll back (§3.3
  // switch: "адкат абодвух: старая сесія ў папярэднім стане, новай няма")
  assert.throws(
    () =>
      switchSession(
        driver,
        START.sessionId,
        { ...START, routeId: 'gdansk-motte' },
        { finishedAt: 9 },
      ),
    (error: unknown) => error instanceof DbError && error.rule === 'session-write-failed',
  );
  const oldRow = getSession(driver, START.sessionId);
  assert.equal(oldRow?.state, 'paused'); // the finished_update rolled back
  assert.equal(oldRow?.finishedAt, null);
  assert.equal(rowCount(driver, 'session'), 1);
});

test('criterion 3: a Start failing mid-transaction leaves no session row and no hint move', () => {
  const driver = openFresh();
  // two foreground rows for one guide: moving both into the session scope
  // violates the one-hint-per-session uniqueness after the INSERT leg ran
  driver
    .prepare("INSERT INTO guide_hint_state (scope, guide_id, shown_at) VALUES ('foreground', 'g1', 1)")
    .run();
  driver
    .prepare("INSERT INTO guide_hint_state (scope, guide_id, shown_at) VALUES ('foreground', 'g1', 2)")
    .run();
  assert.throws(
    () => startSession(driver, { ...START, carryGuideHints: ['g1'] }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-transfer-failed',
  );
  assert.equal(rowCount(driver, 'session'), 0);
  const hints = driver
    .prepare("SELECT scope, session_id FROM guide_hint_state ORDER BY shown_at")
    .all();
  assert.equal(hints.length, 2);
  assert.equal(String(hints[0]!.scope), 'foreground'); // the move rolled back
  assert.equal(hints[0]!.session_id, null);
});

test('criterion 3: checkpoint rewrites are idempotent and store verbatim controller state', () => {
  const driver = openFresh();
  startSession(driver, START);
  checkpointProgress(driver, START.sessionId, { heard: ['a'], lastStopId: 'stop-2', playSeq: 5 });
  checkpointProgress(driver, START.sessionId, { heard: ['a'], lastStopId: 'stop-2', playSeq: 5 });
  const row = getSession(driver, START.sessionId);
  assert.deepEqual(row?.heard, ['a']);
  assert.equal(row?.lastStopId, 'stop-2');
  assert.equal(row?.playSeq, 5);
  assert.throws(
    () => checkpointProgress(driver, 'no-such-session', { playSeq: 1 }),
    (error: unknown) => error instanceof DbError && error.rule === 'session-not-found',
  );
});

test('criterion 4: feedback durable rows survive the discovery-cache rebuild', () => {
  const driver = openFresh();
  driver
    .prepare("INSERT INTO feedback_local (target, revision, score, draft, state) VALUES ('guide:r:be', 2, 4, NULL, 'sent')")
    .run();
  driver
    .prepare(
      "INSERT INTO feedback_outbox (mutation_id, target, expected_revision, payload, disclosure_version, created_at, transport_state) VALUES ('m1', 'guide:r:be', 2, '{}', 'd1', 1, 'pending')",
    )
    .run();
  driver.prepare("INSERT INTO discovery_cache (cache_key, payload, updated_at) VALUES ('k', '{}', 1)").run();

  rebuildDerived(driver);

  assert.equal(rowCount(driver, 'feedback_local'), 1);
  assert.equal(rowCount(driver, 'feedback_outbox'), 1);
  assert.equal(rowCount(driver, 'discovery_cache'), 0);
  const local = driver.prepare('SELECT revision, score, state FROM feedback_local WHERE target = ?').get('guide:r:be');
  assert.equal(Number(local!.revision), 2);
  assert.equal(Number(local!.score), 4);
  assert.equal(String(local!.state), 'sent');
});

test('appendEvent: a repeated event_id lands once (09 §10 idempotency)', () => {
  const driver = openFresh();
  const event = { eventId: 'evt-dup', type: 'app_open', at: 1, schemaVersion: 1, payload: '{}' };
  appendEvent(driver, event);
  appendEvent(driver, event);
  assert.equal(rowCount(driver, 'event_queue'), 1);
  // the conflict target is event_id only — any other violation fails loudly
  assert.throws(() =>
    appendEvent(driver, { ...event, eventId: 'evt-bad', at: null as unknown as number }),
  );
  assert.equal(rowCount(driver, 'event_queue'), 1);
});

test('listPendingEvents: only unsent rows, stable order by at then event_id (G09.01)', () => {
  const driver = openFresh();
  appendEvent(driver, { eventId: 'evt-b', type: 'app_open', at: 2, schemaVersion: 1, payload: '{}' });
  appendEvent(driver, { eventId: 'evt-a', type: 'app_open', at: 2, schemaVersion: 1, payload: '{}' });
  appendEvent(driver, { eventId: 'evt-c', type: 'app_open', at: 1, schemaVersion: 1, payload: '{}' });
  assert.deepEqual(listPendingEvents(driver).map((row) => row.eventId), ['evt-c', 'evt-a', 'evt-b']);
  markEventsSent(driver, ['evt-a']);
  assert.deepEqual(listPendingEvents(driver).map((row) => row.eventId), ['evt-c', 'evt-b']);
  assert.ok(listPendingEvents(driver).every((row) => !row.sent));
});

test('markEventsSent: one honest changes count, re-marking is a no-op, empty batch wakes nothing (G09.01)', () => {
  const driver = openFresh();
  appendEvent(driver, { eventId: 'evt-x1', type: 'app_open', at: 1, schemaVersion: 1, payload: '{}' });
  assert.equal(markEventsSent(driver, ['evt-x1', 'evt-missing']), 1);
  assert.equal(markEventsSent(driver, ['evt-x1']), 0);
  assert.equal(markEventsSent(driver, []), 0);
  const stored = driver.prepare('SELECT sent FROM event_queue WHERE event_id = ?').get('evt-x1');
  assert.equal(Number(stored!.sent), 1);
});


// G22.03 (issue #608, spec E3) — the durable enqueue_seq key, the bounded
// pending read, and the in-place upgrade of an old file-backed store.

test('enqueue_seq survives account clearing and reopen, and keeps rising', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2203-'));
  const file = path.join(dir, 'events.db');
  try {
    let firstSeq: number;
    {
      const store = nodeSqliteFileDriver(file);
      openDatabase(store.driver);
      appendEvent(store.driver, { eventId: 'evt-g1', type: 'app_open', at: 10, schemaVersion: 1, payload: '{}' });
      firstSeq = listPendingEvents(store.driver)[0]!.enqueueSeq;
      clearDeviceAccountState(store.driver);
      assert.equal(listPendingEvents(store.driver).length, 0);
      appendEvent(store.driver, { eventId: 'evt-g2', type: 'app_open', at: 11, schemaVersion: 1, payload: '{}' });
      const afterClear = listPendingEvents(store.driver)[0]!.enqueueSeq;
      assert.ok(afterClear > firstSeq, 'the counter is not reset by clearDeviceAccountState');
      store.close();
    }
    {
      const store = nodeSqliteFileDriver(file);
      openDatabase(store.driver);
      appendEvent(store.driver, { eventId: 'evt-g3', type: 'app_open', at: 12, schemaVersion: 1, payload: '{}' });
      const rows = listPendingEvents(store.driver);
      assert.deepEqual(rows.map((row) => row.eventId), ['evt-g2', 'evt-g3']);
      assert.ok(rows[1]!.enqueueSeq > rows[0]!.enqueueSeq, 'keys stay monotonic across a reopen');
      assert.ok(rows[0]!.enqueueSeq > firstSeq, 'the counter survives the reopen');
      store.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an old file-backed store upgrades in place: rows keep payloads, keys backfill in dispatch order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2203-'));
  const file = path.join(dir, 'legacy.db');
  try {
    const legacy = nodeSqliteFileDriver(file);
    openDatabase(legacy.driver, migrationSteps.slice(0, 2));
    assert.equal(Number(legacy.driver.prepare('PRAGMA user_version').get()!.user_version), 2);
    // the v2 shape: no enqueue_seq column; straight SQL with an `at` tie and
    // rows inserted out of dispatch order, one of them already sent
    const seed = legacy.driver.prepare(
      'INSERT INTO event_queue (event_id, type, at, schema_version, payload, sent) VALUES (?, ?, ?, ?, ?, ?)',
    );
    seed.run('evt-o3', 'app_open', 3000, 1, '{}', 0);
    seed.run('evt-o1', 'app_open', 1000, 1, '{}', 0);
    seed.run('evt-o2', 'app_open', 2000, 1, '{}', 0);
    seed.run('evt-o2b', 'app_open', 2000, 1, '{}', 1);
    legacy.close();

    const upgraded = nodeSqliteFileDriver(file);
    openDatabase(upgraded.driver);
    assert.equal(Number(upgraded.driver.prepare('PRAGMA user_version').get()!.user_version), migrationSteps[migrationSteps.length - 1]!.version);
    const rows = upgraded.driver
      .prepare('SELECT event_id, enqueue_seq FROM event_queue ORDER BY enqueue_seq')
      .all();
    assert.deepEqual(
      rows.map((row) => String(row.event_id)),
      ['evt-o1', 'evt-o2', 'evt-o2b', 'evt-o3'],
      'the backfill follows the dispatch order (at, event_id), sent rows included',
    );
    assert.deepEqual(rows.map((row) => Number(row.enqueue_seq)), [1, 2, 3, 4]);
    appendEvent(upgraded.driver, { eventId: 'evt-new', type: 'app_open', at: 9000, schemaVersion: 1, payload: '{}' });
    const pending = listPendingEvents(upgraded.driver).map((row) => row.enqueueSeq);
    assert.deepEqual(pending, [1, 2, 4, 5], 'the seeded counter resumes past the backfill, the sent row stays out');
    upgraded.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the bounded pending read rejects malformed bounds with a named diagnostic', () => {
  const driver = openFresh();
  const bad: Array<{ limit?: number; upToSeq?: number }> = [
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: Number.NaN },
    { upToSeq: -1 },
    { upToSeq: 1.5 },
    { upToSeq: Number.NaN },
  ];
  for (const page of bad) {
    assert.throws(
      () => listPendingEvents(driver, page),
      (error: unknown) => error instanceof DbError && error.rule === 'event-page-invalid',
      `bounds ${JSON.stringify(page)} must answer with event-page-invalid`,
    );
  }
  assert.equal(listPendingEvents(driver, { limit: 10, upToSeq: 5 }).length, 0);
});

test('a broken enqueue_seq counter answers with a named diagnostic, never a guess', () => {
  const driver = openFresh();
  appendEvent(driver, { eventId: 'evt-c1', type: 'app_open', at: 1, schemaVersion: 1, payload: '{}' });
  driver.prepare('UPDATE event_queue_seq SET next = 0').run();
  assert.throws(
    () => latestEnqueueSeq(driver),
    (error: unknown) => error instanceof DbError && error.rule === 'event-seq-state-invalid',
  );
  driver.prepare('DELETE FROM event_queue_seq').run();
  assert.throws(
    () => appendEvent(driver, { eventId: 'evt-c2', type: 'app_open', at: 2, schemaVersion: 1, payload: '{}' }),
    (error: unknown) => error instanceof DbError && error.rule === 'event-seq-state-invalid',
  );
});

test('the bounded pending read plans over the partial index — no full tail read or sort', () => {
  const driver = openFresh();
  for (let i = 0; i < 600; i += 1) {
    appendEvent(driver, { eventId: `evt-p${i}`, type: 'app_open', at: 1000 + i, schemaVersion: 1, payload: '{}' });
  }
  // capture the SQL the real pending read issues, then plan it verbatim
  const captured: string[] = [];
  const wrapper: SqlDriver = {
    execSql: (sql) => driver.execSql(sql),
    prepare: (sql) => {
      if (sql.includes('FROM event_queue') && sql.includes('LIMIT ?')) captured.push(sql);
      return driver.prepare(sql);
    },
  };
  const page = listPendingEvents(wrapper, { limit: 256, upToSeq: 10_000 });
  assert.equal(page.length, 256);
  assert.equal(captured.length, 1, 'exactly one prepared pending query');
  const plan = driver
    .prepare(`EXPLAIN QUERY PLAN ${captured[0]}`)
    .all(10_000, 256)
    .map((row) => String(row.detail));
  assert.ok(
    plan.join('\n').includes('event_queue_pending_order'),
    `the plan must use the partial index, got: ${plan.join(' | ')}`,
  );
  assert.ok(plan.every((detail) => !detail.includes('TEMP B-TREE')), 'no temporary b-tree sort');
  // SQLite words a bounded index iteration "SCAN ... USING INDEX" — the early
  // stop at the page limit is what keeps the read bounded (the row counter in
  // eventLog.test.ts proves the ≤256-rows-per-query property), a bare table
  // read or a temp-b-tree sort are what this test must refuse.
  assert.ok(
    plan.every(
      (detail) => !detail.includes('SCAN event_queue') || detail.includes('USING INDEX event_queue_pending_order'),
    ),
    'every queue access goes through the partial index, never a bare table read',
  );
});

test('openDatabase: reopening a store already at the latest version is a no-op', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  startSession(driver, START);
  openDatabase(driver);
  assert.ok(getSession(driver, START.sessionId));
});

// G22.06 (issue #611, spec E6) — the bounded completed-history page read: the
// keyset cursor, the live walk beside the pages, and the in-place index
// migration. Measurements on synthetic sessions are labeled as measurements,
// not user-frequency claims.
// The page size is pinned as the literal 50 the spec fixes, never read from
// the code's constant — a bound that measures itself cannot fail on a revert.
const PAGE_SIZE = 50;

// Arrange-only seeding through straight SQL (implementation-rules 15): the
// reads under test stay the production path, the fixtures never pre-process
// their inputs.
function seedFinishedSessions(driver: SqlDriver, count: number, baseStartedAt: number): void {
  const insert = driver.prepare(
    "INSERT INTO session (session_id, route_id, version, locale, state, started_at, finished_at, heard) VALUES (?, ?, ?, ?, 'finished', ?, ?, ?)",
  );
  for (let i = 0; i < count; i += 1) {
    const startedAt = baseStartedAt + i;
    insert.run(
      `walk-${String(i).padStart(4, '0')}`,
      'route-page',
      '1',
      'be',
      startedAt,
      startedAt + 500,
      JSON.stringify(['story-1', 'story-2']),
    );
  }
}

// The measurement instrument for spec E6 criterion 1: counts the rows the
// history page reads actually return through the driver surface.
function countingHistoryDriver(driver: SqlDriver): { driver: SqlDriver; historyRowsRead: () => number } {
  let rowsRead = 0;
  const wrapped: SqlDriver = {
    execSql: (sql) => driver.execSql(sql),
    prepare: (sql) => {
      const statement = driver.prepare(sql);
      if (!sql.includes('FROM session')) return statement;
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => statement.get(...params),
        all: (...params) => {
          const rows = statement.all(...params);
          rowsRead += rows.length;
          return rows;
        },
      };
    },
  };
  return { driver: wrapped, historyRowsRead: () => rowsRead };
}

test('history_page_is_bounded: one page reads at most 50 completed summaries at 20/100/500 sessions', () => {
  for (const total of [20, 100, 500]) {
    const driver = openFresh();
    seedFinishedSessions(driver, total, 1_000_000);
    const counting = countingHistoryDriver(driver);
    const page = listSessionHistoryPage(counting.driver, null);
    // the measurement: whatever the history's size, one page read returns at
    // most the page size — 20 rows for 20 sessions, 50 for 100 and 500
    assert.equal(page.rows.length, Math.min(total, PAGE_SIZE), `first page at ${total} sessions`);
    assert.ok(
      counting.historyRowsRead() <= PAGE_SIZE,
      `one page read ${counting.historyRowsRead()} rows at ${total} sessions`,
    );
    // walking the cursor to the end reads every row exactly once — no offset
    // traversal, no duplicate, no loss
    const ids: string[] = [];
    let cursor: SessionHistoryCursor | null = null;
    let pages = 0;
    do {
      const walk = listSessionHistoryPage(counting.driver, cursor);
      pages += 1;
      ids.push(...walk.rows.map((row) => row.sessionId));
      cursor = walk.nextCursor;
    } while (cursor !== null);
    assert.equal(ids.length, total, `all rows across pages at ${total} sessions`);
    assert.equal(new Set(ids).size, total, `no duplicates across pages at ${total} sessions`);
    // an exact multiple of the page size ends the walk with one empty final
    // page — the cursor stays open after a full page and the next read closes it
    const exactMultiple = total % PAGE_SIZE === 0 ? 1 : 0;
    assert.equal(
      pages,
      Math.ceil(total / PAGE_SIZE) + exactMultiple,
      `page count at ${total} sessions`,
    );
    assert.deepEqual(ids, [...ids].sort((a, b) => b.localeCompare(a)), `page order kept at ${total} sessions`);
  }
});

test('live_session_is_visible_on_every_page: the live walk rides each page read, the completed pages stay clean', () => {
  const driver = openFresh();
  seedFinishedSessions(driver, 120, 1_000_000);
  startSession(driver, { ...START, sessionId: 'walk-live' });
  pauseSession(driver, 'walk-live');

  const first = listSessionHistoryPage(driver, null);
  assert.equal(first.live?.sessionId, 'walk-live');
  assert.equal(first.rows.length, PAGE_SIZE);
  const second = listSessionHistoryPage(driver, first.nextCursor);
  // the live walk is available separately on every page read, never inside
  // the completed rows
  assert.equal(second.live?.sessionId, 'walk-live');
  assert.ok(second.rows.every((row) => row.sessionId !== 'walk-live'));
  assert.ok(first.rows.every((row) => row.sessionId !== 'walk-live'));
  assert.equal(second.rows[0]!.heardCount, 2, 'the derived heard count matches the session data');
});

test('tied started_at rows keep the keyset stable, and the final empty page closes the walk', () => {
  const driver = openFresh();
  seedFinishedSessions(driver, 48, 1_000);
  // a tie at the page boundary: same started_at, distinct session_id — the
  // cursor carries both facts, so paging neither loses nor repeats the pair
  const tie = driver.prepare(
    "INSERT INTO session (session_id, route_id, version, locale, state, started_at, finished_at, heard) VALUES (?, ?, ?, ?, 'finished', ?, ?, ?)",
  );
  tie.run('tie-a', 'route-page', '1', 'be', 999, 1_499, '[]');
  tie.run('tie-b', 'route-page', '1', 'be', 999, 1_499, '[]');
  tie.run('zz-late', 'route-page', '1', 'be', 998, 1_498, '[]');

  const first = listSessionHistoryPage(driver, null);
  assert.equal(first.rows.length, PAGE_SIZE);
  assert.equal(first.rows[0]!.sessionId, 'walk-0047');
  assert.deepEqual(first.rows.slice(-2).map((row) => row.sessionId), ['tie-b', 'tie-a'], 'the tie orders by session_id DESC');
  assert.deepEqual(first.nextCursor, { startedAt: 999, sessionId: 'tie-a' });

  const second = listSessionHistoryPage(driver, first.nextCursor);
  assert.deepEqual(second.rows.map((row) => row.sessionId), ['zz-late'], 'the row below the tie lands on the next page once');
  assert.equal(second.nextCursor, null, 'the walk ends with an empty final page, not a lost row');
});

test('the history page read plans over the partial index — no full history read or sort', () => {
  const driver = openFresh();
  seedFinishedSessions(driver, 600, 1_000_000);
  // capture the SQL the real page read issues, then plan it verbatim
  const captured: string[] = [];
  const wrapper: SqlDriver = {
    execSql: (sql) => driver.execSql(sql),
    prepare: (sql) => {
      if (sql.includes('FROM session') && sql.includes('LIMIT ?')) captured.push(sql);
      return driver.prepare(sql);
    },
  };
  const page = listSessionHistoryPage(wrapper, null);
  assert.equal(page.rows.length, PAGE_SIZE);
  assert.equal(captured.length, 1, 'exactly one prepared history query');
  const plan = driver
    .prepare(`EXPLAIN QUERY PLAN ${captured[0]}`)
    .all(PAGE_SIZE)
    .map((row) => String(row.detail));
  assert.ok(
    plan.join('\n').includes('session_history_order'),
    `the plan must use the partial index, got: ${plan.join(' | ')}`,
  );
  assert.ok(plan.every((detail) => !detail.includes('TEMP B-TREE')), 'no temporary b-tree sort');
  assert.ok(
    plan.every((detail) => !detail.includes('SCAN session') || detail.includes('USING INDEX session_history_order')),
    'every history access goes through the partial index, never a bare table read',
  );
  // the cursor page keeps the row bound whatever plan the OR predicate picks
  const second = listSessionHistoryPage(wrapper, { startedAt: 1_000_049, sessionId: 'walk-0049' });
  assert.ok(second.rows.length <= PAGE_SIZE);
});

test('the history page cursor is validated with a named diagnostic, never a wrong page', () => {
  const driver = openFresh();
  seedFinishedSessions(driver, 3, 1_000);
  const bad: Array<SessionHistoryCursor> = [
    { startedAt: Number.NaN, sessionId: 'walk-0001' },
    { startedAt: 1.5, sessionId: 'walk-0001' },
    { startedAt: Number.POSITIVE_INFINITY, sessionId: 'walk-0001' },
    { startedAt: 1_000, sessionId: '' },
  ];
  for (const cursor of bad) {
    assert.throws(
      () => listSessionHistoryPage(driver, cursor),
      (error: unknown) => error instanceof DbError && error.rule === 'history-page-invalid',
      `cursor ${JSON.stringify(cursor)} must answer with history-page-invalid`,
    );
  }
  const nonString = { startedAt: 1_000, sessionId: 5 } as unknown as SessionHistoryCursor;
  assert.throws(
    () => listSessionHistoryPage(driver, nonString),
    (error: unknown) => error instanceof DbError && error.rule === 'history-page-invalid',
  );
  assert.equal(listSessionHistoryPage(driver, null).rows.length, 3, 'a null cursor opens the first page');
});

test('an old file-backed store gains the history order in place: rows and counts stay untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2206-'));
  const file = path.join(dir, 'history.db');
  try {
    let snapshot: ReturnType<typeof listSessionHistory>;
    {
      const legacy = nodeSqliteFileDriver(file);
      openDatabase(legacy.driver, migrationSteps.slice(0, 3));
      assert.equal(Number(legacy.driver.prepare('PRAGMA user_version').get()!.user_version), 3);
      for (let i = 0; i < 3; i += 1) {
        startSession(legacy.driver, { ...START, sessionId: `walk-done-${i}`, startedAt: 1_000 + i });
        checkpointProgress(legacy.driver, `walk-done-${i}`, { heard: ['story-1', 'story-2', 'story-3'] });
        finishSession(legacy.driver, `walk-done-${i}`, { finishedAt: 2_000 + i });
      }
      // the live walk starts last — the one_live_session rule allows exactly
      // one active/paused row, and the snapshot keeps it beside the finished
      startSession(legacy.driver, { ...START, sessionId: 'walk-live-1', startedAt: 5_000 });
      pauseSession(legacy.driver, 'walk-live-1');
      snapshot = listSessionHistory(legacy.driver);
      legacy.close();
    }
    {
      const upgraded = nodeSqliteFileDriver(file);
      openDatabase(upgraded.driver);
      assert.equal(Number(upgraded.driver.prepare('PRAGMA user_version').get()!.user_version), 4);
      const index = upgraded.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'session_history_order'")
        .get();
      assert.ok(index, 'the history order index exists after the in-place migration');
      // the stored progress survives the index migration unchanged
      assert.deepEqual(listSessionHistory(upgraded.driver), snapshot);
      // the summary projection matches the actual session data
      const page = listSessionHistoryPage(upgraded.driver, null);
      assert.deepEqual(
        page.rows.map((row) => [row.sessionId, row.startedAt, row.heardCount]),
        snapshot
          .filter((row) => row.state === 'finished')
          .map((row) => [row.sessionId, row.startedAt, row.heard.length]),
      );
      assert.equal(page.live?.sessionId, 'walk-live-1');
      // reopening a store already at the latest version changes nothing
      openDatabase(upgraded.driver);
      assert.deepEqual(listSessionHistory(upgraded.driver), snapshot);
      upgraded.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zone guards: the two zone lists cannot drift, and rebuildDerived names no zone B table', () => {
  // TR-5 level 3 (docs/architecture/23_technical_remarks.md): behavioral
  // tests above pin what the zones DO; these pin what the rebuild is
  // physically allowed to name (`09` §7: "асобная функцыя, якая фізічна не
  // бачыць табліц зоны B").
  const zoneA = new Set<string>(ZONE_A_TABLES);
  const zoneB = new Set<string>(ZONE_B_TABLES);
  for (const table of zoneA) assert.ok(!zoneB.has(table), `${table} is in both zone lists`);

  const ddlTables = (ddl: Record<string, string>): string[] =>
    Object.values(ddl).flatMap((sql) => [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]!));
  assert.deepEqual(ddlTables(ZONE_A_DDL).sort(), [...zoneA].sort());
  assert.deepEqual(ddlTables(ZONE_B_DDL).sort(), [...zoneB].sort());

  const dbSource = fs.readFileSync(path.join(here, 'db.ts'), 'utf8');
  const rebuildBody = dbSource.slice(
    dbSource.indexOf('export function rebuildDerived'),
    dbSource.indexOf('type SessionDbRow'),
  );
  assert.ok(rebuildBody.includes('ZONE_A_TABLES'), 'guard reads the real rebuild body');
  for (const table of zoneB) {
    assert.ok(!new RegExp(`\\b${table}\\b`).test(rebuildBody), `rebuildDerived must not name the zone B table ${table}`);
  }

  // openDatabase applies steps in order and takes the newest as the latest —
  // keep the step list strictly increasing
  let previous = 0;
  for (const step of migrationSteps) {
    assert.ok(step.version > previous, 'migration versions must strictly increase');
    previous = step.version;
  }
});

// G04.02.a — the bundle_asset public API the download channel drives (zone A
// only; the activation semantics live in services/download/download.test.ts,
// these pin the store contract itself).
const ASSET_KEY = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };

test('bundle_asset: upsert writes one row per path and updates it on conflict', () => {
  const driver = openFresh();
  upsertBundleAsset(driver, { ...ASSET_KEY, path: 'stops.json', status: 'pending', bytesTotal: 10, bytesDone: 0, sha256: 'aa' });
  upsertBundleAsset(driver, { ...ASSET_KEY, path: 'stops.json', status: 'complete', bytesTotal: 10, bytesDone: 10, sha256: 'bb' });
  const rows = getBundleAssets(driver, ASSET_KEY);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    tier: 'base',
    path: 'stops.json',
    status: 'complete',
    bytesTotal: 10,
    bytesDone: 10,
    sha256: 'bb',
  });
});

test('bundle_asset: replaceBundleAssets rewrites exactly one key and leaves the rest', () => {
  const driver = openFresh();
  upsertBundleAsset(driver, { ...ASSET_KEY, path: 'stops.json', status: 'complete', bytesTotal: 5, bytesDone: 5, sha256: 'aa' });
  upsertBundleAsset(driver, { ...ASSET_KEY, path: 'audio/s.m4a', status: 'partial', bytesTotal: 9, bytesDone: 3, sha256: 'bb' });
  const otherKey = { ...ASSET_KEY, tier: 'extended' };
  upsertBundleAsset(driver, { ...otherKey, path: 'stops.json', status: 'complete', bytesTotal: 7, bytesDone: 7, sha256: 'cc' });

  replaceBundleAssets(driver, ASSET_KEY, [
    { ...ASSET_KEY, path: 'stops.json', status: 'complete', bytesTotal: 5, bytesDone: 5, sha256: 'dd' },
  ]);
  assert.deepEqual(
    getBundleAssets(driver, ASSET_KEY).map((row) => [row.path, row.status, row.sha256]),
    [['stops.json', 'complete', 'dd']],
  );
  assert.equal(getBundleAssets(driver, otherKey).length, 1);
  // The bundle_asset API stays inside the derived zone: the rebuild drops
  // every zone A row, and the durable session row survives it untouched.
  startSession(driver, {
    sessionId: '22222222-2222-4222-8222-222222222222',
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    startedAt: 1_700_000_000_001,
  });
  assert.notEqual(getLiveSession(driver), null);
  rebuildDerived(driver);
  assert.deepEqual(getBundleAssets(driver, otherKey).map((row) => [row.path, row.status]), []);
  const live = getLiveSession(driver);
  assert.notEqual(live, null);
  assert.equal(live?.sessionId, '22222222-2222-4222-8222-222222222222');
});

// G07.05 — the R07 hint records (ADR G01.03 §3.9 tables, ADR G07.04 §5): the
// nearby controller is the only writer, the unique session-scope index is the
// durable backstop of the one-show-per-session limit, and guide_hint_last
// carries the cross-opening cooldown for shown and dismissed alike.
test('G07.05: a shown record writes the scope row and the cooldown carrier; the session index is the backstop', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  recordGuideHintShown(driver, { guideIds: ['g1', 'g2'], scope: 'foreground', at: 1_000 });
  recordGuideHintShown(driver, { guideIds: ['g1'], scope: 'session', sessionId: 's1', at: 2_000 });
  assert.deepEqual(
    listSessionGuideHints(driver, 's1').map((row) => row.guideId),
    ['g1'],
  );
  assert.deepEqual(
    driver.prepare(`SELECT guide_id, shown_at FROM guide_hint_state WHERE scope = 'foreground' ORDER BY guide_id`).all()
      .map((row) => [String(row.guide_id), Number(row.shown_at)]),
    [['g1', 1_000], ['g2', 1_000]],
  );
  // The second show of the same guide in the same session trips the unique
  // index — the named write failure, never a silent second row.
  assert.throws(
    () => recordGuideHintShown(driver, { guideIds: ['g1'], scope: 'session', sessionId: 's1', at: 3_000 }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-write-failed',
  );
  // The cooldown carrier holds the newest shown fact per guide.
  assert.deepEqual(
    listGuidesInHintCooldown(driver, 2_000, 10_000).map((guideId) => guideId),
    ['g1', 'g2'],
  );
});

test('G07.05: a dismissal updates only an existing shown row and stamps the cooldown carrier', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  assert.throws(
    () => recordGuideHintDismissed(driver, { guideIds: ['g1'], scope: 'foreground', at: 1_000 }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-dismiss-unknown-guide',
  );
  recordGuideHintShown(driver, { guideIds: ['g1'], scope: 'foreground', at: 1_000 });
  recordGuideHintDismissed(driver, { guideIds: ['g1'], scope: 'foreground', at: 5_000 });
  assert.deepEqual(
    listSessionGuideHints(driver, 's1'),
    [],
  );
  const row = driver.prepare(`SELECT dismissed_at FROM guide_hint_state WHERE guide_id = 'g1'`).all()[0];
  assert.equal(Number(row?.dismissed_at), 5_000);
  assert.equal(
    Number(driver.prepare(`SELECT last_dismissed_at FROM guide_hint_last WHERE guide_id = 'g1'`).all()[0]?.last_dismissed_at),
    5_000,
  );
  // The dismissal rides the same cooldown as the show (ADR G07.04 §3).
  assert.deepEqual(listGuidesInHintCooldown(driver, 6_000, 10_000), ['g1']);
  assert.deepEqual(listGuidesInHintCooldown(driver, 16_000, 10_000), []);
});

test('G07.05: the cooldown boundary is exclusive — a guide at exactly the window edge is free', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  recordGuideHintShown(driver, { guideIds: ['g1'], scope: 'foreground', at: 1_000 });
  // shown 1_000 + cooldown 1_000 → free again at 2_000, blocked at 1_999.
  assert.deepEqual(listGuidesInHintCooldown(driver, 1_999, 1_000), ['g1']);
  assert.deepEqual(listGuidesInHintCooldown(driver, 2_000, 1_000), []);
});

test('G07.05: invalid hint records answer with named rules, not crashes or rows', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  assert.throws(
    () => recordGuideHintShown(driver, { guideIds: [], scope: 'foreground', at: 1 }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-input-invalid',
  );
  assert.throws(
    () => recordGuideHintShown(driver, { guideIds: ['g1'], scope: 'session', at: 1 }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-input-invalid',
  );
  assert.throws(
    () => recordGuideHintDismissed(driver, { guideIds: ['g1'], scope: 'session', sessionId: 's1', at: 1 }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-dismiss-unknown-guide',
  );
  assert.deepEqual(driver.prepare('SELECT COUNT(*) AS n FROM guide_hint_state').all()[0]?.n, 0);
});
