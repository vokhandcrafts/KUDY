// Writes tools/docs-ledger/baseline.json from the docs/ tree as it stands at
// the current commit (npm run ledger:baseline) — the one-time bootstrap of the
// fact ledger. Regenerating an existing baseline redefines what counts as a
// fact, so it needs --force and happens only consciously, in review: a loss
// that has already happened is recorded through dropped.json, never erased by
// a re-baseline.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { extractItems, itemKey } from './ledger.mjs';

const BASELINE_FILE = path.join('tools', 'docs-ledger', 'baseline.json');

if (fs.existsSync(BASELINE_FILE) && !process.argv.includes('--force')) {
  console.error(
    'ledger:baseline: FAIL — baseline.json already exists. Regenerating it redefines the frozen fact set;\n'
    + 'pass --force only for a conscious re-baseline in review, and record any loss through dropped.json instead.',
  );
  process.exit(2);
}

const items = [...extractItems('docs').values()].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));

// Local calendar date (the host is UTC+3 — a UTC slice would date the baseline
// to the previous day for all evening work); same idiom as tools/arch.
const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
fs.writeFileSync(BASELINE_FILE, JSON.stringify({ generated: today, items }, null, 2) + '\n');

const perKind = {};
for (const item of items) perKind[item.kind] = (perKind[item.kind] ?? 0) + 1;
console.log(`ledger:baseline: wrote ${BASELINE_FILE} — generated ${today}, ${items.length} item(s)`);
for (const kind of Object.keys(perKind).sort()) console.log(`  ${kind}: ${perKind[kind]}`);
