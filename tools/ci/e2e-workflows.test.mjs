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

test('Android E2E runs smoke, walk and discovery for every PR', () => {
  const { source, workflow } = read('android-e2e.yml');
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.equal(workflow.on.pull_request.paths, undefined, 'app changes must trigger Android E2E');
  assert.ok(workflow.on.workflow_dispatch !== undefined);
  assert.ok(workflow.on.schedule?.length > 0);
  assert.ok(!JSON.stringify(workflow.jobs['smoke-and-walk'].env).includes('${{ runner.'), 'runner context is unavailable in jobs.env');
  const steps = workflow.jobs['smoke-and-walk'].steps;
  assert.ok(steps.some((step) => step.run?.includes('ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"') && step.run.includes('>> "$GITHUB_ENV"')));
  assert.ok(steps.some((step) => step.run?.includes('expo prebuild') && step.run.includes('assembleDebug')));
  assert.ok(steps.some((step) => step.run?.includes('test -f "$ANDROID_AVD_HOME/kudy-ci.ini"')));
  assert.ok(steps.some((step) => step.run?.includes('npm run e2e:android -- --suite "$suite"')));
  assert.match(source, /--device pixel_5/);
  assert.match(source, /for suite in smoke walk discovery; do/);
  assert.match(source, /SKIP e2e:android/);
  assert.ok(steps.some((step) => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'failure()'));
  assert.match(source, /tools\/e2e-android\/artifacts\//);
});

test('visual:check runs after the suites and always uploads its report as a non-gating artifact', () => {
  const { source, workflow } = read('android-e2e.yml');
  const steps = workflow.jobs['smoke-and-walk'].steps;
  const suiteIndex = steps.findIndex((step) => step.run?.includes('npm run e2e:android -- --suite "$suite"'));
  const visualIndex = steps.findIndex((step) => step.run?.includes('npm run visual:check'));
  assert.ok(suiteIndex !== -1, 'suites step missing');
  assert.ok(visualIndex > suiteIndex, 'visual:check must run after the e2e suites');
  const visual = steps[visualIndex];
  assert.equal(visual.if, 'always()', 'visual:check must run even when the suites fail');
  assert.match(visual.run, /--out visual-check-report/, 'the report must land in the artifact directory');
  assert.match(visual.run, /tee android-e2e-logs\/visual-check\.log/, 'the verdict log must be captured alongside the other e2e logs');
  assert.match(visual.run, /\|\| visual_status=\$\?/, 'the exit status must be captured, so a failing verdict cannot abort the step before the echo under bash -e');
  // Non-gating while unstable: the last command echoes the recorded status
  // instead of exiting with it, so the step can never fail the job.
  const lastLine = visual.run.trimEnd().split('\n').filter((line) => line.trim()).pop();
  assert.match(lastLine, /^echo /, 'the visual:check step must always end green (non-gating)');
  const uploadIndex = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@') && step.with?.name === 'visual-check-report');
  assert.ok(uploadIndex > visualIndex, 'the report upload must follow the visual:check step');
  const upload = steps[uploadIndex];
  assert.equal(upload.if, 'always()', 'the report artifact must upload on every run outcome');
  assert.match(upload.with.path, /visual-check-report/);
  assert.match(source, /name: visual-check-report/);
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
