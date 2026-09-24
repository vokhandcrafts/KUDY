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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appendEvent,
  checkpointProgress,
  DbError,
  finishSession,
  getBundleAssets,
  getSession,
  getLiveSession,
  getSetting,
  openDatabase,
  pauseSession,
  rebuildDerived,
  replaceBundleAssets,
  resumeSession,
  setSetting,
  startSession,
  switchSession,
  upsertBundleAsset,
} from './db.ts';
import { INITIAL_SCHEMA_DDL, migrationSteps, ZONE_A_DDL, ZONE_A_TABLES, ZONE_B_DDL, ZONE_B_TABLES } from './schema.ts';
import { nodeSqliteDriver } from './test-fixture.ts';
import type { SqlDriver } from './types.ts';

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

test('openDatabase: reopening a store already at the latest version is a no-op', () => {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  startSession(driver, START);
  openDatabase(driver);
  assert.ok(getSession(driver, START.sessionId));
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
