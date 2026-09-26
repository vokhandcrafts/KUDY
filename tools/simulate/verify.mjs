// G05.06.b — the trace-set runner (09 §11 «CI параўноўвае запускі з чаканнямі
// канкрэтнага трэка: не патрабуе ўсіх кропак у частковай прагулцы»): every
// committed trace replays and is compared with its OWN expectation — the
// explicit mustFire/mustNotFire lists first, then the byte-stable report line
// by line. A changed expectation or a changed engine outcome fails naming the
// trace and the first differing report line; a partial walk never borrows
// another trace's expectation.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseTrace } from './trace-schema.mjs';
import { simulate } from './run.mjs';

// The report name the expectations pin. The report embeds the trace name, so
// the runner and the capture step must use the same stable relative form —
// never the caller's absolute path.
export function stableTraceName(traceFile) {
  return `traces/${String(path.basename(traceFile))}`;
}

function firstLineDiff(expectedText, actualText) {
  const expectedLines = expectedText.split('\n');
  const actualLines = actualText.split('\n');
  const longest = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < longest; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      return {
        line: i + 1,
        expected: expectedLines[i] ?? '<end of report>',
        actual: actualLines[i] ?? '<end of report>',
      };
    }
  }
  return null;
}

/**
 * One trace against one expectation. Returns null when the replay matches,
 * otherwise a failure message naming the trace and the first divergence.
 * Corrupt inputs (unreadable files, broken JSON, an invalid trace document)
 * are failures with named diagnostics — never thrown errors.
 */
export function verifyTrace(traceFile, expectationFile, { name = stableTraceName(traceFile) } = {}) {
  let doc;
  let expectation;
  try {
    doc = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  } catch (error) {
    return `trace ${name}: cannot read the trace file — ${error.message}`;
  }
  try {
    expectation = JSON.parse(fs.readFileSync(expectationFile, 'utf8'));
  } catch (error) {
    return `trace ${name}: cannot read the expectation file — ${error.message}`;
  }
  const parsed = parseTrace(doc);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    return `trace ${name}: the trace is corrupt — [${first.code}] ${first.message}`;
  }
  if (expectation.trace !== undefined && expectation.trace !== path.basename(traceFile)) {
    return `trace ${name}: the expectation names trace '${String(expectation.trace)}', not this trace`;
  }

  const { report, exit } = simulate(doc, { name });
  const actual = JSON.parse(report);

  if (!Array.isArray(expectation.mustFire) || !Array.isArray(expectation.mustNotFire)) {
    return `trace ${name}: the expectation carries no mustFire/mustNotFire lists`;
  }
  if (!isDeepStrictEqual(actual.session.autoFired, expectation.mustFire)) {
    return (
      `trace ${name}: autoFired ${JSON.stringify(actual.session.autoFired)} ` +
      `does not match mustFire ${JSON.stringify(expectation.mustFire)}`
    );
  }
  const forbidden = actual.session.autoFired.filter((stopId) => expectation.mustNotFire.includes(stopId));
  if (forbidden.length > 0) {
    return `trace ${name}: stop '${forbidden[0]}' fired but mustNotFire lists it`;
  }
  if (exit !== expectation.exit) {
    return `trace ${name}: exit ${String(exit)}, the expectation says ${String(expectation.exit)}`;
  }
  const expectedText = `${JSON.stringify(expectation.report, null, 2)}\n`;
  const diff = firstLineDiff(expectedText, report);
  if (diff !== null) {
    return (
      `trace ${name}: the report diverges from the expectation at line ${String(diff.line)} — ` +
      `expected: ${JSON.stringify(diff.expected)} actual: ${JSON.stringify(diff.actual)}`
    );
  }
  return null;
}

/**
 * The whole committed set: every trace pairs with exactly one expectation of
 * its own (orphans in either direction are failures — an expectation covering
 * "all stops" instead of its trace cannot hide here).
 */
export function verifyTraceSet({ tracesDir, expectationsDir }) {
  const traceFiles = fs
    .readdirSync(tracesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const expectationFiles = fs
    .readdirSync(expectationsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const failures = [];
  for (const file of traceFiles) {
    const stem = file.replace(/\.json$/, '');
    const expectationFile = path.join(expectationsDir, `${stem}.json`);
    if (!fs.existsSync(expectationFile)) {
      failures.push({ trace: `traces/${file}`, message: `trace traces/${file}: no expectation file for this trace` });
      continue;
    }
    const message = verifyTrace(path.join(tracesDir, file), expectationFile);
    if (message !== null) failures.push({ trace: `traces/${file}`, message });
  }
  for (const file of expectationFiles) {
    const traceFile = path.join(tracesDir, file);
    if (!fs.existsSync(traceFile)) {
      failures.push({
        trace: `expectations/${file}`,
        message: `expectation expectations/${file} has no trace file — expectations are per trace`,
      });
    }
  }
  return { failures };
}
