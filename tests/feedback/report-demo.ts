// G16.04 — the Showboat demo driver (docs/demos/2026-10-04-g1604-feedback-report.md):
// a deterministic trace of the report lifecycle over real Postgres (PGlite) —
// ratings through the production edge-wire path, the committed report query,
// an edit collapsing into one vote, the retention sweep and the 409 that
// meets a queued edit replayed after it. Timestamps stay out of the trace
// (they are wall-clock); the exported CLI flow is demoed in its own block.
import {
  freshFeedbackDatabase,
  publishFixtureTargets,
  registerFeedbackDevice,
} from '../../supabase/tests/feedback/test-support.ts';
import { feedbackRetentionSql, findRow, guide, place, putRating, readReport } from './report-support.ts';

const show = (row: Record<string, unknown>) =>
  `${row.target_kind}:${row.target_id}@${row.target_version}/${row.locale} count=${row.rating_count} mean=${Number(row.mean_score).toFixed(2)} hist=${[1, 2, 3, 4, 5].map((i) => row[`hist_${i}`]).join('/')} reasons=${JSON.stringify(row.reason_counts)}`;

const db = await freshFeedbackDatabase();
try {
  await publishFixtureTargets(db, [guide('guide-route-a1', '1', 'be'), place('place-a1', '1', 'be')]);
  const first = await registerFeedbackDevice(db);
  const second = await registerFeedbackDevice(db);
  const third = await registerFeedbackDevice(db);

  const created = await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 5, ['interesting_stories']);
  await putRating(db, second.secret, guide('guide-route-a1', '1', 'be'), 4);
  await putRating(db, third.secret, place('place-a1', '1', 'be'), 3, ['worth_visiting']);

  const rows = await readReport(db);
  console.log(`report     : ${rows.length} keys`);
  for (const row of rows) console.log(`  ${show(row)}`);

  const edited = await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 3, ['clear_delivery'], created.body.revision as number);
  console.log(`after edit : status=${edited.status} ${show(findRow(await readReport(db), guide('guide-route-a1', '1', 'be')))}`);

  await db.query("update feedback_current set updated_at = now() - interval '15 months' where target_id = 'guide-route-a1'");
  await db.exec(feedbackRetentionSql());
  const survived = await readReport(db);
  console.log(`after sweep: ${survived.length} keys (${survived.map((row) => row.target_id).join(', ')})`);

  const replay = await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 4, [], 1);
  console.log(`replay edit: status=${replay.status} error=${replay.body.error ?? '—'}`);
  const freshVote = await putRating(db, first.secret, guide('guide-route-a1', '1', 'be'), 4, [], 0);
  console.log(`new rating : status=${freshVote.status} keys after=${(await readReport(db)).length}`);
} finally {
  await db.close();
}
