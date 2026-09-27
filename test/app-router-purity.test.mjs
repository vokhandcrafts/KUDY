// Guard for the app/ router purity (issue #339 criterion 3): expo-router's
// require.context treats every app/**/*.ts(x) file as a route — a nonscreen
// module there warns on every start and (before #338) leaked into the device
// bundle. app/ may hold only: router special files (`+*`, `_layout`), routes
// (a default export) and colocated `*.test.*` suites (the metro blockList
// keeps those out of the bundle). Dropping a nonscreen module back into
// app/ — or neutering this file's classification — turns the suite red
// (implementation-rules 1). The classifier is shared with the demo driver
// (test/app-router-classifier.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyAppFiles } from './app-router-classifier.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

test('guard: app/ holds only routes, router special files and colocated suites', () => {
  assert.deepEqual(
    classifyAppFiles(appDir).nonscreen,
    [],
    'nonscreen modules must live outside app/ (expo-router treats them as routes) — see components/',
  );
});
