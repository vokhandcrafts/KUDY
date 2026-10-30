// G20.35 / #815: the acceptance suite must detect both precise regressions,
// not merely pass against the shipping implementation. Each mutation runs in
// a disposable detached worktree; the checked-out source is never modified.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const integrationPath = 'controllers/deviceServices.integration.test.ts';
const configPath = 'controllers/deviceServices.ts';
const orchestratorPath = 'controllers/run/runOrchestrator.ts';

function command(exe, args, cwd, timeout = 60_000) {
  const result = spawnSync(exe, args, {
    cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (result.error) throw result.error;
  return result;
}

function replaceExactlyOnce(source, before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `unique mutation anchor: ${label}`);
  return source.replace(before, after);
}

function expectRegressionFailure(worktree, mutation, diagnostic) {
  const result = command(process.execPath, [
    '--test', '--experimental-strip-types', '--experimental-test-module-mocks',
    '--test-reporter=tap', '--test-name-pattern=G20.35:',
    integrationPath,
  ], worktree);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, `${mutation}: mutant unexpectedly passed\n${output}`);
  assert.match(output, /not ok \d+ - G20\.35: canonical dwell/,
    `${mutation}: must fail the production-composition acceptance test\n${output}`);
  assert.ok(output.includes(diagnostic),
    `${mutation}: expected assertion must identify the regression\n${output}`);
  console.log(`G20.35 mutation caught: ${mutation} — ${diagnostic}`);
}

test('G20.35 mutation proof: zero production dwell and broken pause must fail acceptance', { timeout: 180_000 }, () => {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-g2035-'));
  const worktree = path.join(tempParent, 'checkout');
  let attached = false;
  try {
    const added = command('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], root);
    assert.equal(added.status, 0, `create isolated checkout: ${added.stderr}`);
    attached = true;

    // The checked-out test uses installed runtime dependencies, not mocks of
    // the production composition. Windows junctions need no symlink privilege.
    const deps = path.join(root, 'node_modules');
    assert.ok(fs.existsSync(deps), 'npm ci must run before mutation proof');
    fs.symlinkSync(deps, path.join(worktree, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');

    const configFile = path.join(worktree, configPath);
    const originalConfig = fs.readFileSync(configFile, 'utf8');
    const withZero = replaceExactlyOnce(
      originalConfig, 'pipelineConfig: defaultPipelineConfig,',
      'pipelineConfig: { dwellMs: 0 },', 'canonical production dwell',
    );
    fs.writeFileSync(configFile, withZero);
    expectRegressionFailure(worktree, 'dwellMs: 0', 'no trigger on first fix or before dwell threshold');
    fs.writeFileSync(configFile, originalConfig);

    const orchestratorFile = path.join(worktree, orchestratorPath);
    const originalOrchestrator = fs.readFileSync(orchestratorFile, 'utf8');
    const start = originalOrchestrator.indexOf('  pauseSession(): boolean {');
    const end = originalOrchestrator.indexOf('  end(): boolean {', start);
    assert.ok(start > 0 && end > start, 'pause/resume source range exists');
    const section = originalOrchestrator.slice(start, end);
    const reset = '    this.pipelineState = initialPipelineState;\n';
    assert.equal(section.split(reset).length - 1, 2, 'both pause and resume reset dwell');
    const brokenPause = originalOrchestrator.slice(0, start)
      + section.replaceAll(reset, '')
      + originalOrchestrator.slice(end);
    fs.writeFileSync(orchestratorFile, brokenPause);
    expectRegressionFailure(worktree, 'removed Pause/Resume dwell resets', 'pause time and pre-pause dwell cannot count');
    fs.writeFileSync(orchestratorFile, originalOrchestrator);
  } finally {
    if (attached) {
      const removed = command('git', ['worktree', 'remove', '--force', worktree], root);
      assert.equal(removed.status, 0, `remove isolated checkout: ${removed.stderr}`);
    }
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});
