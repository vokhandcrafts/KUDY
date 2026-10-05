// G22.01 — the lifecycle of a factory-built PGlite database (spec E1). The
// caller owns a successful return and closes it through node:test teardown;
// a scoped try/finally closes it after a thrown assertion/body error; the
// factory closes the half-migrated database before a failed return without
// masking the migration error. Every case drives the real factory and real
// PGlite — the migrated schema is exercised, not mocked.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { DEVICE_MIGRATION_STEPS, freshMigratedDatabase, type MigrationStep } from './test-db.ts';

test('owned_database_closed_after_success', async (t) => {
  let db: PGlite | undefined;
  await t.test('the owner registers the teardown right after acquiring the real database', async (tt) => {
    db = await freshMigratedDatabase();
    tt.after(() => db!.close());
    const tables = await db!.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const names = (tables.rows as Array<{ table_name: string }>).map((row) => row.table_name);
    for (const table of ['devices', 'entitlement_cache', 'event_log', 'grant_products', 'webhook_events', 'event_send_rate', 'grant_request_rate']) {
      assert.ok(names.includes(table), `committed migration applied: ${table} exists`);
    }
    assert.equal(db!.closed, false, 'the database is live while its test owns it');
  });
  assert.ok(db, 'the nested test acquired the real database');
  assert.equal(db!.closed, true, 'the owned database is closed after the successful test');
});

test('owned_database_closed_after_body_failure', async () => {
  const db = await freshMigratedDatabase();
  const forced = new assert.AssertionError({ message: 'forced assertion failure' });
  let caught: unknown;
  try {
    try {
      throw forced;
    } finally {
      await db.close();
    }
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, forced, 'the thrown assertion error stays the observable outcome');
  assert.equal(db.closed, true, 'the scoped owner closed the database after the body failure');
});

test('migration_failure_closes_database_and_' +
  'preserves_error', async () => {
  let faulting: PGlite | undefined;
  const faultStep: MigrationStep = (db) => {
    faulting = db as PGlite;
    return Promise.reject(new Error('forced migration boundary failure'));
  };
  await assert.rejects(
    freshMigratedDatabase([
      { file: '20260922120000_device_tables_rls.sql', steps: [DEVICE_MIGRATION_STEPS[0]!, faultStep] },
    ]),
    /forced migration boundary failure/,
  );
  assert.ok(faulting, 'the faulting step ran against a real database');
  assert.equal(faulting!.closed, true, 'the factory closed the half-migrated database');
});
