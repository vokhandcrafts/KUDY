// G23.03 (issue #661) — the committed wiring of the Android E2E suite is
// configuration-as-code (implementation-rules 1/7): removing the npm-test
// glob, the `e2e:android` script or the artifacts gitignore turns this test
// red, so the suite cannot silently leave the default test command or start
// polluting git status again.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { repoRoot } from '../validate/tools-check.mjs';
import { createE2EOriginServer } from '../e2e-origin/serve-e2e-origin.mjs';
import { waitForServerFeedback } from './discovery.mjs';
import { coldStart } from './run-e2e.mjs';

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

test('the discovery command reaches device checks instead of rejecting the suite', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'tools/e2e-android/run-e2e.mjs'), 'utf8');
  assert.match(source, /await runDiscoverySuite\(\{[\s\S]*?driver, url: devClientUrl\(metroPort\), runCase, coldStart,/);
  assert.match(source, /feedbackBaseUrl: `http:\/\/127\.0\.0\.1:\$\{originPort\}\/functions\/v1\/feedback`/);
  const discovery = fs.readFileSync(path.join(repoRoot, 'tools/e2e-android/discovery.mjs'), 'utf8');
  assert.match(discovery, /waitForServerFeedback\(feedbackBaseUrl, \{ revision: 2, score: 5, deleted: false \}\)/,
    'the edit must prove a new server revision and score');
  const result = spawnSync(process.execPath, ['tools/e2e-android/run-e2e.mjs', '--suite', 'discovery', '--serial', 'missing-emulator'], {
    cwd: repoRoot, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP e2e:android discovery/);
});

test('the Android feedback assertion reads the changed server revision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-android-feedback-'));
  const server = createE2EOriginServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/functions/v1/feedback`;
  const target = { kind: 'guide', route_id: 'e2e-free-guide', version: '1', locale: 'be' };
  const put = (revision, score) => fetch(base, {
    method: 'PUT',
    headers: { authorization: 'Bearer kudy-synthetic-feedback-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ mutation_id: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
      target, expected_revision: revision - 1, score, reason_codes: [], disclosure_version: 'feedback-disclosure-1' }),
  });
  try {
    assert.equal((await put(1, 4)).status, 200);
    await assert.rejects(waitForServerFeedback(base, { revision: 2, score: 5, deleted: false }, 1),
      /did not reach revision 2/);
    assert.equal((await put(2, 5)).status, 200);
    await waitForServerFeedback(base, { revision: 2, score: 5, deleted: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cold start retries a transient uiautomator failure before Explore', async () => {
  let dumps = 0;
  const calls = [];
  const driver = {
    forceStop: async () => { calls.push('stop'); },
    launchDeepLink: async () => { calls.push('launch'); },
    dump: async () => {
      dumps += 1;
      if (dumps === 1) throw new Error('adb timed out during uiautomator dump');
      return { localPath: '/tmp/fresh-dump.xml', xml: '<node resource-id="screen-Explore" bounds="[0,0][10,10]"/>' };
    },
  };
  await coldStart(driver, 'kudy://expo-development-client/', { timeoutMs: 2_000, caseSlug: 'retry' });
  assert.deepEqual(calls, ['stop', 'launch']);
  assert.equal(dumps, 2);
});

test('cold start reports a persistent dump failure at its deadline', async () => {
  const driver = {
    forceStop: async () => {},
    launchDeepLink: async () => {},
    dump: async () => { throw new Error('adb still unavailable'); },
  };
  await assert.rejects(
    coldStart(driver, 'kudy://expo-development-client/', { timeoutMs: 20, caseSlug: 'failure' }),
    /timeout after 20 ms waiting for screen-Explore.*adb still unavailable/,
  );
});

test('the Android origin stays on loopback and is reached through adb reverse', () => {
  const runner = fs.readFileSync(path.join(repoRoot, 'tools/e2e-android/run-e2e.mjs'), 'utf8');
  const origin = fs.readFileSync(path.join(repoRoot, 'tools/e2e-origin/serve-e2e-origin.mjs'), 'utf8');
  assert.match(origin, /server\.listen\(args\.port, '127\.0\.0\.1', resolve\)/);
  assert.match(runner, /await driver\.exec\(\['reverse', `tcp:\$\{originPort\}`, `tcp:\$\{originPort\}`\]\)/);
  assert.match(runner, /EXPO_PUBLIC_CATALOG_ORIGIN: `http:\/\/localhost:\$\{originPort\}`/);
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
