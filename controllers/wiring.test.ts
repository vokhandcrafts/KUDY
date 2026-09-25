// Rule 1/7 guards for the controllers wiring (issue #209): reverting the
// npm-test glob or the root-tsconfig flag that the explicit .ts specifiers
// (node strip-types) rely on must fail a committed check. The arch:check
// zone list is guarded in tools/arch/arch-check.test.mjs — its wiring case
// owns that script string.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('wiring: the controllers suite runs in npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /"?controllers\/\*\*\/\*\.test\.ts"?/);
});

test('wiring: root tsc accepts the explicit .ts specifiers node strip-types requires', () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8'));
  assert.equal(tsconfig.compilerOptions.allowImportingTsExtensions, true);
});

// G05.05.a criterion 6: the run controller reads no clock and no GPS — `now`
// and fixes come through injected ports (ADR G01.03 §3.1, 19 §4.3). The
// behavioral half lives in useRunController.test.ts (the manual clock feeds
// started_at); this guard fails the moment a clock or geolocation API
// appears in the controller source.
test('wiring: useRunController reads no clock or GPS API of its own', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'controllers/useRunController.ts'), 'utf8');
  const forbidden = [/Date\.now/, /performance\.now/, /new Date\(/, /expo-location/, /geolocation/i];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `useRunController.ts must not use ${String(pattern)}`);
  }
});
