import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name) => {
  const source = fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
  return { source, workflow: YAML.parse(source) };
};

test('web E2E runs on PRs with installed Chromium and the real build/test command', () => {
  const { source, workflow } = read('web-e2e.yml');
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  const steps = workflow.jobs.journeys.steps;
  assert.ok(steps.some((step) => step.run === 'npm ci' && step['working-directory'] === 'web'));
  assert.ok(steps.some((step) => step.run === 'npx playwright install --with-deps chromium'));
  assert.ok(steps.some((step) => step.run?.includes('npm run e2e:web')));
  assert.match(source, /KUDY_CHROMIUM=.*playwright.*chromium\.executablePath/);
  assert.ok(!/continue-on-error:\s*true/.test(source));
});

test('Android E2E builds APK and runs both suites on a scheduled or manual emulator', () => {
  const { source, workflow } = read('android-e2e.yml');
  assert.ok(workflow.on.workflow_dispatch !== undefined);
  assert.ok(workflow.on.schedule?.length > 0);
  const steps = workflow.jobs['smoke-and-walk'].steps;
  assert.ok(steps.some((step) => step.run?.includes('expo prebuild') && step.run.includes('assembleDebug')));
  assert.ok(steps.some((step) => step.run?.includes('npm run e2e:android -- --suite "$suite"')));
  assert.match(source, /for suite in smoke walk/);
  assert.match(source, /SKIP e2e:android/);
  assert.ok(steps.some((step) => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'failure()'));
  assert.match(source, /tools\/e2e-android\/artifacts\//);
});

test('every action in the E2E workflows uses a full commit SHA', () => {
  for (const name of ['web-e2e.yml', 'android-e2e.yml']) {
    const { workflow } = read(name);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/, `${name}: ${step.uses}`);
      }
    }
  }
});
