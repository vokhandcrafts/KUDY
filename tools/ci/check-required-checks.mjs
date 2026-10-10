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
// Comment lines are stripped before the command checks: a left-over
// `# run: npm test` must not keep a guard green after the step itself is
// deleted (the delta review of G20.15 flagged the exposure).
const text = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const failures = [];
if (/echo\s+"no product/.test(text)) {
  failures.push('echo stub found in required-checks.yml');
}
if (!/npm test/.test(text)) {
  failures.push('required-checks.yml does not run `npm test`');
}
// PR #689 (run 37713584531): tests (22) sat silent for six hours after the
// map browser file started. The job limit and the per-test limit are the
// revert guard (implementation-rules 1) — deleting either turns this check red.
const testsJob = text.slice(text.indexOf('\n  tests:'), text.indexOf('\n  windows-portable:'));
if (!/timeout-minutes:\s*10\b/.test(testsJob)) {
  failures.push('required-checks.yml tests job has no timeout-minutes: 10 — a stuck suite must not run to the 360-minute default');
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
if (!/--test-timeout=60000\b/.test(pkg.scripts?.test ?? '')) {
  failures.push('npm test does not set --test-timeout=60000 — a stuck file must fail by name instead of holding the job');
}
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

// G20.13 revert guard — the Deno entrypoint type-check is config-as-code
// (implementation-rules 1 and 7): losing the server:typecheck script, its
// required-checks job or the pinned setup-deno action would drop the check
// silently. The job is authorized by the operator decision recorded in
// issue #493 (closed 2026-10-02).
if (!pkg.scripts?.['server:typecheck']) {
  failures.push('package.json has no server:typecheck script');
}
if (!/server:typecheck/.test(text)) {
  failures.push('required-checks.yml does not run server:typecheck');
}
if (!/uses:\s*denoland\/setup-deno@[0-9a-f]{40}/.test(text)) {
  failures.push('required-checks.yml does not pin denoland/setup-deno to a full 40-hex commit SHA');
}
if (!/supabase\/functions\/\.deno-version/.test(text)) {
  failures.push('required-checks.yml does not read the committed Deno version pin');
}

// G20.15 revert guard — the required workflow must cruise the REAL repository
// graph (implementation-rules 1 and 18; authorized by issue #493, closed):
// losing the arch:check step from required-checks.yml would silently drop the
// layer-boundary gate from CI, leaving only the fixture suites. The command is
// end-anchored so a renamed or suffixed script (arch:check-anything) does not
// count as the gate. The script itself and its npm-test wiring are pinned by
// the G18.01 checks above.
if (!/run:\s*npm run arch:check\s*$/m.test(text)) {
  failures.push('required-checks.yml does not run `npm run arch:check` — the real repository graph is not gated');
}

// G20.17 revert guard — the portable path-boundary guards must run on Windows
// (A26-08, issue #488): losing the windows-latest job would drop the main
// development host from CI again. The portable subset is exactly the two
// dependency-free suites; the symlink-privilege security cases stay mandatory
// on the Linux tests job and are guarded by npm test there.
if (!/runs-on:\s*windows-latest/.test(text)) {
  failures.push('required-checks.yml has no windows-latest job — the portable subset is not covered on Windows');
}
if (!/run:\s*node --test --experimental-strip-types test\/design-tokens\.test\.mjs/.test(text)) {
  failures.push('required-checks.yml does not run the portable design-tokens suite on Windows');
}
if (!/run:\s*node --test --experimental-strip-types.*fixtures-hygiene\.test\.ts/.test(text)) {
  failures.push('required-checks.yml does not run the fixture-hygiene guard on Windows');
}

// G21.36 (#592) revert guard — the Ubuntu `tests` job skips the Windows-only
// android-build cases (`needs Windows PowerShell and Get-NetTCPConnection`).
// The required windows-portable job must run that suite, or a revert of the
// emulator-script protections stays green (windows-regressions-skipped-in-ci).
// The match is limited to that job, so the same command on Linux does not
// count. Comment lines are already stripped above.
const windowsStart = text.indexOf('\n  windows-portable:');
const windowsEnd = text.indexOf('\n  lint:');
const windowsJob = windowsStart >= 0 && windowsEnd > windowsStart ? text.slice(windowsStart, windowsEnd) : '';
if (!/run:\s*node --test "tools\/android-build\/\*\.test\.mjs"/.test(windowsJob)) {
  failures.push(
    'required-checks.yml windows-portable job does not run `node --test "tools/android-build/*.test.mjs"` — Windows-only android-build regressions are skipped in CI'
  );
}

// G20.27 revert guard — supply-chain pins (spec V6, issue #500): every action
// reference in every workflow must be a full 40-hex upstream commit SHA, the
// tag staying only as a version annotation. The file list is enumerated from
// the directory, not hardcoded: a future fourth workflow with a tag ref must
// turn this guard red by itself. The secret scanner must run through the
// committed digest-verifying pipeline, and that pipeline must carry its own
// version + checksum constants — the digest is never taken from the download
// or the environment. Reverting any pin, fetching the scanner with curl/wget
// again, or emptying the digest constant must turn this committed check red.
const workflowFiles = fs
  .readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => `.github/workflows/${name}`);
