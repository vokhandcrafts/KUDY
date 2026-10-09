// G21.36 (#592), review finding [key: windows-regressions-skipped-in-ci]:
// the required windows-portable job must run the android-build suite.
// Removing that step, or leaving it only as a comment, turns
// tools/ci/check-required-checks.mjs red. The guard reads the workflow
// from the process cwd, so the negative case is a copy of the files it
// opens, with the step line deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowRel = '.github/workflows/required-checks.yml';
const stepLine = 'run: node --test "tools/android-build/*.test.mjs"';

function copyGuardInputs(dir) {
  fs.cpSync(path.join(repo, '.github/workflows'), path.join(dir, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools/ci'), { recursive: true });
  for (const rel of ['package.json', 'AGENTS.md', 'tools/ci/fetch-gitleaks.mjs', 'tools/ci/check-required-checks.mjs']) {
    fs.copyFileSync(path.join(repo, rel), path.join(dir, rel));
  }
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-android-ci-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  copyGuardInputs(dir);
  return dir;
}

function runGuard(cwd) {
  return spawnSync(process.execPath, ['tools/ci/check-required-checks.mjs'], { cwd, encoding: 'utf8' });
}

function windowsJob(text) {
  const start = text.indexOf('\n  windows-portable:');
  const end = text.indexOf('\n  lint:');
  return start >= 0 && end > start ? text.slice(start, end) : '';
}

test('the android-build suite step sits in the windows-portable job', () => {
  const text = fs.readFileSync(path.join(repo, workflowRel), 'utf8');
  assert.match(windowsJob(text), /runs-on:\s*windows-latest/);
  assert.match(windowsJob(text), /run:\s*node --test "tools\/android-build\/\*\.test\.mjs"/);
  assert.equal(windowsJob(text).includes(stepLine), true);
});

test('a copy of the guard inputs stays green while the Windows android-build step is present', (t) => {
  const result = runGuard(fixture(t));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('removing the windows android-build step turns the required-checks guard red', (t) => {
  const dir = fixture(t);
  const file = path.join(dir, workflowRel);
  const original = fs.readFileSync(file, 'utf8');
  const removed = original.replace(`\n        ${stepLine}\n`, '\n');
  assert.notEqual(removed, original);
  fs.writeFileSync(file, removed);
  const result = runGuard(dir);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /windows-portable job does not run `node --test "tools\/android-build\/\*\.test\.mjs"`/
  );
});

test('a commented-out windows android-build step does not satisfy the guard', (t) => {
  const dir = fixture(t);
  const file = path.join(dir, workflowRel);
  const original = fs.readFileSync(file, 'utf8');
  const commented = original.replace(stepLine, `# ${stepLine}`);
  assert.notEqual(commented, original);
  fs.writeFileSync(file, commented);
  const result = runGuard(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Windows-only android-build regressions are skipped in CI/);
});
