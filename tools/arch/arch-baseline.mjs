// Regenerates the arch baseline (`npm run arch:baseline`): rewrites
// tools/arch/baseline.json from the current state of the repository, keeping
// the `since` date of entries that already existed. Baseline updates happen
// only in review — this command is for that conscious maintenance pass, not
// for silencing a red gate; every entry must carry its explanation in
// tools/arch/README.md, which this command lists explicitly.
import fs from 'node:fs';
import process from 'node:process';
import {
  errorViolations,
  parseCruiseArgs,
  runCruise,
  violationKey,
} from './depcruise-run.mjs';

const args = parseCruiseArgs(process.argv.slice(2));
if (args.error) {
  console.error(`arch:baseline: FAIL\n${args.error}`);
  process.exit(2);
}

let previous = { generated: null, entries: [] };
try {
  previous = JSON.parse(fs.readFileSync(args.baselineFile, 'utf8'));
  if (!Array.isArray(previous.entries)) throw new Error('no "entries" array');
} catch {
  console.log(`arch:baseline: no usable previous baseline at ${args.baselineFile} — starting fresh`);
}

const run = runCruise({ configFile: args.configFile, dirs: args.dirs, cwd: process.cwd() });
if (run.error) {
  console.error(`arch:baseline: FAIL\n${run.error}`);
  process.exit(2);
}

// Local calendar date (the host is UTC+3 — a UTC slice would date the baseline
// to the previous day for all evening work).
const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const previousByKey = new Map(previous.entries.map((entry) => [violationKey(entry), entry]));
const current = errorViolations(run.result)
  .map((v) => ({ ...v, since: previousByKey.get(violationKey(v))?.since ?? today }))
  .sort((a, b) => violationKey(a).localeCompare(violationKey(b)));

const kept = current.filter((entry) => previousByKey.has(violationKey(entry)));
const added = current.filter((entry) => !previousByKey.has(violationKey(entry)));
const dropped = previous.entries.filter((entry) => !current.some((v) => violationKey(v) === violationKey(entry)));

fs.writeFileSync(
  args.baselineFile,
  JSON.stringify({ generated: today, entries: current }, null, 2) + '\n',
);

console.log(`arch:baseline: wrote ${args.baselineFile} — generated ${today}, ${current.length} entr(ies)`);
for (const entry of added) console.log(`  added:   ${entry.rule}: ${entry.from} -> ${entry.to} (since ${entry.since})`);
for (const entry of kept) console.log(`  kept:    ${entry.rule}: ${entry.from} -> ${entry.to} (since ${entry.since})`);
for (const entry of dropped) console.log(`  dropped: ${entry.rule}: ${entry.from} -> ${entry.to} — remove its explanation from tools/arch/README.md too`);
console.log('arch:baseline: baseline updates happen only in review — every entry needs its explanation in tools/arch/README.md.');
