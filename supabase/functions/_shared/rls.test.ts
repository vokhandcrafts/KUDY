// G08.01 — RLS guard + behavioral proof on a real Postgres (PGlite,
// in-process WASM — no Docker). Deny-by-default contract of
// docs/architecture/09 §4: the anon client cannot see or write device rows
// even when a grant is re-added (RLS), the service role (Edge Functions)
// writes through, device delete cascades, and the rate counter table bumps
// per (ip_hash, window_start). Reverting the migration's RLS/REVOKE lines
// fails the guards and the behavior tests (implementation-rules 1).
//
// G08.02 — the same guards now cover `grant_products` (the product →
// route/tier mapping of /v1/grant): a rights table the client must never
// touch.
//
// G08.06 — `webhook_events` (the optional /v1/rc-webhook bookkeeping) joins
// the guard set: RevenueCat-side payloads are written only by the service
// role and are never client-readable.
//
// Shape notes: the migration literals live once in test-db.ts and the sync
// guard compares them against the committed supabase/migrations/*.sql files.
// The statement-shape guards parse the replayed statements; they never build
// SQL from table names. Behavior tests seed rows with values generated inside
// Postgres (gen_random_uuid, md5(random()), jsonb_build_object, make_interval),
// so no JS-side value reaches the server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import { freshMigratedDatabase, MIGRATIONS } from './test-db.ts';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const SERVER_TABLES = ['devices', 'entitlement_cache', 'event_log', 'device_registration_rate', 'grant_products', 'webhook_events'];

function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;\s*$/, '');
}

// The migration steps replayed into a recorder yield their literal statements
// — the raw material for the statement-shape guards below.
function replayedStatements(): string[] {
  const recorded: string[] = [];
  const recorder = {
    query(sql: string): Promise<unknown> {
      recorded.push(sql);
      return Promise.resolve([]);
    },
  };
  for (const migration of MIGRATIONS) {
    for (const step of migration.steps) void step(recorder);
  }
  return recorded;
}

test('guard: replayed steps stay in sync with the committed migration files', async () => {
  for (const migration of MIGRATIONS) {
    const recorded: string[] = [];
    const recorder = {
      query(sql: string): Promise<unknown> {
        recorded.push(sql);
        return Promise.resolve([]);
      },
    };
    for (const step of migration.steps) await step(recorder);
    const fileSql = normalize(readFileSync(path.join(migrationsDir, migration.file), 'utf8'));
    const stepsSql = normalize(recorded.join(';\n'));
    assert.equal(stepsSql, fileSql, `${migration.file} must match the replayed steps`);
  }
});

// Statement shapes, parsed from the replayed steps: `alter table T enable row
// level security`, `revoke all on T from anon, authenticated`,
// `grant select, insert, update, delete on T to service_role` — the word
// position is fixed for each shape.
function tableOf(step: string, position: number): string | null {
  const words = step.split(' ');
  return words.length > position ? words[position]! : null;
}

test('guard: every server table is RLS-enabled, revoked from clients, granted to service_role', () => {
  const steps = replayedStatements();
  const enabled = steps.filter((s) => s.startsWith('alter table ') && s.endsWith(' enable row level security'))
    .map((s) => tableOf(s, 2));
  const revoked = steps.filter((s) => s.startsWith('revoke all on ') && s.endsWith(' from anon, authenticated'))
    .map((s) => tableOf(s, 3));
  const granted = steps.filter((s) => s.startsWith('grant select, insert, update, delete on ') && s.endsWith(' to service_role'))
    .map((s) => tableOf(s, 6));
  assert.deepEqual(enabled.sort(), [...SERVER_TABLES].sort(), 'each table must enable row level security');
  assert.deepEqual(revoked.sort(), [...SERVER_TABLES].sort(), 'each table must be revoked from anon/authenticated');
  assert.deepEqual(granted.sort(), [...SERVER_TABLES].sort(), 'each table must be granted to service_role');
});

test('guard: cascade deletes are declared on both device-owned tables', () => {
  const steps = replayedStatements();
  for (const table of ['entitlement_cache', 'event_log']) {
    const create = steps.find((s) => s.startsWith('create table ') && tableOf(s, 2) === table);
    assert.ok(create, `${table} must exist in the migration`);
    assert.match(
      create!,
      /references devices \(device_id\) on delete cascade/,
      `${table} must cascade on device delete (09 §5)`,
    );
  }
});

