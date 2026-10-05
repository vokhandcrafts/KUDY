// G16.01 — behavioral proof of the private feedback storage on real Postgres
// (PGlite, the rls.test.ts idiom): the committed migration
// 20261004000000_feedback_tables_rls.sql is applied verbatim and must hold —
// deny-by-default RLS for anon/authenticated (even when a grant is
// re-added), FK cascade through the existing device delete, no post-delete
// recreation, prepared-target fail-closed, CAS conflicts under concurrent
// same-revision writes, and the contract's rate limits. Reverting the RLS,
// cascade or check-constraint lines of the migration fails these guards and
// behaviors (implementation-rules 1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';

import { hashIp } from '../../functions/_shared/device-core.ts';
import { handleFeedbackEdgeRequest } from '../../functions/feedback/feedback-wire.ts';
import {
  FEEDBACK_CURRENT_LOCK_SQL,
  FEEDBACK_DEVICE_RATE_LIMIT,
  FEEDBACK_IP_RATE_LIMIT,
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_RATE_WINDOW_MS,
} from '../../functions/feedback/feedback-core.ts';
import {
  importFeedbackRegistry,
  publishFeedbackTargets,
  REGISTRY_LOCALES,
} from '../../functions/feedback/registry-import.ts';
import {
  feedbackMigrationSql,
  feedbackRequest,
  freshFeedbackDatabase,
  pgliteFeedbackClient,
  publishFixtureTargets,
  registerFeedbackDevice,
  testFeedbackConfig,
} from './test-support.ts';

const FEEDBACK_TABLES = [
  'feedback_target_registry',
  'feedback_current',
  'feedback_mutations',
  'feedback_send_rate',
  'feedback_ip_rate',
];

function migrationStatements(): string[] {
  return feedbackMigrationSql()
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

const createStatements = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const statement of migrationStatements()) {
    if (statement.startsWith('create table ')) {
      map.set(statement.split(' ')[2]!, statement);
    }
  }
  return map;
};

// --- migration shape guards (fail on revert) ---

test('guard: every feedback table is RLS-enabled, revoked from clients, granted to service_role', () => {
  const statements = migrationStatements();
  for (const table of FEEDBACK_TABLES) {
    assert.ok(
      statements.includes(`alter table ${table} enable row level security`),
      `${table} must enable row level security`,
    );
    assert.ok(
      statements.includes(`revoke all on ${table} from anon, authenticated`),
      `${table} must be revoked from anon/authenticated`,
    );
    assert.ok(
      statements.includes(`grant select, insert, update, delete on ${table} to service_role`),
      `${table} must be granted to the service role only`,
    );
  }
});

test('guard: the device-owned feedback tables cascade on device delete', () => {
  const creates = createStatements();
  for (const table of ['feedback_current', 'feedback_mutations', 'feedback_send_rate']) {
    assert.match(
      creates.get(table)!,
      /references devices \(device_id\) on delete cascade/,
      `${table} must cascade on device delete (21 §5.2, 09 §5)`,
    );
  }
  assert.doesNotMatch(
    creates.get('feedback_target_registry')!,
    /references devices/,
    'the registry is device-independent and survives device deletion',
  );
});

test('guard: the current-row shape is schema-checked (scale, tombstone state, revision)', () => {
  const current = createStatements().get('feedback_current')!;
  assert.match(current, /score integer check \(score is null or score between 1 and 5\)/, 'the 1..5 scale is a schema constraint');
  assert.match(
    current,
    /check \(\(deleted_at is null and score is not null\) or \(deleted_at is not null and score is null and reason_codes = '\[\]'::jsonb\)\)/,
    'a tombstone carries no score and no reasons; a rating carries a score (21 §5.2)',
  );
  assert.match(current, /revision integer not null check \(revision >= 1\)/, 'revisions start at 1');
  const mutations = createStatements().get('feedback_mutations')!;
  assert.match(mutations, /primary key \(device_id, mutation_id\)/, 'the idempotency dedup is a schema constraint');
  const registry = createStatements().get('feedback_target_registry')!;
  assert.match(registry, /check \(status in \('prepared', 'published'\)\)/, 'registry status is a closed list');
  assert.match(
    registry,
    /check \(\(status = 'published' and published_at is not null\) or \(status = 'prepared' and published_at is null\)\)/,
    'a published row carries its publication timestamp',
  );
});

