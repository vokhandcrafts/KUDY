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

// Issue #241 revert guard — the jscpd gate must stay self-contained. The
// reusable workflow in vokhandcrafts/ai-company-infrastructure cannot be
// called from this repository: both repos are private and user-owned, and
// GitHub rejects cross-repo reusable-workflow calls between private
// user-account repositories at startup with zero jobs, so the gate silently
// never ran. A return to that call pattern (or losing the real npx command)
// must turn this committed check red (implementation-rules 1).
const jscpdWorkflow = fs.readFileSync('.github/workflows/jscpd.yml', 'utf8');
if (/uses:\s*vokhandcrafts\/ai-company-infrastructure\//.test(jscpdWorkflow)) {
  failures.push(
    'jscpd.yml calls the cross-repo reusable workflow again — private user-account repos cannot call it (issue #241: startup failure, zero jobs)'
  );
}
if (!/npx\s+--yes\s+jscpd@/.test(jscpdWorkflow)) {
  failures.push('jscpd.yml does not run npx --yes jscpd@ — the CI gate is absent');
}
if (!/persistent-credentials|persist-credentials:\s*false/.test(jscpdWorkflow)) {
  failures.push('jscpd.yml checkout does not set persist-credentials: false');
}
const workflowVersion = (jscpdWorkflow.match(/jscpd@([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1];
const agentsText = fs.readFileSync('AGENTS.md', 'utf8');
const localVersion = (agentsText.match(/jscpd@([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1];
if (!workflowVersion) {
  failures.push('jscpd.yml has no pinned jscpd version');
} else if (!localVersion) {
  failures.push('AGENTS.md has no pinned local jscpd version to compare against');
} else if (workflowVersion !== localVersion) {
  failures.push(
    `jscpd version drift: CI runs jscpd@${workflowVersion}, the local pre-push gate (AGENTS.md) pins jscpd@${localVersion} — update both in one commit`
  );
}

if (failures.length > 0) {
  console.error('guard-required-checks: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('guard-required-checks: OK — required-checks runs npm ci + npm test + web build');
