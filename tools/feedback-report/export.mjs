// G16.04 — the saved private report builder (docs/architecture/21 §6): an
// export carries aggregates only — the per-key count, mean, 1–5 histogram,
// reason counts and the rating period — never device or mutation identity,
// never raw feedback rows. AGGREGATE_FIELDS is the allowlist: it mirrors the
// column list of supabase/queries/feedback-report.sql (the query is the
// canonical producer), and a row carrying an unknown or identity-bearing
// field is refused with a named diagnostic — validated at the boundary,
// never sanitized silently (implementation-rules 14).
//
// Saved exports carry their computation time and data period (21 §6:
// «Захаваныя экспарты маюць перыяд і час разліку»); they do not survive
// source-row deletion — docs/runbooks/feedback.md mandates removing and
// re-creating them after any device-delete or retention sweep.

export const EXPORT_SCHEMA_VERSION = 1;

/** The exact aggregate row shape the report query produces (mirrors its column list). */
export const AGGREGATE_FIELDS = [
  'target_kind',
  'target_id',
  'target_version',
  'locale',
  'rating_count',
  'mean_score',
  'hist_1',
  'hist_2',
  'hist_3',
  'hist_4',
  'hist_5',
  'first_rated_at',
  'last_rated_at',
  'reason_counts',
];

const IDENTITY_FIELDS = new Set([
  'device_id',
  'mutation_id',
  'payload_hash',
  'secret',
  'secret_hash',
  'ip_hash',
]);

const HISTOGRAM_FIELDS = ['hist_1', 'hist_2', 'hist_3', 'hist_4', 'hist_5'];
const TARGET_KINDS = new Set(['guide', 'place']);

const diagnostic = (code, field, detail) => ({ code, field, detail });

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function validateAggregateRow(row, index) {
  const where = `aggregates[${index}]`;
  const found = [];
  for (const key of Object.keys(row)) {
    if (!AGGREGATE_FIELDS.includes(key)) {
      found.push(
        IDENTITY_FIELDS.has(key)
          ? diagnostic('export-identity-field', `${where}.${key}`, 'identity-bearing field refused')
          : diagnostic('export-unknown-field', `${where}.${key}`, 'field outside the report query column list'),
      );
    }
  }
  for (const field of AGGREGATE_FIELDS) {
    if (!(field in row)) found.push(diagnostic('export-missing-field', `${where}.${field}`, 'required aggregate field absent'));
  }
  if (found.length > 0) return found;

  if (!TARGET_KINDS.has(row.target_kind)) {
    found.push(diagnostic('export-unknown-kind', `${where}.target_kind`, 'kind is guide or place (21 §5.1), never merged'));
  }
  for (const field of ['target_id', 'target_version', 'locale']) {
    if (typeof row[field] !== 'string' || row[field] === '') {
      found.push(diagnostic('export-field-not-string', `${where}.${field}`, 'expected a non-empty string'));
    }
  }
  if (!isInteger(row.rating_count) || row.rating_count < 1) {
    found.push(diagnostic('export-count-invalid', `${where}.rating_count`, 'expected an integer >= 1'));
  }
  if (typeof row.mean_score !== 'number' || !Number.isFinite(row.mean_score) || row.mean_score < 1 || row.mean_score > 5) {
    found.push(diagnostic('export-mean-out-of-range', `${where}.mean_score`, 'expected a finite number within the 1..5 scale'));
  }
  let histogramSum = 0;
  for (const field of HISTOGRAM_FIELDS) {
    if (!isInteger(row[field]) || row[field] < 0) {
      found.push(diagnostic('export-histogram-invalid', `${where}.${field}`, 'expected a non-negative integer'));
    } else {
      histogramSum += row[field];
    }
  }
  if (found.length === 0 && histogramSum !== row.rating_count) {
    found.push(
      diagnostic('export-histogram-mismatch', `${where}`, `histogram buckets sum to ${histogramSum}, rating_count is ${row.rating_count}`),
    );
  }
  for (const field of ['first_rated_at', 'last_rated_at']) {
    if (typeof row[field] !== 'string' || Number.isNaN(Date.parse(row[field]))) {
      found.push(diagnostic('export-timestamp-invalid', `${where}.${field}`, 'expected an ISO 8601 timestamp'));
    }
  }
  if (found.length === 0 && Date.parse(row.first_rated_at) > Date.parse(row.last_rated_at)) {
    found.push(diagnostic('export-period-inverted', `${where}`, 'first_rated_at is after last_rated_at'));
  }
  if (!isPlainObject(row.reason_counts)) {
    found.push(diagnostic('export-reasons-invalid', `${where}.reason_counts`, 'expected an object of reason code -> count'));
  } else {
    for (const [code, count] of Object.entries(row.reason_counts)) {
      if (code === '' || !isInteger(count) || count < 1) {
        found.push(diagnostic('export-reasons-invalid', `${where}.reason_counts.${code || '<empty>'}`, 'expected a non-empty code with an integer count >= 1'));
      } else if (count > row.rating_count) {
        found.push(
          diagnostic('export-reason-count-impossible', `${where}.reason_counts.${code}`, `count ${count} exceeds the group's ${row.rating_count} ratings (at most one vote per code per rating)`),
        );
      }
    }
  }
  return found;
}

/**
 * Builds the saved export document. Answers with a verdict: `{ok: true,
 * doc}` or `{ok: false, diagnostics}` — every row is validated before the
 * first one is projected, so a refused export is refused whole.
 */
export function buildFeedbackExport(rows, { computedAt }) {
  if (!Array.isArray(rows)) {
    return { ok: false, diagnostics: [diagnostic('export-input-not-array', 'rows', 'expected the query result as an array of aggregate rows')] };
  }
  if (typeof computedAt !== 'string' || Number.isNaN(Date.parse(computedAt))) {
    return { ok: false, diagnostics: [diagnostic('export-computed-at-invalid', 'computedAt', 'expected an ISO 8601 timestamp')] };
  }
  const diagnostics = [];
  for (const [index, row] of rows.entries()) {
    diagnostics.push(...validateAggregateRow(isPlainObject(row) ? row : {}, index));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const periods = rows.map((row) => Date.parse(row.first_rated_at));
  const periodEnds = rows.map((row) => Date.parse(row.last_rated_at));
  const doc = {
    schema_version: EXPORT_SCHEMA_VERSION,
    kind: 'feedback-report',
    computed_at: new Date(Date.parse(computedAt)).toISOString(),
    period:
      rows.length === 0
        ? null
        : {
            from: new Date(Math.min(...periods)).toISOString(),
            to: new Date(Math.max(...periodEnds)).toISOString(),
          },
    aggregates: rows.map((row) => {
      const projected = {};
      for (const field of AGGREGATE_FIELDS) projected[field] = row[field];
      return projected;
    }),
  };
  return { ok: true, doc };
}
