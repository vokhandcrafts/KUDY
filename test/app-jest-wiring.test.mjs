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
  assert.match(
    jestConfig,
    /components\/\*\*\/\*\.test\.tsx/,
    'jest config must match components/**/*.test.tsx (issue #339: the guide-card suite lives there — reverting the glob would silently drop it from npm test)'
  );
});

// G06.10.f (issue #406): the reanimated base must stay jest-mocked through
// the official mock plus the controllable useReducedMotion stub — dropping
// the mapping loads the real base and its worklet runtime, which jest
// cannot run (implementation-rules 1: the wiring itself is guarded).
test('guard: the reanimated base is mocked with the reduce-motion seam (G06.10.f)', () => {
  assert.match(
    jestConfig,
    /"\^react-native-reanimated\$"/,
    'jest config must map react-native-reanimated to the official-mock stand-in'
  );
  assert.match(
    jestConfig,
    /"\^react-native-reanimated\/mock\$"/,
    'the mock subpath must map to its own delegator — expo-router\'s testing-library factory returns require("react-native-reanimated/mock") and would hand the app suites the stub-less official mock'
  );
  const standIn = readFileSync(join(root, 'test', 'reanimated-stand-in.js'), 'utf8');
  assert.match(
    standIn,
    /react-native-reanimated/,
    'the stand-in must build on the official mock, not reimplement the base'
  );
  assert.match(
    standIn,
    /useReducedMotion/,
    'the official mock omits useReducedMotion — the motion tests need the controllable stub'
  );
});