test('guard: the CAS lock statement serializes same-key writers', () => {
  assert.match(FEEDBACK_CURRENT_LOCK_SQL, /for update/, 'the lock is `for update` (21 §5.3 «lock current/unique-key»)');
});

test('guard: the contract limits are the spec numbers', () => {
  assert.equal(FEEDBACK_MAX_BODY_BYTES, 8 * 1024, '21 §5.3: 8 KiB per body');
  assert.equal(FEEDBACK_DEVICE_RATE_LIMIT, 30, '21 §5.3: 30 feedback requests per minute per device');
  assert.equal(FEEDBACK_IP_RATE_LIMIT, 120, '21 §5.3: 120 per minute per IP');
  assert.equal(FEEDBACK_RATE_WINDOW_MS, 60 * 1000);
});

// --- RLS behavior ---

test('anon and authenticated cannot touch the feedback tables, even with a grant re-added', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await db.query('set role anon');
  for (const table of FEEDBACK_TABLES) {
    await assert.rejects(db.query(`select * from ${table}`), /permission denied/i, `${table}: no grants, no access`);
  }
  await db.query('reset role');

  // The RLS layer: even re-adding a grant keeps rows invisible and unwritable.
  await db.query('grant select, insert, update, delete on feedback_current to anon');
  await db.query('set role anon');
  const visible = await db.query('select count(*)::int as count from feedback_current');
  assert.equal(visible.rows[0]?.count, 0, 'rows must be invisible under RLS with no policy');
  await assert.rejects(
    db.query("insert into feedback_current (device_id, target_kind, target_id, target_version, locale, revision, score, reason_codes) values (gen_random_uuid(), 'guide', 'guide-route-a1', '1', 'be', 1, 3, '[]'::jsonb)"),
    /row-level security/i,
  );
  await db.query('reset role');
  await db.query('revoke all on feedback_current from anon');

  await db.query('set role authenticated');
  for (const table of FEEDBACK_TABLES) {
    await assert.rejects(db.query(`select * from ${table}`), /permission denied/i, `${table}: authenticated denied`);
  }
});

test('the registry and rows survive device deletion; the device-owned rows do not', async (t) => {
  const { db, call } = await feedbackScenario(t);
  await call('PUT', '/v1/feedback', {
    mutation_id: '00000000-0000-4000-8000-000000000001',
    target: { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' },
    expected_revision: 0,
    score: 4,
    reason_codes: ['interesting_stories'],
    disclosure_version: 'feedback-disclosure-1',
  });

  await db.query('delete from devices');

  for (const table of ['feedback_current', 'feedback_mutations', 'feedback_send_rate']) {
    const left = await db.query(`select count(*)::int as count from ${table}`);
    assert.equal(left.rows[0]?.count, 0, `${table} must cascade on device delete`);
  }
  const registry = await db.query('select count(*)::int as count from feedback_target_registry');
  assert.equal(registry.rows[0]?.count, 1, 'published registry targets survive device deletion (21 §5.2)');
});

test('deleted device credentials cannot recreate rows', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const device = await registerFeedbackDevice(db);
  await db.query('delete from devices');
  // The service role itself cannot attach a rating to a dead device: the FK
  // closes the path the handler's live-device check also closes.
  await assert.rejects(
    db.query(
      "insert into feedback_current (device_id, target_kind, target_id, target_version, locale, revision, score, reason_codes) values ($1, 'guide', 'guide-route-a1', '1', 'be', 1, 3, '[]'::jsonb)",
      [device.deviceId],
    ),
    /foreign key/i,
  );
});

// --- registry import and publication (21 §5.2) ---

