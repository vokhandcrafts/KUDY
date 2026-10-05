// G16.04 — behavioral proof of the author report on real Postgres (PGlite,
// the feedback-pglite.test.ts idiom): the committed report query
// (supabase/queries/feedback-report.sql) is applied verbatim over the
// committed feedback migration and must aggregate only current non-deleted
// rows, one row per full target key (kind, id, version, locale — never
// merged by default), with an edit updating one vote and a delete or a
// device-delete removing the next report's contribution. The query carries
// no device or mutation identity, runs only through administrative access,
// and nothing in discovery consumes ratings — the ranking stays editorial
// (21 §6, 20 §F04).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DEVICE_DELETE_SQL } from '../../supabase/functions/_shared/device-core.ts';
import { feedbackOperation, handleFeedbackEdgeRequest } from '../../supabase/functions/feedback/feedback-wire.ts';
import { AGGREGATE_FIELDS } from '../../tools/feedback-report/export.mjs';
import {
  feedbackRequest,
  freshFeedbackDatabase,
  pgliteFeedbackClient,
  publishFixtureTargets,
  registerFeedbackDevice,
  testFeedbackConfig,
} from '../../supabase/tests/feedback/test-support.ts';
import { EDGE_URL, deleteRating, findRow, guide, place, putRating, readReport, repoRoot } from './report-support.ts';

// --- structural guards (fail on revert, implementation-rules 1) ---

test('guard: the report query is a single read-only statement with no identity columns', () => {
  const withoutComments = fs
    .readFileSync(path.join(repoRoot, 'supabase', 'queries', 'feedback-report.sql'), 'utf8')
    .replace(/--[^\n]*/g, '')
    .trim();
  assert.match(withoutComments, /^(with|select)\b/i, 'the report is one query, not a script');
  assert.doesNotMatch(
    withoutComments,
    /\b(insert|update|delete|drop|alter|grant|revoke|create)\b/i,
    'the report query never writes and never changes grants',
  );
  assert.doesNotMatch(withoutComments, /\bdevice_id\b|\bmutation_id\b|\bpayload_hash\b|\bip_hash\b|\bsecret\b/i, 'no identity column is selectable');
});

test('guard: the wire exposes no report route for mobile credentials', async (t) => {
  assert.equal(feedbackOperation({ method: 'POST', url: `${EDGE_URL}/report`, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }), null);
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  const response = await handleFeedbackEdgeRequest(
    feedbackRequest({ method: 'POST', url: `${EDGE_URL}/report`, body: {}, secret: null }),
    pgliteFeedbackClient(db),
    testFeedbackConfig(),
  );
  assert.equal(response.status, 404);
});

test('guard: no edge function wires the report or retention query files', () => {
  const functionsDir = path.join(repoRoot, 'supabase', 'functions');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && /feedback-report|feedback-retention|queries\//.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(functionsDir);
  assert.deepEqual(offenders, [], 'the aggregate query is admin-run, never wired into an edge function');
});

test('guard: discovery, nearby and catalog code imports nothing from feedback', () => {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        /discover|nearby|catalog/.test(path.relative(repoRoot, full)) &&
        /^\s*import[^\n]*feedback/im.test(fs.readFileSync(full, 'utf8'))
      ) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'controllers'));
  walk(path.join(repoRoot, 'services'));
  assert.deepEqual(offenders, [], 'the discovery order is editorial and reads no ratings (20 §F04, 21 §6)');
});

// --- behavioral aggregation over the production path ---

test('an edit updates the one vote it already contributed', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const device = await registerFeedbackDevice(db);

  const created = await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 5, ['interesting_stories']);
  assert.equal(created.status, 200);
  const edited = await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 3, ['clear_delivery'], created.body.revision as number);
  assert.equal(edited.status, 200);

  const rows = await readReport(db);
  assert.equal(rows.length, 1, 'the edit replaced the vote, it did not add one');
  const row = findRow(rows, guide('guide-route-a1', '1', 'be'));
  assert.equal(row.rating_count, 1);
  assert.equal(Number(row.mean_score), 3);
  assert.equal(row.hist_5, 0);
  assert.equal(row.hist_3, 1);
  assert.deepEqual(row.reason_counts, { clear_delivery: 1 }, 'the edit replaced the reasons too');
});

test('a delete removes the next report contribution; a device-delete does the same', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const first = await registerFeedbackDevice(db);
  const second = await registerFeedbackDevice(db);
  const third = await registerFeedbackDevice(db);
  await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 3);
  const secondRating = await putRating(db, second.secret, guide('guide-route-a1', '1', 'be'), 4);
  const thirdRating = await putRating(db, third.secret, guide('guide-route-a1', '1', 'be'), 5);

  const afterTwo = await readReport(db);
  assert.equal(findRow(afterTwo, guide('guide-route-a1', '1', 'be')).rating_count, 3);

  const deleted = await deleteRating(db, second.secret, guide('guide-route-a1', '1', 'be'), secondRating.body.revision as number);
  assert.equal(deleted.status, 200);
  const afterDelete = await readReport(db);
  assert.equal(findRow(afterDelete, guide('guide-route-a1', '1', 'be')).rating_count, 2, 'the tombstone left the aggregates immediately');
  assert.deepEqual(findRow(afterDelete, guide('guide-route-a1', '1', 'be')).reason_counts, {});

  await db.query(DEVICE_DELETE_SQL, [third.deviceId]);
  const afterDeviceDelete = await readReport(db);
  assert.equal(findRow(afterDeviceDelete, guide('guide-route-a1', '1', 'be')).rating_count, 1, 'the device cascade removed its contribution');
});

