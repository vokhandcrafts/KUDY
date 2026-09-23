import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const jestConfig = readFileSync(join(root, 'jest.config.js'), 'utf8');

test('guard: the app/ component suite is wired into npm test (implementation-rules 7)', () => {
  assert.match(
    pkg.scripts.test,
    /&& jest --config jest\.config\.js$/,
    'npm test must run jest (jest-expo, app/**/*.test.tsx) after the node --test suites'
  );
  assert.match(jestConfig, /preset:\s*["']jest-expo["']/, 'jest config must use the jest-expo preset');
  assert.match(
    jestConfig,
    /app\/\*\*\/\*\.test\.tsx/,
    'jest config must match app/**/*.test.tsx'
  );
});
