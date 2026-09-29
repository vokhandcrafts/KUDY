// TR-1 revert guard — required-checks.yml must execute the product checks,
// not announce them. Independent by construction (implementation-rules 1,
// review round 3 of TR-1): this script is invoked by its own workflow file
// (.github/workflows/guard-required-checks.yml), outside npm test and outside
// required-checks.yml itself, so restoring the echo stub cannot disable the
// guard together with the tests it would have run.
// Acceptance experiment: a commit restoring the echo stub must turn
// guard-required-checks red on the PR; reverting it turns the guard green.
import fs from 'node:fs';

const file = '.github/workflows/required-checks.yml';
const text = fs.readFileSync(file, 'utf8');

const failures = [];
if (/echo\s+"no product/.test(text)) {
  failures.push('echo stub found in required-checks.yml');
}
if (!/npm test/.test(text)) {
  failures.push('required-checks.yml does not run `npm test`');
}
if (!/npm ci/.test(text)) {
  failures.push('required-checks.yml does not run `npm ci`');
}
if (!/working-directory:\s*web/.test(text)) {
  failures.push('required-checks.yml does not install/build in web/');
}

// G18.01 revert guard — the layer-boundary gate is config-as-code
// (implementation-rules 1 and 18): losing the arch:check script or the
// tools/arch npm-test glob must turn this committed check red, or the gate
// could be disabled silently.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!pkg.scripts?.['arch:check']) {
  failures.push('package.json has no arch:check script');
}
if (!/tools\/arch/.test(pkg.scripts?.test ?? '')) {
  failures.push('npm test glob does not include tools/arch');
}

// G18.03 revert guard — same class as the tools/arch glob: losing the
// tools/arch-surface npm-test glob would drop the surface-reader suite
// silently (implementation-rules 1 and 7).
if (!/tools\/arch-surface/.test(pkg.scripts?.test ?? '')) {
  failures.push('npm test glob does not include tools/arch-surface');
}

// G18.05 revert guard — same class again: losing the ledger:check script or
// the tools/docs-ledger npm-test glob would drop the docs fact ledger
// silently (implementation-rules 1 and 7).
if (!pkg.scripts?.['ledger:check']) {
  failures.push('package.json has no ledger:check script');
}
if (!/tools\/docs-ledger/.test(pkg.scripts?.test ?? '')) {
  failures.push('npm test glob does not include tools/docs-ledger');
}

// G17.01.a revert guard — same class as the tools/arch-surface glob: losing
// the tools/collector npm-test glob would drop the collector suites silently
// (implementation-rules 1 and 7).
if (!/tools\/collector/.test(pkg.scripts?.test ?? '')) {
  failures.push('npm test glob does not include tools/collector');
}

// Issue #241 revert guard — the jscpd gate must stay wired to a full-SHA pin
// of the company reusable workflow and never again to the pre-fix ref
// 752dff0: at that SHA the reusable workflow declared the malformed action
// reference `uses: $/.github/actions/jscpd`, so GitHub rejected the file at
// start time — every PR's jscpd run failed at 0s with no jobs and no
// check-run, and the gate silently never ran. Reverting the pin to that ref
// must turn this committed check red (implementation-rules 1).
const JSCPD_BROKEN_REF = '752dff081b8d910ee9763ae73283748185e8af00';
const jscpdUses = fs
  .readFileSync('.github/workflows/jscpd.yml', 'utf8')
  .match(/uses:\s*vokhandcrafts\/ai-company-infrastructure\/\.github\/workflows\/jscpd\.yml@([0-9a-f]+)/);
if (!jscpdUses) {
  failures.push('jscpd.yml does not call the company reusable jscpd workflow');
} else if (jscpdUses[1].length !== 40) {
  failures.push('jscpd.yml pins the reusable workflow to a short or mutable ref — use a full 40-hex SHA');
} else if (jscpdUses[1] === JSCPD_BROKEN_REF) {
  failures.push('jscpd.yml pins the pre-fix ref 752dff0 (workflow-file startup failure, issue #241)');
}

if (failures.length > 0) {
  console.error('guard-required-checks: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('guard-required-checks: OK — required-checks runs npm ci + npm test + web build');