test('kind, version and locale are never merged by default', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [
    guide('guide-route-a1', '1', 'be'),
    guide('guide-route-a1', '2', 'be'),
    guide('guide-route-a1', '1', 'en'),
    place('place-a1', '1', 'be'),
  ]);
  const devices = await Promise.all([registerFeedbackDevice(db), registerFeedbackDevice(db), registerFeedbackDevice(db), registerFeedbackDevice(db)]);

  await putRating(db, devices[0].secret, guide('guide-route-a1', '1', 'be'), 4);
  await putRating(db, devices[1].secret, guide('guide-route-a1', '2', 'be'), 5);
  const extraSecond = await putRating(db, devices[1].secret, guide('guide-route-a1', '2', 'be'), 4, [], 1);
  assert.equal(extraSecond.status, 200, 'the same device re-rating a different version is a separate key');
  await putRating(db, devices[1].secret, guide('guide-route-a1', '1', 'en'), 2);
  await putRating(db, devices[2].secret, place('place-a1', '1', 'be'), 5);
  await putRating(db, devices[3].secret, guide('guide-route-a1', '1', 'be'), 2);

  const rows = await readReport(db);
  assert.equal(rows.length, 4, 'four keys, four rows');
  assert.equal(findRow(rows, guide('guide-route-a1', '1', 'be')).rating_count, 2);
  assert.equal(findRow(rows, guide('guide-route-a1', '2', 'be')).rating_count, 1, 'the version 2 edit kept one vote');
  assert.equal(findRow(rows, guide('guide-route-a1', '1', 'en')).rating_count, 1);
  assert.equal(findRow(rows, place('place-a1', '1', 'be')).rating_count, 1);
});

test('evidence weight stays visible: one five-star vote is not thirty ratings', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be'), guide('guide-route-b2', '1', 'be')]);
  const single = await registerFeedbackDevice(db);
  await putRating(db, single.secret, guide('guide-route-a1', '1', 'be'), 5);

  for (let i = 0; i < 30; i += 1) {
    const device = await registerFeedbackDevice(db);
    await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), i < 12 ? 4 : 5);
  }

  const rows = await readReport(db);
  const crowd = findRow(rows, guide('guide-route-a1', '1', 'be'));
  assert.equal(crowd.rating_count, 31);
  assert.equal(Number(crowd.mean_score), 4.61, 'twelve 4s and nineteen 5s average 4.61 at two decimals');
  assert.equal(crowd.hist_4, 12);
  assert.equal(crowd.hist_5, 19);

  // The rounded mean lands on an exact 4.6 only on its own target: two 4s
  // and three 5s (23/5) — a separate key, never merged into the crowd above.
  const devices = await Promise.all([
    registerFeedbackDevice(db),
    registerFeedbackDevice(db),
    registerFeedbackDevice(db),
    registerFeedbackDevice(db),
    registerFeedbackDevice(db),
  ]);
  const scores = [4, 4, 5, 5, 5];
  for (const [index, device] of devices.entries()) {
    await putRating(db, device.secret, guide('guide-route-b2', '1', 'be'), scores[index]);
  }
  const exact = findRow(await readReport(db), guide('guide-route-b2', '1', 'be'));
  assert.equal(exact.rating_count, 5);
  assert.equal(Number(exact.mean_score), 4.6, 'two 4s and three 5s average exactly 4.6 on their own target');
});

test('reason counts aggregate per code without merging kinds', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const first = await registerFeedbackDevice(db);
  const second = await registerFeedbackDevice(db);
  await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 3, ['audio_problem', 'too_long']);
  await putRating(db, second.secret, guide('guide-route-a1', '1', 'be'), 4, ['audio_problem']);

  const rows = await readReport(db);
  assert.deepEqual(findRow(rows, guide('guide-route-a1', '1', 'be')).reason_counts, { audio_problem: 2, too_long: 1 });
});

test('the report row shape is exactly the export allowlist', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const device = await registerFeedbackDevice(db);
  await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 3, ['too_long']);

  const rows = await readReport(db);
  assert.deepEqual(Object.keys(rows[0]).sort(), [...AGGREGATE_FIELDS].sort());
});

test('anonymous and authenticated mobile roles cannot read the rated rows', async (t) => {
  const db = await freshFeedbackDatabase();
  t.after(() => db.close());
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be')]);
  const device = await registerFeedbackDevice(db);
  await putRating(db, device.secret, guide('guide-route-a1', '1', 'be'), 3);

  for (const role of ['anon', 'authenticated']) {
    await db.query(`set role ${role}`);
    try {
      await assert.rejects(
        db.query('select target_kind, score from feedback_current limit 1'),
        (error: { code?: string; message: string }) => error.code === '42501' || /permission denied/.test(error.message),
        `${role} must be denied by RLS`,
      );
    } finally {
      await db.query('reset role');
    }
  }
});
