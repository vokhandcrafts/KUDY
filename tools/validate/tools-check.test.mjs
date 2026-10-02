import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProductionToolFiles, eslintBin, repoRoot } from './tools-check.mjs';

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