const EXPORT_TARGETS = [
  { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' },
  { kind: 'place', place_id: 'place-a1', content_version: '1', locale: 'en' },
];
const exportDoc = () => ({ schema_version: 1, status: 'prepared', targets: EXPORT_TARGETS.map((t) => ({ ...t, status: 'prepared' })) });

test('prepared targets fail closed with 503; publication reconciles an interrupted import', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const client = pgliteFeedbackClient(db);
  const config = testFeedbackConfig();
  const device = await registerFeedbackDevice(db);
  const runner = { query: (sql: string, params?: unknown[]) => db.query(sql, params) };

  const first = await importFeedbackRegistry(runner, exportDoc());
  assert.deepEqual(first, { imported: 2, alreadyPresent: 0 });

  const call = (method: string, urlPath: string, body: unknown) =>
    handleFeedbackEdgeRequest(
      feedbackRequest({ method, url: `https://feedback.test${urlPath}`, body, secret: device.secret }),
      client,
      config,
    );
  const put = {
    mutation_id: '00000000-0000-4000-8000-000000000001',
    target: EXPORT_TARGETS[0],
    expected_revision: 0,
    score: 3,
    reason_codes: [],
    disclosure_version: 'feedback-disclosure-1',
  };
  const prepared = await call('PUT', '/v1/feedback', put);
  assert.equal(prepared.status, 503, 'a prepared target fails closed');
  assert.deepEqual(await prepared.json(), { error: 'target_not_published' });

  const nothing = await db.query('select count(*)::int as count from feedback_current');
  assert.equal(nothing.rows[0]?.count, 0, 'the rejected write stored nothing');

  assert.equal(await publishFeedbackTargets(runner, exportDoc()), 2, 'both targets publish');
  const published = await call('PUT', '/v1/feedback', put);
  assert.equal(published.status, 200);
  assert.deepEqual(await published.json(), { revision: 1, saved: true });

  // Reconciliation: re-importing the same release downgrades nothing, and a
  // repeated publish finds no prepared rows left.
  const again = await importFeedbackRegistry(runner, exportDoc());
  assert.deepEqual(again, { imported: 0, alreadyPresent: 2 });
  const statuses = await db.query('select distinct status from feedback_target_registry');
  assert.deepEqual(statuses.rows.map((row) => row.status), ['published']);
  assert.equal(await publishFeedbackTargets(runner, exportDoc()), 0);
  const still = await call('PUT', '/v1/feedback', {
    ...put,
    mutation_id: '00000000-0000-4000-8000-000000000002',
    target: EXPORT_TARGETS[1],
  });
  assert.equal(still.status, 200, 'the second published target keeps accepting ratings');
});

test('a malformed export is rejected before any write', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const runner = { query: (sql: string, params?: unknown[]) => db.query(sql, params) };
  const broken = [
    { schema_version: 2, status: 'prepared', targets: EXPORT_TARGETS },
    { schema_version: 1, status: 'published', targets: EXPORT_TARGETS },
    { schema_version: 1, status: 'prepared', targets: [] },
    { schema_version: 1, status: 'prepared', targets: [{ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'pl', status: 'prepared' }] },
    { schema_version: 1, status: 'prepared', targets: [...EXPORT_TARGETS, EXPORT_TARGETS[0]] },
  ];
  for (const doc of broken) {
    await assert.rejects(() => importFeedbackRegistry(runner, doc), /registry import rejected/);
  }
  const empty = await db.query('select count(*)::int as count from feedback_target_registry');
  assert.equal(empty.rows[0]?.count, 0, 'a rejected export imports nothing');
  assert.deepEqual(REGISTRY_LOCALES, ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv'], 'the registry enum is the schema contract');
});

// --- CAS and concurrency semantics ---

/** The shared single-device scenario: fresh DB, one device, the guide/be target published, the wire caller. */
/** Owned-database prologue shared by the edge-wire cases: real PGlite, the production
 *  client, one registered device and the canonical guide target published (G22.01). */
