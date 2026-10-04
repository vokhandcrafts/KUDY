// G16.04 — the CSV input reader for the report tool. The author produces the
// aggregate rows with the existing administrative access, e.g.
// `psql "$ADMIN_DB_URL" --csv -f supabase/queries/feedback-report.sql`, and
// hands the file to the CLI; this module is the single parsing point between
// psql's RFC 4180 output and the export builder's typed rows. A malformed
// file answers with named diagnostics, never a thrown error
// (implementation-rules 14).
//
// The header allowlist is imported from export.mjs (which mirrors the
// feedback-report.sql column list) — the reader restates nothing.
import { AGGREGATE_FIELDS } from './export.mjs';

const NUMERIC_FIELDS = new Set(['rating_count', 'mean_score', 'hist_1', 'hist_2', 'hist_3', 'hist_4', 'hist_5']);
const JSON_FIELDS = new Set(['reason_counts']);

/** Splits one RFC 4180 record line respecting quoted commas and doubled quotes. */
function splitRecord(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return { fields, unterminatedQuote: inQuotes };
}

function coerceValue(field, value) {
  if (JSON_FIELDS.has(field)) return { parsed: JSON.parse(value) };
  if (NUMERIC_FIELDS.has(field)) return { parsed: Number(value) };
  return { parsed: value };
}

/**
 * Parses psql `--csv` output of the report query into typed aggregate rows.
 * Answers `{ok: true, rows}` or `{ok: false, diagnostics}` — the caller
 * shows the diagnostics and refuses the export.
 */
export function parseFeedbackReportCsv(text) {
  const diagnostics = [];
  if (typeof text !== 'string') {
    return { ok: false, diagnostics: [{ code: 'csv-input-not-text', field: 'input', detail: 'expected file text' }] };
  }
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line, index, all) => !(line === '' && index === all.length - 1));
  if (lines.length === 0) {
    return { ok: false, diagnostics: [{ code: 'csv-empty', field: 'input', detail: 'no header row found' }] };
  }
  const header = splitRecord(lines[0]);
  if (header.unterminatedQuote) {
    return {
      ok: false,
      diagnostics: [
        { code: 'csv-unterminated-quote', field: 'header', detail: 'a quoted field is never closed (a multiline value? the reader takes one record per line)' },
      ],
    };
  }
  const missing = AGGREGATE_FIELDS.filter((column) => !header.fields.includes(column));
  if (missing.length > 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'csv-header-mismatch', field: 'header', detail: `missing columns: ${missing.join(', ')}` }],
    };
  }
  const rows = [];
  for (const [index, line] of lines.slice(1).entries()) {
    if (line === '') continue;
    const record = splitRecord(line);
    if (record.unterminatedQuote) {
      diagnostics.push({
        code: 'csv-unterminated-quote',
        field: `line ${index + 2}`,
        detail: 'a quoted field is never closed (a multiline value? the reader takes one record per line)',
      });
      continue;
    }
    const fields = record.fields;
    if (fields.length !== header.fields.length) {
      diagnostics.push({
        code: 'csv-record-shape',
        field: `line ${index + 2}`,
        detail: `${fields.length} fields, header has ${header.fields.length}`,
      });
      continue;
    }
    const row = {};
    let rowBroken = false;
    for (const [position, column] of header.fields.entries()) {
      try {
        row[column] = coerceValue(column, fields[position]).parsed;
      } catch {
        diagnostics.push({ code: 'csv-field-not-json', field: `line ${index + 2}.${column}`, detail: 'expected JSON (the reason_counts object)' });
        rowBroken = true;
        break;
      }
    }
    if (!rowBroken) rows.push(row);
  }
  for (const [index, row] of rows.entries()) {
    for (const field of NUMERIC_FIELDS) {
      if (typeof row[field] !== 'number' || Number.isNaN(row[field])) {
        diagnostics.push({ code: 'csv-field-not-number', field: `aggregates[${index}].${field}`, detail: `value ${JSON.stringify(row[field])} is not a number` });
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, rows };
}
