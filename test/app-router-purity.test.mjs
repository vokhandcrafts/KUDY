// Guard for the app/ router purity (issue #339 criterion 3): expo-router's
// require.context treats every app/**/*.ts(x) file as a route — a nonscreen
// module there warns on every start and (before #338) leaked into the device
// bundle. app/ may hold only: router special files (`+*`, `_layout`), routes
// (a default export) and colocated `*.test.*` suites (the metro blockList
// keeps those out of the bundle). Dropping a nonscreen module back into
// app/ — or neutering this file's classification — turns the suite red
// (implementation-rules 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

function listAppFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listAppFiles(full) : [full];
  });
}

test('guard: app/ holds only routes, router special files and colocated suites', () => {
  const offenders = [];
  for (const file of listAppFiles(appDir)) {
    const rel = file.slice(appDir.length + 1);
    const base = rel.split('/').pop();
    if (base.startsWith('+') || base.startsWith('_')) continue; // router special files
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) continue; // colocated jest suites
    if (/export\s+default/.test(readFileSync(file, 'utf8'))) continue; // route screens
    offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    'nonscreen modules must live outside app/ (expo-router treats them as routes) — see components/',
  );
});