async function feedbackScenario(t: TestContext) {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const client = pgliteFeedbackClient(db);
  const config = testFeedbackConfig();
  const device = await registerFeedbackDevice(db);
  await publishFixtureTargets(db, [{ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' }]);
  const call = (method: string, urlPath: string, body: unknown, secret = device.secret) =>
  handleFeedbackEdgeRequest(
  feedbackRequest({ method, url: `https://feedback.test${urlPath}`, body, secret }),
  client,
  config,
  );
  return { db, client, config, device, call };
}

async function ratingScenario(t: TestContext): Promise<{ db: Awaited<ReturnType<typeof freshFeedbackDatabase>>; call: (method: string, urlPath: string, body: unknown) => Promise<Response>; target: Record<string, unknown> }> {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const client = pgliteFeedbackClient(db);
  const config = testFeedbackConfig();
  const device = await registerFeedbackDevice(db);
  await publishFixtureTargets(db, [{ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' }]);
  const call = (method: string, urlPath: string, body: unknown) =>
    handleFeedbackEdgeRequest(
      feedbackRequest({ method, url: `https://feedback.test${urlPath}`, body, secret: device.secret }),
      client,
      config,
    );
  const target = { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' };
  return { db, call, target };
}

test('same-revision writes yield one success and one conflict; stale deletes cannot overwrite', async (t) => {
  const { db, call, target } = await ratingScenario(t);
  const put = (mutationId: string, expectedRevision: number, score: number) =>
    call('PUT', '/v1/feedback', {
      mutation_id: mutationId,
      target,
      expected_revision: expectedRevision,
      score,
      reason_codes: [],
      disclosure_version: 'feedback-disclosure-1',
    });
  const remove = (mutationId: string, expectedRevision: number) =>
    call('POST', '/v1/feedback/delete', { mutation_id: mutationId, target, expected_revision: expectedRevision });

  // Two writers both saw revision 0: the first commit wins, the second —
  // serialized by the `for update` lock — conflicts.
  assert.equal((await put('00000000-0000-4000-8000-000000000001', 0, 4)).status, 200);
  assert.equal((await put('00000000-0000-4000-8000-000000000002', 0, 5)).status, 409);

  // The row moves to revision 2; the stale revision 1 cannot tombstone it.
  assert.deepEqual(await (await put('00000000-0000-4000-8000-000000000005', 1, 2)).json(), { revision: 2, saved: true });
  const staleDelete = await remove('00000000-0000-4000-8000-000000000003', 1);
  assert.equal(staleDelete.status, 409, 'delete at the stale revision overwrites nothing');

  // The tombstone: correct-revision delete succeeds, an old revision cannot
  // resurrect or overwrite it, and a deliberate re-rate at the current
  // revision replaces it (CAS, 21 §5.3).
  assert.deepEqual(await (await remove('00000000-0000-4000-8000-000000000006', 2)).json(), { revision: 3, deleted: true });
  const tomb = await db.query('select score, reason_codes, deleted_at from feedback_current');
  assert.equal(tomb.rows[0]?.score, null);
  assert.deepEqual(tomb.rows[0]?.reason_codes, []);
  assert.equal((await put('00000000-0000-4000-8000-000000000007', 2, 5)).status, 409, 'an old revision cannot overwrite the tombstone');
  assert.deepEqual(await (await put('00000000-0000-4000-8000-000000000008', 3, 5)).json(), { revision: 4, saved: true });
});

test('a different payload under the same mutation_id conflicts with 409', async (t) => {
  const { db, call, target } = await ratingScenario(t);
  const base = {
    mutation_id: '00000000-0000-4000-8000-000000000001',
    target,
    expected_revision: 0,
    score: 4,
    reason_codes: ['interesting_stories'],
    disclosure_version: 'feedback-disclosure-1',
  };
  assert.equal((await call('PUT', '/v1/feedback', base)).status, 200);
  const conflict = await call('PUT', '/v1/feedback', { ...base, score: 5 });
  assert.equal(conflict.status, 409, 'a different payload under the same id conflicts');
  assert.deepEqual(await conflict.json(), { error: 'mutation_conflict' });
  const rows = await db.query('select score from feedback_current');
  assert.equal(rows.rows[0]?.score, 4, 'the conflicting payload overwrote nothing');
});

test('a duplicate that raced past the original replays after the lock, never 503s', async (t) => {
  const { call, target } = await ratingScenario(t);
  const put = (mutationId: string, expectedRevision: number, score: number, reasonCodes: string[]) =>
    call('PUT', '/v1/feedback', {
      mutation_id: mutationId,
      target,
      expected_revision: expectedRevision,
      score,
      reason_codes: reasonCodes,
      disclosure_version: 'feedback-disclosure-1',
    });

  // The original create commits (revision 1) and a later edit moves the row
  // to revision 2; the identical create-retry still carries expected 0.
  assert.deepEqual(await (await put('00000000-0000-4000-8000-000000000001', 0, 4, ['interesting_stories'])).json(), { revision: 1, saved: true });
  assert.deepEqual(await (await put('00000000-0000-4000-8000-000000000002', 1, 5, [])).json(), { revision: 2, saved: true });

  // The retry holds the ledger row, so it replays the stored revision 1 —
  // not a 409 revision_conflict against the advanced current row.
  const replay = await put('00000000-0000-4000-8000-000000000001', 0, 4, ['interesting_stories']);
  assert.deepEqual(await replay.json(), { revision: 1, saved: true });

  // A different payload under the same id with an expected_revision that
  // happens to match the current row conflicts as mutation_conflict — it
  // must never reach the CAS update or die on the ledger PK as a 503.
  const conflict = await put('00000000-0000-4000-8000-000000000001', 1, 2, ['interesting_stories']);
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'mutation_conflict' });
});

test('forged-bearer failures count toward the shared IP bucket', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const client = pgliteFeedbackClient(db);
  const config = { ...testFeedbackConfig(), deviceRateLimit: 100, ipRateLimit: 1 };
  const device = await registerFeedbackDevice(db);
  await publishFixtureTargets(db, [{ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' }]);

  const forged = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: 'https://feedback.test/v1/feedback/read', body: { target: { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' } }, secret: 'not-a-secret', ip: '203.0.113.9' }),
    client,
    config,
  );
  assert.equal(forged.status, 401, 'the forged bearer fails auth first');

  // The valid device behind the same address finds the IP bucket already
  // consumed by the unauthenticated flood.
  const valid = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: 'https://feedback.test/v1/feedback/read', body: { target: { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' } }, secret: device.secret, ip: '203.0.113.9' }),
    client,
    config,
  );
  assert.equal(valid.status, 429, 'the IP bucket spans authenticated and unauthenticated requests');
  const stored = await db.query('select ip_hash from feedback_ip_rate');
  assert.deepEqual(stored.rows.map((row) => row.ip_hash), [hashIp('203.0.113.9')]);
});

// --- limits and envelope failures ---

test('the device and IP limits answer 429 with Retry-After; reads count too', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const client = pgliteFeedbackClient(db);
  const config = { ...testFeedbackConfig(), deviceRateLimit: 2, ipRateLimit: 10 };
  const device = await registerFeedbackDevice(db);
  await publishFixtureTargets(db, [{ kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' }]);
  const target = { kind: 'guide', route_id: 'guide-route-a1', version: '1', locale: 'be' };

  const call = (method: string, urlPath: string, body: unknown) =>
    handleFeedbackEdgeRequest(
      feedbackRequest({ method, url: `https://feedback.test${urlPath}`, body, secret: device.secret }),
      client,
      config,
    );
  const read = { target };
  assert.equal((await call('POST', '/v1/feedback/read', read)).status, 200);
  assert.equal((await call('POST', '/v1/feedback/read', read)).status, 200);
  const limited = await call('POST', '/v1/feedback/read', read);
  assert.equal(limited.status, 429, 'the third read within the window hits the device limit');
  assert.deepEqual(await limited.json(), { error: 'feedback_rate_limited' });
  assert.match(limited.headers.get('retry-after') ?? '', /^\d+$/, '429 carries Retry-After');

  // The IP limit is shared across devices: a second device behind the same
  // address hits the same bucket.
  const ipConfig = { ...testFeedbackConfig(), deviceRateLimit: 100, ipRateLimit: 1 };
  const other = await registerFeedbackDevice(db);
  const shared = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: 'https://feedback.test/v1/feedback/read', body: read, secret: other.secret, ip: '192.0.2.1' }),
    client,
    ipConfig,
  );
  assert.equal(shared.status, 429, 'the shared-IP bucket spans devices');

  // The stored key is the address hash — the raw IP never persists.
  const stored = await db.query('select ip_hash from feedback_ip_rate');
  assert.deepEqual(stored.rows.map((row) => row.ip_hash), [hashIp('192.0.2.1')]);
});

test('envelope failures: unknown path, oversized body, invalid JSON', async (t) => {
  const { db, client, config, device } = await feedbackScenario(t);

  const notFound = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: 'https://feedback.test/v1/feedback/rate', body: {}, secret: device.secret }),
    client,
    config,
  );
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), { error: 'not_found' });

  const wrongMethod = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: 'https://feedback.test/v1/feedback', body: {}, secret: device.secret }),
    client,
    config,
  );
  assert.equal(wrongMethod.status, 404, 'PUT is the only write path on /v1/feedback');

  const oversized = await handleFeedbackEdgeRequest(
    feedbackRequest({
      method: 'PUT',
      url: 'https://feedback.test/v1/feedback',
      body: {},
      rawBody: new Uint8Array(FEEDBACK_MAX_BODY_BYTES + 1),
      secret: device.secret,
    }),
    client,
    config,
  );
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'payload_too_large' });

  const invalidJson = await handleFeedbackEdgeRequest(
    feedbackRequest({
      method: 'PUT',
      url: 'https://feedback.test/v1/feedback',
      body: {},
      rawBody: new TextEncoder().encode('{not json'),
      secret: device.secret,
    }),
    client,
    config,
  );
  assert.equal(invalidJson.status, 422);
  assert.deepEqual(await invalidJson.json(), { error: 'invalid_request' });
});
