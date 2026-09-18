// Runner-wiring and environment guards (implementation-rules 1/5/7): every
// guard here fails when the change it protects is reverted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

test('npm test wires the web suite (reverting the glob removes the suite from the count)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const script: string = pkg.scripts.test;
  assert.match(script, /--experimental-strip-types/, 'web .ts tests need type stripping on the supported node range');
  assert.match(script, /"web\/\*\*\/\*\.test\.ts"/, 'the web suite glob must be enumerated in the default test command');
});

test('root tsconfig excludes web/ (reverting it sweeps Next sources under the Expo config)', () => {
  const tsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8'));
  assert.ok(
    Array.isArray(tsconfig.exclude) && tsconfig.exclude.includes('web'),
    'the Expo root typecheck must not compile web/** with jsx: react-native',
  );
});

test('generated web output and content trees are gitignored in the same change', () => {
  const probes = ['web/node_modules/x', 'web/.next/x', 'web/out/x', 'web/content/x', 'web/tsconfig.tsbuildinfo'];
  const out = execFileSync('git', ['check-ignore', '-v', ...probes], { cwd: REPO_ROOT, encoding: 'utf8' });
  for (const probe of probes) {
    assert.ok(out.includes(probe), `${probe} must be gitignored`);
  }
});
