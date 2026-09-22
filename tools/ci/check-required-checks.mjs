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

if (failures.length > 0) {
  console.error('guard-required-checks: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('guard-required-checks: OK — required-checks runs npm ci + npm test + web build');
