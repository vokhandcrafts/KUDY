// G16.04 — behavioral proof of the retention sweep (docs/architecture/21 §6)
// on real Postgres (PGlite): the committed feedback-retention.sql applied
// verbatim removes current rows, ledger entries and rate counters past
// their pinned windows (14 months for ratings and the ledger, 24 hours for
// the fixed-window counters), a second run deletes nothing new, and a
// queued edit replayed after the sweep answers 409 revision_conflict
// instead of reviving the expired rating — while a genuine new rating
// (expected_revision 0) is still accepted.
import assert from 'node:assert/strict';
import test from 'node:test';

import { feedbackRetentionSql, guide, putRating } from './report-support.ts';
import {
  freshFeedbackDatabase,
  publishFixtureTargets,
  registerFeedbackDevice,
} from '../../supabase/tests/feedback/test-support.ts';

const count = async (db: Awaited<ReturnType<typeof freshFeedbackDatabase>>, table: string): Promise<number> => {
  const result = await db.query(`select count(*)::int as n from ${table}`);
  return (result.rows[0] as { n: number }).n;
};

const targetIds = (rows: unknown[]): string[] => rows.map((row) => (row as { target_id: string }).target_id);

const runSweep = async (db: Awaited<ReturnType<typeof freshFeedbackDatabase>>): Promise<void> => {
  await db.exec(feedbackRetentionSql());
};

// --- structural guards (fail on revert, implementation-rules 1) ---

test('guard: the retention file is deletes only, with the pinned windows', () => {
  const withoutComments = feedbackRetentionSql()
    .replace(/--[^\n]*/g, '')
    .trim();
  assert.doesNotMatch(
    withoutComments,
    /\b(insert|update|drop|alter|grant|revoke|create|truncate)\b/i,
    'the sweep only deletes; it never writes rows or changes grants',
  );
  assert.equal((withoutComments.match(/interval '14 months'/g) ?? []).length, 2, 'ratings and the ledger share the 14-month upper bound');
  assert.equal((withoutComments.match(/interval '24 hours'/g) ?? []).length, 2, 'both fixed-window counters expire after 24 hours');
  for (const table of ['feedback_current', 'feedback_mutations', 'feedback_send_rate', 'feedback_ip_rate']) {
    assert.match(withoutComments, new RegExp(`delete from ${table}\\b`), `${table} has its sweep statement`);
  }
});

// --- behavioral sweep over the production path ---

test('the sweep removes expired rows and keeps fresh ones, then deletes nothing new', async () => {
  const db = await freshFeedbackDatabase();
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be'), guide('guide-route-b2', '1', 'be')]);
  const oldDevice = await registerFeedbackDevice(db);
  const freshDevice = await registerFeedbackDevice(db);

  const oldRating = await putRating(db, oldDevice.secret, guide('guide-route-a1', '1', 'be'), 3);
  await putRating(db, freshDevice.secret, guide('guide-route-b2', '1', 'be'), 5);
  assert.equal(oldRating.status, 200);

  // Age the old device's rating and its ledger entry past the 14-month
  // bound, then seed the fixed-window counters at both ages. The PUT path
  // also wrote its own windows at the suites' fixed 2026-10-03 clock —
  // already more than 24 hours old against the real now() — so they must
  // be swept too, which the final counts prove.
  await db.query("update feedback_current set updated_at = now() - interval '15 months' where target_id = 'guide-route-a1'");
  await db.query("update feedback_mutations set created_at = now() - interval '15 months' where target_id = 'guide-route-a1'");
  await db.query(
    "insert into feedback_send_rate (device_id, window_start, attempts) values ($1, now() - interval '25 hours', 2)",
    [oldDevice.deviceId],
  );
  await db.query(
    "insert into feedback_send_rate (device_id, window_start, attempts) values ($1, now() - interval '1 hour', 2)",
    [freshDevice.deviceId],
  );
  await db.query("insert into feedback_ip_rate (ip_hash, window_start, attempts) values ('00000000-aged-ip-hash', now() - interval '25 hours', 4)");
  await db.query("insert into feedback_ip_rate (ip_hash, window_start, attempts) values ('00000000-fresh-ip-hash', now() - interval '1 hour', 4)");

  await runSweep(db);

  const currentRows = await db.query('select distinct target_id from feedback_current');
  assert.deepEqual(targetIds(currentRows.rows), ['guide-route-b2'], 'the expired rating left, the fresh one stayed');
  const ledgerRows = await db.query('select distinct target_id from feedback_mutations');
  assert.deepEqual(targetIds(ledgerRows.rows), ['guide-route-b2'], 'the expired ledger entry left, the fresh one stayed');
  assert.equal(await count(db, 'feedback_send_rate'), 1, 'the aged device window is gone, the fresh one stays (the fixed-clock PUT windows swept too)');
  assert.equal(await count(db, 'feedback_ip_rate'), 1, 'the aged ip counter is gone, the fresh one stays');

  const afterFirst = {
    current: await count(db, 'feedback_current'),
    mutations: await count(db, 'feedback_mutations'),
    send: await count(db, 'feedback_send_rate'),
    ip: await count(db, 'feedback_ip_rate'),
  };
  await runSweep(db);
  assert.deepEqual(
    {
      current: await count(db, 'feedback_current'),
      mutations: await count(db, 'feedback_mutations'),
      send: await count(db, 'feedback_send_rate'),
      ip: await count(db, 'feedback_ip_rate'),
    },
    afterFirst,
    'a second run is idempotent: it deletes nothing new',
  );
});

test('a queued edit replayed after the sweep conflicts instead of reviving', async () => {
  const db = await freshFeedbackDatabase();
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const device = await registerFeedbackDevice(db);

  const created = await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 3);
  assert.equal(created.status, 200);

  // The row and its ledger expire; the sweep removes both. The device's
  // queued edit (expected_revision 1) had never arrived before the sweep.
  await db.query("update feedback_current set updated_at = now() - interval '15 months'");
  await db.query("update feedback_mutations set created_at = now() - interval '15 months'");
  await runSweep(db);
  assert.equal(await count(db, 'feedback_current'), 0, 'the sweep removed the expired rating');

  const replayedEdit = await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 4, [], 1);
  assert.equal(replayedEdit.status, 409, 'the queued edit cannot recreate the removed row');
  assert.equal(replayedEdit.body.error, 'revision_conflict');
  assert.equal(await count(db, 'feedback_current'), 0, 'the conflict created nothing');

  const freshVote = await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 5, [], 0);
  assert.equal(freshVote.status, 200, 'a genuine new rating (expected_revision 0) is still accepted after the sweep');
  assert.equal(await count(db, 'feedback_current'), 1);
});
