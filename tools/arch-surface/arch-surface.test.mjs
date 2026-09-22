// Guard for tools/arch-surface (G18.03): the fixture surface snapshot, output
// determinism and corrupt-input diagnostics, all through the production entry
// (the CLI spawned as a child process — rule 15, no re-implemented logic).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(repoRoot, 'tools', 'arch-surface', 'arch-surface.mjs');
const sampleFixture = 'tools/arch-surface/fixtures/sample';

function runSurface(...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

// Hand-verified against the fixture sources (comparison recorded in
// docs/agent-tasks/results/G18.03.md): internal `./` specifiers excluded,
// `../` escapes and bare packages printed, every export form named.
const expectedSampleSurface = `# arch-surface: tools/arch-surface/fixtures/sample

## alpha.ts
exports: ALPHA_VERSION, AlphaKind, AlphaMode, AlphaShape, renderAlpha
imports: node:fs

## beta.mjs
exports: default, nsBundle, plainName, renamedName
imports: ../escaping-import.mjs, fake-bare-pkg, fake-ns-pkg, fake-side-effect-pkg

## empty.ts
exports: (none)
imports: (none)

## nested/gamma.mjs
exports: GammaWidget, gammaState, gx, gy
imports: node:path
`;

test('prints the hand-verified fixture surface', () => {
  const run = runSurface(sampleFixture);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, expectedSampleSurface);
});

test('output is deterministic across runs (byte-identical, no timestamps)', () => {
  const first = runSurface(sampleFixture);
  const second = runSurface(sampleFixture);
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  assert.equal(first.stdout, second.stdout);
});

test('trailing separators in <dir> do not change the output', () => {
  const run = runSurface(`${sampleFixture}/`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, expectedSampleSurface);
});

test('a directory with no source files says so', () => {
  const run = runSurface('tools/arch-surface/fixtures/no-sources');
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    '# arch-surface: tools/arch-surface/fixtures/no-sources\nno source files found\n',
  );
});

test('missing argument prints usage and exits 2', () => {
  const run = runSurface();
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^usage: node tools\/arch-surface\/arch-surface\.mjs <dir>/);
});

test('nonexistent directory is a diagnostic, not a crash', () => {
  const run = runSurface('tools/arch-surface/fixtures/nope');
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /does not exist/);
});

test('a file instead of a directory is a diagnostic, not a crash', () => {
  const run = runSurface('tools/arch-surface/fixtures/sample/alpha.ts');
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /is not a directory/);
});

test('the fixtures stay valid TypeScript for the repo typecheck scope', () => {
  // alpha.ts sits inside the root tsc program (allowJs): its imports must
  // resolve for `npm run typecheck` to stay green.
  const alpha = fs.readFileSync(path.join(repoRoot, 'tools/arch-surface/fixtures/sample/alpha.ts'), 'utf8');
  for (const line of alpha.split('\n')) {
    const specifier = line.match(/from\s*['"]([^'"]+)['"]/);
    if (specifier) {
      assert.match(specifier[1], /^node:/, `fixture import must resolve: ${specifier[1]}`);
    }
  }
});
