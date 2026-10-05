// Test support for the G16.01 feedback suites: a fresh PGlite with the
// committed device migrations plus the committed feedback migration applied
// verbatim from supabase/migrations/ (the file is the single source — no
// mirrored step list exists for this migration, so the rls.test.ts sync
// guard's drift class cannot arise here), the PGlite adaptation of the
// feedback port/client, and the request fakes the wire suites drive.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { freshMigratedDatabase } from '../../functions/_shared/test-db.ts';
import { DEVICE_INSERT_SQL, registerDevice } from '../../functions/_shared/device-core.ts';
import {
  createSqlFeedbackPort,
  type FeedbackConfig,
  type FeedbackPort,
  type FeedbackSqlRunner,
} from '../../functions/feedback/feedback-core.ts';
import { importFeedbackRegistry, publishFeedbackTargets } from '../../functions/feedback/registry-import.ts';
import type { FeedbackSqlClient, RequestLike } from '../../functions/feedback/feedback-wire.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FEEDBACK_MIGRATION_PATH = path.join(repoRoot, 'supabase', 'migrations', '20261004000000_feedback_tables_rls.sql');
export const FEEDBACK_CASES_PATH = path.join(repoRoot, 'fixtures', 'discovery-contract', 'feedback-cases.json');

export function feedbackMigrationSql(): string {
  return readFileSync(FEEDBACK_MIGRATION_PATH, 'utf8');
}

// Same ownership contract as the shared factory: the caller closes a
// successful return; a failed feedback migration leaves no live database.
export async function freshFeedbackDatabase(): Promise<PGlite> {
  const db = await freshMigratedDatabase();
  try {
    await db.exec(feedbackMigrationSql());
  } catch (error) {
    try {
      await db.close();
    } catch (closeError) {
      if (error instanceof Error) (error as { cause?: unknown }).cause ??= closeError;
    }
    throw error;
  }
  return db;
}

export function pgliteFeedbackRunner(db: PGlite): FeedbackSqlRunner {
  return {
    query: (sql, params) => db.query(sql, (params ?? []) as unknown[]),
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: (sql, params) => (tx as unknown as PGlite).query(sql, (params ?? []) as unknown[]),
        }),
      ),
  };
}

export function pgliteFeedbackPort(db: PGlite): FeedbackPort {
  return createSqlFeedbackPort(pgliteFeedbackRunner(db));
}

/** The `unsafe`+`begin` surface the Deno wiring gets from postgres.js, over PGlite. */
export function pgliteFeedbackClient(db: PGlite): FeedbackSqlClient {
  return {
    unsafe: async (sql, params) => (await db.query(sql, params as unknown[])).rows,
    begin: (work) =>
      db.transaction((tx) =>
        work({
          unsafe: async (sql, params) => (await (tx as unknown as PGlite).query(sql, params as unknown[])).rows,
        }),
      ),
  };
}

export async function registerFeedbackDevice(db: PGlite): Promise<{ deviceId: string; secret: string }> {
  const device = registerDevice();
  await db.query(DEVICE_INSERT_SQL, [device.deviceId, device.secretHash]);
  return { deviceId: device.deviceId, secret: device.deviceSecret };
}

export interface TestFeedbackConfig extends FeedbackConfig {
  fixed: true;
}

/** Fixed clock — the suites assert contract outcomes, never wall-clock windows. */
export function testFeedbackConfig(): TestFeedbackConfig {
  return {
    fixed: true,
    nowMs: Date.parse('2026-10-03T00:00:00Z'),
    maxBodyBytes: 8 * 1024,
    deviceRateLimit: 30,
    ipRateLimit: 120,
    rateWindowMs: 60 * 1000,
  };
}

export function feedbackRequest(options: {
  method: string;
  url: string;
  body: unknown;
  rawBody?: Uint8Array;
  secret: string | null;
  ip?: string;
}): RequestLike {
  const headers = new Map<string, string | null>([
    ['authorization', options.secret === null ? null : `Bearer ${options.secret}`],
    ['x-forwarded-for', options.ip ?? '192.0.2.1'],
  ]);
  const raw = options.rawBody ?? new TextEncoder().encode(JSON.stringify(options.body));
  return {
    method: options.method,
    url: options.url,
    headers: { get: (name) => headers.get(name) ?? null },
    arrayBuffer: async () => raw.buffer as ArrayBuffer,
  };
}

/**
 * Seeds the registry with the fixture's allowlist through the production
 * import+publish path (the 21 §5.2 prepared → published flow), so the
 * suites exercise the same publication machinery the deploy uses.
 */
export async function publishFixtureTargets(db: PGlite, targets: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  const runner = pgliteFeedbackRunner(db);
  const doc = { schema_version: 1, status: 'prepared', targets: targets.map((target) => ({ ...target, status: 'prepared' })) };
  await importFeedbackRegistry(runner, doc);
  await publishFeedbackTargets(runner, doc);
}
