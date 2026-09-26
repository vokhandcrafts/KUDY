// Test support: a fresh in-process Postgres (PGlite) with the committed
// migrations applied statement-by-statement, plus the parameterized runner
// the grant flow's SQL ports run through. The migration literals live here
// once — rls.test.ts and grant-core.test.ts replay the same array, and the
// sync guard in rls.test.ts compares it against the committed
// supabase/migrations/*.sql files (no second copy anywhere).
import { PGlite } from '@electric-sql/pglite';

export interface StepRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export type MigrationStep = (db: StepRunner) => Promise<unknown>;

export const ROLE_STEPS: MigrationStep[] = [
  (db) => db.query('create role anon nologin'),
  (db) => db.query('create role authenticated nologin'),
  (db) => db.query('create role service_role nologin bypassrls'),
];

export const DEVICE_MIGRATION_STEPS: MigrationStep[] = [
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

export const GRANT_MIGRATION_STEPS: MigrationStep[] = [
  (db) => db.query('create table grant_products ( product_id text primary key, route_id text not null, tier text not null, unique (route_id, tier) )'),
  (db) => db.query('alter table grant_products enable row level security'),
  (db) => db.query('revoke all on grant_products from anon, authenticated'),
  (db) => db.query('grant select, insert, update, delete on grant_products to service_role'),
];

export const MIGRATIONS: Array<{ file: string; steps: MigrationStep[] }> = [
  { file: '20260922120000_device_tables_rls.sql', steps: DEVICE_MIGRATION_STEPS },
  { file: '20260926120000_grant_products.sql', steps: GRANT_MIGRATION_STEPS },
];

export async function freshMigratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  for (const step of ROLE_STEPS) await step(db);
  for (const migration of MIGRATIONS) {
    for (const step of migration.steps) await step(db);
  }
  return db;
}

// The parameterized runner the grant core's SQL ports run against in tests:
// every statement reaches Postgres with its parameters as an array, the same
// shape the Deno wrapper feeds postgres.js with.
export interface SqlRowsRunner {
  query(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>>;
}

export function pgliteRowsRunner(db: PGlite): SqlRowsRunner {
  return {
    async query(sql: string, params: unknown[]) {
      const result = await db.query(sql, params);
      return result.rows as Array<Record<string, unknown>>;
    },
  };
}
