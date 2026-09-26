#!/usr/bin/env node
// G05.06.a — the simulate CLI: `node tools/simulate/cli.mjs --trace <file>
// [--out <file>]`. Exit codes: 0 — the replay completed (a partial walk is a
// fine outcome); 1 — the replay completed but a segment was still playing at
// the end (stuck_playing, 09 §11); 2 — the trace is corrupt: named
// diagnostics, nothing ran. The report is byte-identical for the same trace
// (deterministic clock, no wall time, sorted output).
import fs from 'node:fs';
import { simulate } from './run.mjs';
import { parseTrace } from './trace-schema.mjs';

function usage() {
  return 'usage: node tools/simulate/cli.mjs --trace <trace.json> [--out <report.json>]';
}

function fail(message) {
  process.stderr.write(`simulate: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const traceArg = args.indexOf('--trace') === -1 ? null : args[args.indexOf('--trace') + 1];
const outArg = args.indexOf('--out') === -1 ? null : args[args.indexOf('--out') + 1];
if (!traceArg || traceArg.startsWith('--') || (outArg !== null && outArg.startsWith('--'))) {
  fail(usage());
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(traceArg, 'utf8'));
} catch (error) {
  fail(`cannot read the trace file ${traceArg}: ${error.message}`);
}

const parsed = parseTrace(doc);
if (!parsed.ok) {
  process.stderr.write(
    `simulate: the trace is corrupt — ${String(parsed.diagnostics.length)} diagnostic(s)\n` +
      // The parser's messages carry their own position (events[i]/stops[i]);
      // the CLI adds only the named code.
      parsed.diagnostics.map((d) => `  [${d.code}] ${d.message}`).join('\n') +
      '\n',
  );
  process.exit(2);
}

const name = traceArg;
let result;
try {
  result = simulate(doc, { name });
} catch (error) {
  fail(`the replay crashed — this is a simulator bug, not a trace defect: ${error.message}`);
}

if (outArg) fs.writeFileSync(outArg, result.report, 'utf8');
else process.stdout.write(result.report);
process.exit(result.exit);
