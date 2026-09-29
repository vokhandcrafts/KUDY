// Test support: a fresh in-process Postgres (PGlite) with the committed
// migrations applied statement-by-statement, plus the parameterized runner
// the grant flow's SQL ports run through. The migration literals live here
// once — rls.test.ts and grant-core.test.ts replay the same array, and the
// sync guard in rls.test.ts compares it against the committed
// supabase/migrations/*.sql files (no second copy anywhere).
import { PGlite } from '@electric-sql/pglite';

import {
  grantRouteKey,
  GRANT_CACHE_CAP_SQL,
  GRANT_CACHE_READ_SQL,
  GRANT_CACHE_SWEEP_EXPIRED_SQL,
  GRANT_CACHE_WRITE_SQL,
  GRANT_PRODUCT_LOOKUP_SQL,
  type GrantSqlRunner,
} from './grant-core.ts';
import {
  WEBHOOK_CACHE_INVALIDATE_SQL,
  WEBHOOK_EVENT_EFFECTS_READ_SQL,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_MARK_APPLIED_SQL,
  type WebhookSqlRunner,
} from './rc-webhook-core.ts';

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

export const GRANT_ROUTE_KEY_MIGRATION_STEPS: MigrationStep[] = [
  (db) => db.query("create function grant_route_key(route_id text, tier text) returns text immutable language sql as $$ select encode(sha256(convert_to(route_id || '|' || tier, 'UTF8')), 'hex') $$"),
  (db) => db.query('alter table grant_products add column route_key text generated always as (grant_route_key(route_id, tier)) stored'),
  (db) => db.query('create unique index grant_products_route_key_idx on grant_products (route_key)'),
];

export const WEBHOOK_MIGRATION_STEPS: MigrationStep[] = [
  (db) => db.query('create table webhook_events ( event_id text primary key, type text not null, event_at timestamptz, received_at timestamptz not null default now(), payload jsonb not null, effects_applied boolean not null default false )'),
  (db) => db.query('alter table webhook_events enable row level security'),
  (db) => db.query('revoke all on webhook_events from anon, authenticated'),
  (db) => db.query('grant select, insert, update, delete on webhook_events to service_role'),
];

export const MIGRATIONS: Array<{ file: string; steps: MigrationStep[] }> = [
  { file: '20260922120000_device_tables_rls.sql', steps: DEVICE_MIGRATION_STEPS },
  { file: '20260926120000_grant_products.sql', steps: GRANT_MIGRATION_STEPS },
  { file: '20260926130000_grant_products_route_key.sql', steps: GRANT_ROUTE_KEY_MIGRATION_STEPS },
  { file: '20260930000000_webhook_events.sql', steps: WEBHOOK_MIGRATION_STEPS },
];

export async function freshMigratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  for (const step of ROLE_STEPS) await step(db);
  for (const migration of MIGRATIONS) {
    for (const step of migration.steps) await step(db);
  }
  return db;
}

// The SQL runner the grant core's ports run against in tests: PGlite instead
// of postgres.js, the same pinned statements with the same sha256 route key
// built inline — proving the statements and the JS/SQL hash agreement.
export function pgliteGrantRunner(db: PGlite): GrantSqlRunner {
  return {
    async findProduct(routeId, tier) {
      const result = await db.query(GRANT_PRODUCT_LOOKUP_SQL, [grantRouteKey(routeId, tier)]);
      return result.rows as Array<Record<string, unknown>>;
    },
    async readCache(deviceId, routeId, tier) {
      const result = await db.query(GRANT_CACHE_READ_SQL, [deviceId, grantRouteKey(routeId, tier)]);
      return result.rows as Array<Record<string, unknown>>;
    },
    async writeCache(input) {
      await db.query(
        GRANT_CACHE_WRITE_SQL,
        [input.deviceId, input.environment, input.expiresAtMs, grantRouteKey(input.routeId, input.tier)],
      );
    },
    async sweepExpiredCache(deviceId, nowMs) {
      await db.query(GRANT_CACHE_SWEEP_EXPIRED_SQL, [deviceId, nowMs]);
    },
    async capCache(deviceId, cap) {
      await db.query(GRANT_CACHE_CAP_SQL, [deviceId, cap]);
    },
  };
}

// The SQL runner the webhook core's store port runs against in tests: PGlite
// instead of postgres.js, the same pinned statements — proving the insert-on-
// conflict idempotency and the cache invalidation against real Postgres.
export function pgliteWebhookRunner(db: PGlite): WebhookSqlRunner {
  return {
    async persistEvent(input) {
      const result = await db.query(
        WEBHOOK_EVENT_INSERT_SQL,
        [input.eventId, input.type, input.eventTimestampMs, JSON.stringify(input.payload)],
      );
      return (result.rows as Array<Record<string, unknown>>).length > 0;
    },
    async readEffectsApplied(eventId) {
      const result = await db.query(WEBHOOK_EVENT_EFFECTS_READ_SQL, [eventId]);
      const row = (result.rows as Array<Record<string, unknown>>)[0];
      if (!row) return null;
      return row['effects_applied'] === true;
    },
    async markEffectsApplied(eventId) {
      await db.query(WEBHOOK_EVENT_MARK_APPLIED_SQL, [eventId]);
    },
    async invalidateEntitlementCache(deviceId) {
      await db.query(WEBHOOK_CACHE_INVALIDATE_SQL, [deviceId]);
    },
  };
}
