import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTests, discoverRepoTests, EXCLUSIONS, TEST_FILE_PATTERN } from './test-discovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const jestConfig = fs.readFileSync(path.join(root, 'jest.config.js'), 'utf8');

// G20.28 criterion 1 (spec §V7, implementation-rules 7): every committed test
// file is owned by the node runner or jest in the default command. A new
// accepted test path outside the declared globs turns this check red naming
// the file — the answer to the manual-enumeration bypass.
test('guard: every committed test file is owned by a runner in npm test (G20.28)', () => {
  const { unowned, diagnostics } = discoverRepoTests();
  assert.deepEqual(diagnostics, [], 'discovery must run clean on the real repository');
  assert.deepEqual(unowned, [], `unowned committed test files: ${unowned.join(', ')}`);
});

// The exclusions seam must not rot: a documented exclusion for a file that no
// longer exists is a stale claim about ownership (implementation-rules 13
// class), and a malformed entry hides its own justification.
test('guard: exclusions point at committed test files and carry a reason', () => {
  const { trackedTestFiles, diagnostics } = discoverTests({
    trackedFiles: [...new Set([...EXCLUSIONS.map((e) => e.path), 'tools/ci/test-discovery.test.mjs'])],
  });
  assert.deepEqual(diagnostics, [], 'committed exclusions must be live and well-formed');
  for (const entry of EXCLUSIONS) {
    assert.ok(TEST_FILE_PATTERN.test(entry.path), `${entry.path} must be a test file`);
    assert.ok(trackedTestFiles.includes(path.normalize(entry.path)), `${entry.path} must be committed`);
  }
});

test('guard: removing an npm test glob is detected and names the dropped suites', () => {
  const stripped = pkg.scripts.test.replace(/"tools\/ci\/\*\.test\.mjs"\s*/u, '');
  assert.notEqual(stripped, pkg.scripts.test, 'the delta fixture must actually remove the glob');
  const { unowned } = discoverTests({ testScript: stripped });
  assert.ok(
    unowned.includes(path.normalize('tools/ci/deno-typecheck.test.mjs')),
    `the discovery guard must see the dropped zone; unowned: ${unowned.join(', ')}`
  );
});

test('guard: removing the jest wiring is detected (app and components suites)', () => {
  const stripped = jestConfig.replace(/testMatch:\s*\[[^\]]*\]/u, 'testMatch: []');
  assert.notEqual(stripped, jestConfig, 'the delta fixture must actually remove testMatch');
  const { unowned } = discoverTests({ jestConfigSource: stripped });
  assert.ok(
    unowned.some((file) => file.startsWith('app/')) && unowned.some((file) => file.startsWith('components/')),
    `jest-owned suites must appear unowned; unowned: ${unowned.join(', ')}`
  );
});

test('diagnostics: corrupt runner configuration answers with diagnostics, not a crash (implementation-rules 14)', () => {
  const missingScript = discoverTests({ testScript: null, jestConfigSource: jestConfig });
  assert.ok(missingScript.diagnostics.some((line) => line.includes('no test script')), missingScript.diagnostics.join('; '));
  const emptyJest = discoverTests({ testScript: pkg.scripts.test, jestConfigSource: '' });
  assert.ok(emptyJest.diagnostics.some((line) => line.includes('jest.config.js')), emptyJest.diagnostics.join('; '));
  const noPatterns = discoverTests({ jestConfigSource: 'module.exports = {};' });
  assert.ok(noPatterns.diagnostics.some((line) => line.includes('testMatch')), noPatterns.diagnostics.join('; '));
  const deadGlob = discoverTests({ jestConfigSource: jestConfig, testScript: 'node --test "tools/nowhere/*.test.mjs" && jest --config jest.config.js' });
  assert.ok(deadGlob.diagnostics.some((line) => line.includes('matches no files')), deadGlob.diagnostics.join('; '));
  for (const result of [missingScript, emptyJest, noPatterns, deadGlob]) {
    assert.ok(Array.isArray(result.unowned), 'the result stays structured for the caller');
  }
});

test('diagnostics: a suite claimed by both runners, and tsx under node, are named', () => {
  const both = discoverTests({
    testScript: `${pkg.scripts.test.split('&&')[0].trim()} "app/layout-header.test.tsx" && jest --config jest.config.js`,
  });
  assert.ok(
    both.diagnostics.some((line) => line.includes('both runners claim it')),
    both.diagnostics.join('; ')
  );
  assert.ok(
    both.diagnostics.some((line) => line.includes('.tsx suites are jest-owned')),
    both.diagnostics.join('; ')
  );
});
