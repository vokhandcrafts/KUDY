import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProductionToolFiles, eslintBin, productionPassOutcome, repoRoot } from './tools-check.mjs';

// G20.16 (issue #487): the enforced tools async/error check stays wired into
// the default command and keeps catching the named defects. Implementation
// rules 1 and 7: removing the rules, the runner or the npm script must turn
// this suite red, not just weaken a config file nobody runs.

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'tools-check.mjs');
const fixture = (name) => path.join(here, 'fixtures', name);

test('guard: npm script tools:check invokes the runner', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['tools:check'], 'node tools/validate/tools-check.mjs');
});

test('guard: the enforced selection is non-empty', () => {
  const files = collectProductionToolFiles();
  assert.ok(files.length > 0, 'selection must cover the production tools');
  assert.ok(
    files.every((f) => f.startsWith('tools/') && f.endsWith('.mjs') && !f.includes('/fixtures/')),
    'selection must stay inside production tools/*.mjs'
  );
});

test('guard: production tools pass the async/error check', () => {
  const run = spawnSync(process.execPath, [runner], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(
    run.status,
    0,
    `tools:check must pass over production tools\n${run.stdout ?? ''}${run.stderr ?? ''}`
  );
});

test('guard: missing-await fixture is rejected naming the rule', () => {
  const res = spawnSync(
    process.execPath,
    [eslintBin, '--no-ignore', fixture('floating-promise.mjs')],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.notEqual(res.status, 0, 'a forgotten await must fail the check');
  assert.match(`${res.stdout}${res.stderr}`, /no-floating-promises/);
});

test('guard: empty-catch fixture is rejected naming the rule', () => {
  const res = spawnSync(
    process.execPath,
    [eslintBin, '--no-ignore', fixture('empty-catch.mjs')],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.notEqual(res.status, 0, 'an empty catch must fail the check');
  assert.match(`${res.stdout}${res.stderr}`, /no-empty/);
});

test('guard: handled-error fixture passes the same rules', () => {
  const res = spawnSync(
    process.execPath,
    [eslintBin, '--no-ignore', fixture('valid-async-handling.mjs')],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.equal(
    res.status,
    0,
    `the valid fixture must pass the same rules\n${res.stdout ?? ''}${res.stderr ?? ''}`
  );
});

test('guard: the committed config ignores nothing from the enforced selection', () => {
  const files = collectProductionToolFiles();
  const res = spawnSync(process.execPath, [eslintBin, '--format', 'json', ...files], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `config must lint the whole selection\n${res.stderr ?? ''}`);
  const results = JSON.parse(res.stdout);
  const ignored = results
    .filter((r) => r.messages.some((m) => /File ignored/.test(m.message)))
    .map((r) => r.filePath);
  assert.deepEqual(ignored, [], 'enforced files must not be silenced by config ignores');
});

test('guard: a directory without production files selects nothing', () => {
  const empty = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.tools-check-probe-'));
  try {
    assert.deepEqual(collectProductionToolFiles(empty), []);
  } finally {
    fs.rmdirSync(empty);
  }
});

test('guard: empty selection refuses to pass with exit 2', () => {
  const outcome = productionPassOutcome([]);
  assert.equal(outcome.status, 2);
  assert.match(outcome.output, /empty production selection/);
});

test('guard: production pass propagates a lint failure', () => {
  const outcome = productionPassOutcome(['tools/validate/no-such-file.mjs']);
  assert.notEqual(outcome.status, 0, 'a missing enforced file must not look like success');
});

test('guard: --file without a path refuses to run with exit 2', () => {
  const run = spawnSync(process.execPath, [runner, '--file'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(`${run.stdout ?? ''}${run.stderr ?? ''}`, /--file requires a path/);
});
