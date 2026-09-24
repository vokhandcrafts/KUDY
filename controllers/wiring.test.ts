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
