#!/usr/bin/env node
// G16.04 — the feedback report CLI (docs/architecture/21 §6). The aggregate
// query itself lives in supabase/queries/feedback-report.sql and runs only
// through the existing administrative access (MFA admin, dashboard or psql);
// this tool never opens a connection — it turns the query's CSV output into
// the saved private export and manages the saved files:
//
//   psql "$ADMIN_DB_URL" --csv -f supabase/queries/feedback-report.sql > raw.csv
//   node tools/feedback-report/cli.mjs --from-csv raw.csv
//   node tools/feedback-report/cli.mjs --list-saved
//   node tools/feedback-report/cli.mjs --remove-saved <name> | --all
//
// A refused input exits 1 with named diagnostics on stderr; the export file
// lands under .scratch/feedback-reports/ (git-ignored — never committed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFeedbackReportCsv } from './csv.mjs';
import { buildFeedbackExport } from './export.mjs';
import { listSavedExports, removeSavedExports, saveFeedbackExport } from './store.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT_DIR = path.join(repoRoot, '.scratch', 'feedback-reports');

function printDiagnostics(diagnostics) {
  for (const entry of diagnostics) {
    process.stderr.write(`diagnostic: ${entry.code} at ${entry.field}: ${entry.detail}\n`);
  }
}

function readInputText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    printDiagnostics([{ code: 'cli-input-unreadable', field: file, detail: error.message }]);
    process.exitCode = 1;
    return null;
  }
}

function run(argv) {
  const options = { outDir: DEFAULT_OUT_DIR };
  const VALUE_FLAGS = new Set(['--out-dir', '--from-csv', '--remove-saved', '--computed-at']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--list-saved') {
      options.listSaved = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      printDiagnostics([{ code: 'cli-unknown-argument', field: String(flag), detail: 'unknown flag' }]);
      process.exitCode = 1;
      return;
    }
    const value = argv[i + 1];
    if (typeof value !== 'string') {
      printDiagnostics([{ code: 'cli-missing-value', field: flag, detail: 'the flag expects a value' }]);
      process.exitCode = 1;
      return;
    }
    i += 1;
    if (flag === '--out-dir') options.outDir = value;
    else if (flag === '--from-csv') options.fromCsv = value;
    else if (flag === '--remove-saved') options.removeSaved = value;
    else if (flag === '--computed-at') options.computedAt = value;
  }

  if (options.listSaved === true) {
    for (const entry of listSavedExports(options.outDir)) {
      const period = entry.period ? `${entry.period.from} .. ${entry.period.to}` : 'empty';
      process.stdout.write(`${entry.file}\tcomputed ${entry.computed_at ?? 'unknown'}\tperiod ${period}\t${entry.aggregate_count ?? '?'} aggregates\n`);
    }
    return;
  }

  if (typeof options.removeSaved === 'string') {
    const result = removeSavedExports(options.outDir, options.removeSaved === '--all' ? { all: true } : { names: [options.removeSaved] });
    for (const name of result.removed) process.stdout.write(`removed: ${name}\n`);
    for (const name of result.missing) process.stdout.write(`missing: ${name}\n`);
    if (!result.ok || result.missing.length > 0) {
      printDiagnostics(result.diagnostics);
      process.exitCode = 1;
    }
    return;
  }

  if (typeof options.fromCsv === 'string') {
    const text = readInputText(options.fromCsv);
    if (text === null) return;
    const parsed = parseFeedbackReportCsv(text);
    if (!parsed.ok) {
      printDiagnostics(parsed.diagnostics);
      process.exitCode = 1;
      return;
    }
    const built = buildFeedbackExport(parsed.rows, { computedAt: options.computedAt ?? new Date().toISOString() });
    if (!built.ok) {
      printDiagnostics(built.diagnostics);
      process.exitCode = 1;
      return;
    }
    const saved = saveFeedbackExport(options.outDir, built.doc);
    if (!saved.ok) {
      printDiagnostics(saved.diagnostics);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`saved: ${saved.file}\naggregates: ${built.doc.aggregates.length}\n`);
    return;
  }

  printDiagnostics([{ code: 'cli-no-command', field: 'argv', detail: 'pass --from-csv <file>, --list-saved or --remove-saved <name|--all>' }]);
  process.exitCode = 1;
}

// The demo and the tests drive run() directly; a shell call runs the CLI body.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2));
}

export { run };