for (const workflowFile of workflowFiles) {
  const wfText = fs
    .readFileSync(workflowFile, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const refs = wfText.match(/uses:\s*\S+/g) ?? [];
  const unpinned = refs.filter((ref) => !/^uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(ref));
  if (unpinned.length > 0) {
    failures.push(
      `${workflowFile}: action references not pinned to a full 40-hex upstream commit SHA: ${unpinned.join(', ')}`
    );
  }
}
if (!/run:\s*node tools\/ci\/fetch-gitleaks\.mjs\s*$/m.test(text)) {
  failures.push(
    'required-checks.yml does not run the committed gitleaks fetch-and-verify pipeline (tools/ci/fetch-gitleaks.mjs)'
  );
}
if (/(?:curl|wget)[^\n]*gitleaks/.test(text)) {
  failures.push('required-checks.yml downloads the scanner directly — the digest-pinned pipeline is bypassed');
}
const gitleaksFetcher = fs.readFileSync('tools/ci/fetch-gitleaks.mjs', 'utf8');
if (!/GITLEAKS_VERSION\s*=\s*['"][0-9]+\.[0-9]+\.[0-9]+['"]/.test(gitleaksFetcher)) {
  failures.push('tools/ci/fetch-gitleaks.mjs has no pinned scanner version constant');
}
if (!/GITLEAKS_SHA256\s*=\s*['"][0-9a-f]{64}['"]/.test(gitleaksFetcher)) {
  failures.push('tools/ci/fetch-gitleaks.mjs has no pinned 64-hex archive sha256 digest');
}

// G20.28 revert guard (#501, spec §V7) — the default command discovers tests
// through zone globs expanded by tools/ci/test-discovery.test.mjs, and that
// discovery guard must stay wired itself. The globs are pinned in this
// independent check (run by its own workflow, outside npm test) so deleting
// the tools/ci zone — or the guard's own file — turns this check red instead
// of disabling the check together with what it verified
// (implementation-rules 1; the #105 self-check residual closed for this zone).
for (const glob of ['"test/*.test.mjs"', '"contracts/**/*.test.mjs"', '"spikes/**/*.test.mjs"', '"tools/ci/*.test.mjs"']) {
  if (!pkg.scripts?.test?.includes(glob)) {
    failures.push(`npm test glob is gone: ${glob}`);
  }
}

// G20.28 revert guard — engine:regressions must run in the required workflow
// (spec §V7; authorized by issue #493 zone 7): losing the script or the
// workflow step would drop the mutation gate from CI silently. The failure
// text carries the planned missing_engine_workflow_step guard name.
if (!pkg.scripts?.['engine:regressions']) {
  failures.push('package.json has no engine:regressions script');
}
if (!/run:\s*npm run engine:regressions\s*$/m.test(text)) {
  failures.push('missing_engine_workflow_step: required-checks.yml does not run `npm run engine:regressions`');
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
if (!/persist-credentials:\s*false/.test(jscpdWorkflow)) {
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
console.log('guard-required-checks: OK — required-checks runs npm ci + npm test + web build + server:typecheck + arch:check + windows portable subset');
