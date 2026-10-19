// G23.03 (issue #661) — the committed wiring of the Android E2E suite is
// configuration-as-code (implementation-rules 1/7): removing the npm-test
// glob, the `e2e:android` script or the artifacts gitignore turns this test
// red, so the suite cannot silently leave the default test command or start
// polluting git status again.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from '../validate/tools-check.mjs';

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('the npm-test glob includes the e2e-android suite', () => {
  const globs = packageJson.scripts.test.split(/\s+/);
  assert.ok(
    globs.includes('"tools/e2e-android/*.test.mjs"'),
    'npm test no longer runs tools/e2e-android/*.test.mjs — restore the glob',
  );
});

test('the e2e:android script points at the runner', () => {
  assert.equal(packageJson.scripts['e2e:android'], 'node tools/e2e-android/run-e2e.mjs');
});

test('the walk command reaches device checks instead of rejecting the suite', () => {
  const runner = path.join(repoRoot, 'tools/e2e-android/run-e2e.mjs');
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /await runWalkSuite\(\{ driver, url: devClientUrl\(metroPort\), runCase, coldStart, originLogPath \}\)/,
    'the walk CLI must execute the walk suite after device checks');
  const result = spawnSync(process.execPath, [runner, '--suite', 'walk', '--serial', 'emulator-missing'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP e2e:android walk/);
  assert.doesNotMatch(result.stdout, /PASS /);
});

test('the recovery command is wired and skips visibly without a device', () => {
  const runner = path.join(repoRoot, 'tools/e2e-android/run-e2e.mjs');
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /await runRecoverySuite\(\{/,
    'the recovery CLI must execute the recovery suite after device checks');
  const result = spawnSync(process.execPath, [runner, '--suite', 'recovery', '--serial', 'emulator-missing'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP e2e:android recovery/);
  assert.doesNotMatch(result.stdout, /PASS /);
});

test('the driver artifacts folder is git-ignored', () => {
  const artifacts = path.join(repoRoot, 'tools', 'e2e-android', 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const probe = path.join(artifacts, 'gitignore-probe.tmp');
  fs.writeFileSync(probe, 'probe\n');
  try {
    const check = execFileSync('git', ['check-ignore', '-v', probe], { cwd: repoRoot, encoding: 'utf8' });
    assert.match(check, /tools\/e2e-android\/artifacts/);
  } finally {
    fs.rmSync(probe, { force: true });
  }
});

test('the recorded dump fixtures are committed next to the tests', () => {
  const fixtures = path.join(repoRoot, 'tools', 'e2e-android', 'fixtures');
  const names = fs.readdirSync(fixtures).filter((name) => name.endsWith('.xml'));
  assert.ok(names.length >= 2, `expected recorded dump fixtures, found: [${names.join(', ')}]`);
});
