// G16.04 — the export builder and the CSV reader. Every refusal here is a
// named diagnostic that fails the export whole: the privacy allowlist must
// reject identity-bearing fields, the consistency checks must reject a
// histogram that does not sum to its count, and a corrupt CSV must never
// become a silently wrong export (implementation-rules 14).
import assert from 'node:assert/strict';
import test from 'node:test';

import { AGGREGATE_FIELDS, buildFeedbackExport } from './export.mjs';
import { parseFeedbackReportCsv } from './csv.mjs';

const FIXED_AT = '2026-10-04T19:00:00.000Z';

function validRow(overrides = {}) {
  return {
    target_kind: 'guide',
    target_id: 'guide-route-a1',
    target_version: '1',
    locale: 'be',
    rating_count: 3,
    mean_score: 4.33,
    hist_1: 0,
    hist_2: 0,
    hist_3: 1,
    hist_4: 0,
    hist_5: 2,
    first_rated_at: '2026-09-01T10:00:00.000Z',
    last_rated_at: '2026-09-20T10:00:00.000Z',
    reason_counts: { clear_delivery: 2 },
    ...overrides,
  };
}

test('guard: the export field list has no identity-bearing column', () => {
  for (const field of AGGREGATE_FIELDS) {
    assert.doesNotMatch(field, /device|mutation|secret|payload|ip_hash/, `${field} must never carry identity`);
  }
});

test('a valid row builds an export with period and computation time', () => {
  const result = buildFeedbackExport([validRow()], { computedAt: FIXED_AT });
  assert.equal(result.ok, true);
  assert.equal(result.doc.schema_version, 1);
  assert.equal(result.doc.kind, 'feedback-report');
  assert.equal(result.doc.computed_at, FIXED_AT);
  assert.deepEqual(result.doc.period, { from: '2026-09-01T10:00:00.000Z', to: '2026-09-20T10:00:00.000Z' });
  assert.equal(result.doc.aggregates.length, 1);
});

test('an empty query result is a valid empty export with a null period', () => {
  const result = buildFeedbackExport([], { computedAt: FIXED_AT });
  assert.equal(result.ok, true);
  assert.equal(result.doc.period, null);
  assert.deepEqual(result.doc.aggregates, []);
});

test('a device_id in the input refuses the export with a named diagnostic', () => {
  const result = buildFeedbackExport([validRow({ device_id: '11111111-1111-4111-8111-111111111111' })], { computedAt: FIXED_AT });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.filter((entry) => entry.code === 'export-identity-field').map((entry) => entry.field),
    ['aggregates[0].device_id'],
  );
});

test('a mutation_id or ip_hash is refused the same way', () => {
  for (const field of ['mutation_id', 'ip_hash']) {
    const result = buildFeedbackExport([validRow({ [field]: 'leak' })], { computedAt: FIXED_AT });
    assert.equal(result.ok, false, field);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'export-identity-field' && entry.field.endsWith(field)), field);
  }
});

test('an unknown extra field is refused even without identity in it', () => {
  const result = buildFeedbackExport([validRow({ raw_comment: 'anything' })], { computedAt: FIXED_AT });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'export-unknown-field'));
});

test('a missing field is refused', () => {
  const row = validRow();
  delete row.mean_score;
  const result = buildFeedbackExport([row], { computedAt: FIXED_AT });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'export-missing-field' && entry.field.endsWith('mean_score')));
});

test('a histogram that does not sum to its count is refused', () => {
  const result = buildFeedbackExport([validRow({ hist_5: 3 })], { computedAt: FIXED_AT });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'export-histogram-mismatch'));
});

test('a reason count above the group size is refused', () => {
  const result = buildFeedbackExport([validRow({ reason_counts: { clear_delivery: 4 } })], { computedAt: FIXED_AT });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === 'export-reason-count-impossible'));
});

test('an inverted period, a bad kind and a wrong-scale mean are refused', () => {
  const inverted = buildFeedbackExport([validRow({ first_rated_at: '2026-09-21T10:00:00.000Z' })], { computedAt: FIXED_AT });
  assert.ok(inverted.diagnostics.some((entry) => entry.code === 'export-period-inverted'));
  const kind = buildFeedbackExport([validRow({ target_kind: 'collection' })], { computedAt: FIXED_AT });
  assert.ok(kind.diagnostics.some((entry) => entry.code === 'export-unknown-kind'));
  const mean = buildFeedbackExport([validRow({ mean_score: 5.5 })], { computedAt: FIXED_AT });
  assert.ok(mean.diagnostics.some((entry) => entry.code === 'export-mean-out-of-range'));
});

test('a non-array input and a bad computed_at answer with diagnostics, never a throw', () => {
  assert.equal(buildFeedbackExport('rows', { computedAt: FIXED_AT }).ok, false);
  assert.equal(buildFeedbackExport([], { computedAt: 'not-a-date' }).ok, false);
});

test('the CSV reader parses psql --csv output into typed rows', () => {
  const csv = [
    'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts',
    'guide,guide-route-a1,1,be,3,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,"{""clear_delivery"": 2}"',
    'place,place-a1,1,en,1,5.00,0,0,0,0,1,2026-09-02T10:00:00Z,2026-09-02T10:00:00Z,{}',
  ].join('\n');
  const parsed = parseFeedbackReportCsv(csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].rating_count, 3);
  assert.equal(parsed.rows[0].mean_score, 4.33);
  assert.deepEqual(parsed.rows[0].reason_counts, { clear_delivery: 2 });
  assert.deepEqual(parsed.rows[1].reason_counts, {});
  const built = buildFeedbackExport(parsed.rows, { computedAt: FIXED_AT });
  assert.equal(built.ok, true);
});

test('the CSV reader answers with diagnostics on a broken file, never a throw', () => {
  assert.equal(parseFeedbackReportCsv('').ok, false);
  const wrongHeader = parseFeedbackReportCsv('a,b\n1,2');
  assert.equal(wrongHeader.ok, false);
  assert.ok(wrongHeader.diagnostics.some((entry) => entry.code === 'csv-header-mismatch'));
  const shortRecord = parseFeedbackReportCsv(
    'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts\n' +
      'guide,guide-route-a1,1,be,3',
  );
  assert.equal(shortRecord.ok, false);
  assert.ok(shortRecord.diagnostics.some((entry) => entry.code === 'csv-record-shape'));
  const badJson = parseFeedbackReportCsv(
    'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts\n' +
      'guide,guide-route-a1,1,be,3,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,not-json',
  );
  assert.equal(badJson.ok, false);
  assert.ok(badJson.diagnostics.some((entry) => entry.code === 'csv-field-not-json'));
  const badNumber = parseFeedbackReportCsv(
    'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts\n' +
      'guide,guide-route-a1,1,be,many,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,{}',
  );
  assert.equal(badNumber.ok, false);
  assert.ok(badNumber.diagnostics.some((entry) => entry.code === 'csv-field-not-number'));
  const multiline = parseFeedbackReportCsv(
    'target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts\n' +
      'guide,guide-route-a1,1,be,3,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,"{\n""clear_delivery"": 2}"',
  );
  assert.equal(multiline.ok, false, 'a newline inside a quoted field is refused, never silently shifted');
  assert.ok(multiline.diagnostics.some((entry) => entry.code === 'csv-unterminated-quote'));
});
