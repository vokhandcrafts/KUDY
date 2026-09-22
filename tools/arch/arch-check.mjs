// The gate: `npm run arch:check`. New violations exit nonzero; violations
// recorded in the dated baseline pass. Baseline updates happen only in review —
// the policy and the per-entry explanations live in tools/arch/README.md.
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
  console.error(`arch:check: FAIL\n${args.error}`);
  process.exit(2);
}

let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(args.baselineFile, 'utf8'));
} catch (err) {
  console.error(`arch:check: FAIL — baseline file ${args.baselineFile} is missing or not valid JSON: ${err.message}`);
  process.exit(2);
}
if (!Array.isArray(baseline.entries)) {
  console.error(`arch:check: FAIL — baseline file ${args.baselineFile} has no "entries" array (expected { generated, entries })`);
  process.exit(2);
}

const run = runCruise({ configFile: args.configFile, dirs: args.dirs, cwd: process.cwd() });
if (run.error) {
  console.error(`arch:check: FAIL\n${run.error}`);
  process.exit(2);
}

const known = new Set(baseline.entries.map((entry) => violationKey(entry)));
const errors = errorViolations(run.result);
const fresh = errors.filter((v) => !known.has(violationKey(v)));

if (fresh.length > 0) {
  console.error(`arch:check: FAIL — ${fresh.length} violation(s) not in the baseline dated ${baseline.generated}:`);
  for (const v of fresh) console.error(`- ${v.rule}: ${v.from} -> ${v.to}`);
  console.error('Fix the import; baseline an existing violation only consciously, in review (tools/arch/README.md).');
  process.exit(1);
}

console.log(
  `arch:check: OK — ${run.result.summary.totalCruised} modules cruised, `
    + `${errors.length - fresh.length} violation(s) pass via the baseline dated ${baseline.generated}`,
);