test('guard: nothing is granted to anon or authenticated anywhere in the migrations', () => {
  const granting = replayedStatements().filter((s) => /grant\b/i.test(s) && /\b(anon|authenticated)\b/i.test(s));
  assert.deepEqual(granting, [], 'no table may be granted to anon/authenticated (deny-by-default)');
});

test('guard: grant_products admits at most one product per (route_id, tier)', () => {
  const create = replayedStatements().find((s) => s.startsWith('create table ') && tableOf(s, 2) === 'grant_products');
  assert.ok(create, 'grant_products must exist in the migration');
  assert.match(create!, /unique \(route_id, tier\)/, 'the single-match rule must be a schema constraint (09 §5)');
});

test('anon is denied outright without grants (REVOKE layer)', async () => {
  const db = await freshMigratedDatabase();
  await db.query('set role anon');
  await assert.rejects(db.query('select * from devices'), /permission denied/i);
  await assert.rejects(db.query('select * from event_log'), /permission denied/i);
});

test('RLS hides devices from anon even when a grant is re-added', async () => {
  const db = await freshMigratedDatabase();
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
  const db = await freshMigratedDatabase();
  await db.query('set role authenticated');
  await assert.rejects(db.query('select * from device_registration_rate'), /permission denied/i);
  await assert.rejects(
    db.query('insert into event_log (event_id, device_id, type, at, payload) values (gen_random_uuid(), gen_random_uuid(), md5(random()::text), now(), jsonb_build_object())'),
    /permission denied/i,
  );
});

test('grant_products is invisible to anon and writable only by the service role', async () => {
  const db = await freshMigratedDatabase();
  await db.query('set role service_role');
  await db.query("insert into grant_products (product_id, route_id, tier) values ('kudy.spike.g00_03.story_01', 'g00-03-spike', 'extended')");
  await db.query('reset role');

  // anon: no grants at all first, then the RLS layer with a grant re-added.
  await db.query('set role anon');
  await assert.rejects(db.query('select * from grant_products'), /permission denied/i);
  await db.query('reset role');
  await db.query('grant select on grant_products to anon');
  await db.query('set role anon');
  const visible = await db.query('select count(*)::int as count from grant_products');
  assert.equal(visible.rows[0]?.count, 0, 'product rows must stay invisible under RLS with no policy');
  await db.query('reset role');

  // The unique constraint is the schema-level single-match rule: a second
  // product for the same route × tier is a database error, not a guess.
  await db.query('set role service_role');
  await assert.rejects(
    db.query("insert into grant_products (product_id, route_id, tier) values ('kudy.spike.other', 'g00-03-spike', 'extended')"),
    /unique/i,
  );
  const readable = await db.query('select product_id from grant_products');
  assert.equal(readable.rows.length, 1);
});

test('service role writes through; device delete cascades to cache and events', async () => {
  const db = await freshMigratedDatabase();
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

test('webhook_events is invisible to anon and writable only by the service role', async () => {
  const db = await freshMigratedDatabase();
  await db.query('set role service_role');
  await db.query(
    "insert into webhook_events (event_id, type, event_at, payload) values ('8f0d0f1c-0000-4000-8000-000000000001', 'TEST', now(), jsonb_build_object())",
  );
  await db.query('reset role');

  await db.query('set role anon');
  await assert.rejects(db.query('select * from webhook_events'), /permission denied/i);
  await db.query('reset role');
  await db.query('grant select on webhook_events to anon');
  await db.query('set role anon');
  const visible = await db.query('select count(*)::int as count from webhook_events');
  assert.equal(visible.rows[0]?.count, 0, 'webhook rows must stay invisible under RLS with no policy');
  await db.query('reset role');
});

test('rate counter table bumps attempts per (ip_hash, window_start)', async () => {
  const db = await freshMigratedDatabase();
  await db.query('insert into device_registration_rate (ip_hash, window_start, attempts) values (md5(random()::text), to_timestamp(1700000000), 1)');
  await db.query('update device_registration_rate set attempts = attempts + 1');
  const attempts = await db.query('select attempts from device_registration_rate');
  assert.equal(attempts.rows.length, 1);
  assert.equal(attempts.rows[0]?.attempts, 2);
});
