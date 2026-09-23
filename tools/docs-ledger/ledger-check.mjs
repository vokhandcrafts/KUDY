// The gate: `npm run ledger:check`. A baseline item that is present neither
// in the docs/ tree nor in dropped.json exits nonzero and names the item.
// Corrupt baseline or dropped.json yields a named diagnostic, not a crash.
// Policy lives in tools/docs-ledger/README.md.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { checkLedger } from './ledger.mjs';

const BASELINE_FILE = path.join('tools', 'docs-ledger', 'baseline.json');
const DROPPED_FILE = path.join('tools', 'docs-ledger', 'dropped.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`ledger-check: FAIL — ${file} is missing or not valid JSON: ${err.message}`);
    process.exit(2);
  }
}

const baseline = readJson(BASELINE_FILE);
const dropped = readJson(DROPPED_FILE);

let result;
try {
  result = checkLedger({ baseline, dropped, repoRoot: process.cwd() });
} catch (err) {
  console.error(`ledger-check: FAIL — ${err.message}`);
  process.exit(2);
}

if (result.lost.length > 0) {
  console.error(
    `ledger-check: FAIL — ${result.lost.length} baseline item(s) missing from docs/ and not covered by dropped.json:`,
  );
  for (const item of result.lost) {
    const where = item.kind === 'heading' ? ` (file: ${item.file})` : '';
    console.error(`- ${item.kind}: ${item.value}${where}`);
  }
  console.error('Record the loss in tools/docs-ledger/dropped.json (reason + replacement link or commit SHA) or restore the fact.');
  process.exit(1);
}

console.log(
  `ledger-check: OK — ${result.baselineCount} baseline item(s), `
    + `${result.currentCount} in docs/ now, ${result.coveredCount} dropped entry(ies), 0 lost`,
);
