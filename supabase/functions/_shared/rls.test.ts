// G08.01 — RLS guard + behavioral proof on a real Postgres (PGlite,
// in-process WASM — no Docker). Deny-by-default contract of
// docs/architecture/09 §4: the anon client cannot see or write device rows
// even when a grant is re-added (RLS), the service role (Edge Functions)
// writes through, device delete cascades, and the rate counter table bumps
// per (ip_hash, window_start). Reverting the migration's RLS/REVOKE lines
// fails the guards and the behavior tests (implementation-rules 1).
//
// Shape notes: every executed statement is a literal without placeholders —
// Postgres generates all values itself (gen_random_uuid, md5(random()),
// jsonb_build_object, make_interval), so no JS-side value ever reaches SQL.
// The event_log row reuses the seeded device's own columns for its text and
// jsonb fields: these tests prove FK/RLS/cascade semantics, not content.
// MIGRATION_STEPS is the single copy of the statements; the sync guard
// replays it into a recording runner and compares against the committed
// supabase/migrations/20260922120000_device_tables_rls.sql file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

const migrationFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'migrations', '20260922120000_device_tables_rls.sql',
);

interface MinimalSqlRunner {
  query(sql: string): Promise<unknown>;
}

const ROLE_STEPS: Array<(db: MinimalSqlRunner) => Promise<unknown>> = [
  (db) => db.query('create role anon nologin'),
  (db) => db.query('create role authenticated nologin'),
  (db) => db.query('create role service_role nologin bypassrls'),
];

const MIGRATION_STEPS: Array<(db: MinimalSqlRunner) => Promise<unknown>> = [
  (db) => db.query('create table devices ( device_id uuid primary key, secret_hash text not null unique, created_at timestamptz not null default now() )'),
  (db) => db.query('create table entitlement_cache ( device_id uuid not null references devices (device_id) on delete cascade, route_id text not null, tier text not null, payload jsonb not null, expires_at timestamptz not null, primary key (device_id, route_id, tier) )'),
  (db) => db.query('create table event_log ( event_id uuid primary key, device_id uuid not null references devices (device_id) on delete cascade, type text not null, at timestamptz not null, payload jsonb not null )'),
  (db) => db.query('create table device_registration_rate ( ip_hash text not null, window_start timestamptz not null, attempts integer not null default 0, primary key (ip_hash, window_start) )'),
  (db) => db.query('alter table devices enable row level security'),
  (db) => db.query('alter table entitlement_cache enable row level security'),
  (db) => db.query('alter table event_log enable row level security'),
  (db) => db.query('alter table device_registration_rate enable row level security'),
  (db) => db.query('revoke all on devices from anon, authenticated'),
  (db) => db.query('revoke all on entitlement_cache from anon, authenticated'),
  (db) => db.query('revoke all on event_log from anon, authenticated'),
  (db) => db.query('revoke all on device_registration_rate from anon, authenticated'),
  (db) => db.query('grant select, insert, update, delete on devices to service_role'),
  (db) => db.query('grant select, insert, update, delete on entitlement_cache to service_role'),
  (db) => db.query('grant select, insert, update, delete on event_log to service_role'),
  (db) => db.query('grant select, insert, update, delete on device_registration_rate to service_role'),
];

class RecordingRunner implements MinimalSqlRunner {
  readonly statements: string[] = [];
  query(sql: string): Promise<unknown> {
    this.statements.push(sql);
    return Promise.resolve([]);
  }
}

function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;\s*$/, '');
}

async function applyMigration(db: MinimalSqlRunner): Promise<void> {
  for (const step of ROLE_STEPS) await step(db);
  for (const step of MIGRATION_STEPS) await step(db);
}

test('guard: migration steps stay in sync with the committed migration file', async () => {
  const recording = new RecordingRunner();
  for (const step of MIGRATION_STEPS) await step(recording);
  const fileSql = normalize(readFileSync(migrationFile, 'utf8'));
  const stepsSql = normalize(recording.statements.join(';\n'));
  assert.equal(stepsSql, fileSql, 'MIGRATION_STEPS must mirror supabase/migrations/*.sql');
});

test('guard: every server table is RLS-enabled, revoked from clients, granted to service_role', () => {
  const recording = new RecordingRunner();
  for (const step of MIGRATION_STEPS) void step(recording);
  for (const table of ['devices', 'entitlement_cache', 'event_log', 'device_registration_rate']) {
    assert.ok(
      recording.statements.some((s) => s === `alter table ${table} enable row level security`),
      `${table} must enable row level security`,
    );
    assert.ok(
      recording.statements.some((s) => s === `revoke all on ${table} from anon, authenticated`),
      `${table} must be revoked from anon/authenticated`,
    );
    assert.ok(
      recording.statements.some((s) => s === `grant select, insert, update, delete on ${table} to service_role`),
      `${table} must be granted to service_role`,
    );
  }
});

test('guard: cascade deletes are declared on both device-owned tables', () => {
  const recording = new RecordingRunner();
  for (const step of MIGRATION_STEPS) void step(recording);
  for (const table of ['entitlement_cache', 'event_log']) {
    const create = recording.statements.find((s) => s.startsWith(`create table ${table} `));
    assert.ok(create, `${table} must exist in the migration`);
    assert.match(
      create!,
      /references devices \(device_id\) on delete cascade/,
      `${table} must cascade on device delete (09 §5)`,
    );
  }
});

test('guard: nothing is granted to anon or authenticated anywhere in the migration', () => {
  const recording = new RecordingRunner();
  for (const step of MIGRATION_STEPS) void step(recording);
  const granting = recording.statements.filter((s) => /grant\b/i.test(s) && /\b(anon|authenticated)\b/i.test(s));
  assert.deepEqual(granting, [], 'no table may be granted to anon/authenticated (deny-by-default)');
});

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await applyMigration(db);
  return db;
}

test('anon is denied outright without grants (REVOKE layer)', async () => {
  const db = await freshDatabase();
  await db.query('set role anon');
  await assert.rejects(db.query('select * from devices'), /permission denied/i);
  await assert.rejects(db.query('select * from event_log'), /permission denied/i);
});

test('RLS hides devices from anon even when a grant is re-added', async () => {
  const db = await freshDatabase();
  await db.query('set role service_role');
  await db.query('insert into devices (device_id, secret_hash) values (gen_random_uuid(), md5(random()::text))');
  await db.query('reset role');

  await db.query('grant select, insert on devices to anon');
  await db.query('set role anon');
  const visible = await db.query('select count(*)::int as count from devices');
  assert.equal(visible.rows[0]?.count, 0, 'rows must be invisible under RLS with no policy');
  await assert.rejects(
    db.query('insert into devices (device_id, secret_hash) values (gen_random_uuid(), md5(random()::text))'),
    /row-level security/i,
  );
});

test('authenticated cannot read the rate counter or write the event log', async () => {
  const db = await freshDatabase();
  await db.query('set role authenticated');
  await assert.rejects(db.query('select * from device_registration_rate'), /permission denied/i);
  await assert.rejects(
    db.query('insert into event_log (event_id, device_id, type, at, payload) values (gen_random_uuid(), gen_random_uuid(), md5(random()::text), now(), jsonb_build_object())'),
    /permission denied/i,
  );
});

test('service role writes through; device delete cascades to cache and events', async () => {
  const db = await freshDatabase();
  await db.query('set role service_role');
  await db.query('insert into devices (device_id, secret_hash) values (gen_random_uuid(), md5(random()::text))');
  // event_log.type and payload reuse the seeded row's own columns (or an
  // empty jsonb) — the assertions prove FK/RLS/cascade semantics only.
  await db.query('insert into event_log (event_id, device_id, type, at, payload) select gen_random_uuid(), device_id, secret_hash, now(), jsonb_build_object() from devices');
  await db.query("insert into entitlement_cache (device_id, route_id, tier, payload, expires_at) select device_id, secret_hash, secret_hash, jsonb_build_object(), now() + make_interval(hours => 24) from devices");

  const fresh = await db.query('select count(*)::int as count from entitlement_cache where expires_at > now()');
  assert.equal(fresh.rows[0]?.count, 1);

  await db.query('delete from devices');
  const events = await db.query('select count(*)::int as count from event_log');
  const cache = await db.query('select count(*)::int as count from entitlement_cache');
  assert.equal(events.rows[0]?.count, 0, 'event_log must cascade on device delete (09 §5)');
  assert.equal(cache.rows[0]?.count, 0, 'entitlement_cache must cascade on device delete (09 §5)');
});

test('rate counter table bumps attempts per (ip_hash, window_start)', async () => {
  const db = await freshDatabase();
  await db.query('insert into device_registration_rate (ip_hash, window_start, attempts) values (md5(random()::text), to_timestamp(1700000000), 1)');
  await db.query('update device_registration_rate set attempts = attempts + 1');
  const attempts = await db.query('select attempts from device_registration_rate');
  assert.equal(attempts.rows.length, 1);
  assert.equal(attempts.rows[0]?.attempts, 2);
});
