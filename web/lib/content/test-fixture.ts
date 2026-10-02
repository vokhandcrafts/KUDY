// Shared demo fixture for the web tests: builds fixtures/content/demo-route
// with the merged packager into a fresh tmpdir, derives the interim catalog
// (the same derivation the prebuild script runs) and returns the roots. One
// builder, two consumers (readers tests, page tests) — no second variant.
// G20.18 (issue #489): the packager runs through its supported process entry
// (node tools/build-bundle/build-bundle.mjs --in/--out) — the web tests keep
// the REAL packager output (the TR-3/TR-5 parity requirement: the same
// documents feed both sides) without importing the authoring tool across the
// layer boundary. One process runner, three consumers (test-fixture,
// leak-guard, leak-parity) — no second variant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deriveInterimCatalog } from '../../../contracts/interim-catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// Runs the packager CLI as a child process and fails the test with the
// tool's own diagnostics when it does not succeed (exit codes 0/1/2; the
// stderr carries its JSON diagnostics — forwarded verbatim).
export function runBuildBundle({ inDir, outDir }: { inDir: string; outDir: string }): void {
  const build = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'tools', 'build-bundle', 'build-bundle.mjs'), '--in', inDir, '--out', outDir],
    { encoding: 'utf8' },
  );
  if (build.error) {
    throw new Error(`build-bundle could not be spawned: ${build.error.message}`);
  }
  if (build.status !== 0) {
    throw new Error(`build-bundle failed (exit ${build.status ?? 'signal'}):\n${build.stderr ?? ''}`);
  }
}

export async function buildDemoFixture(): Promise<{ publicRoot: string; buildRoot: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-fixture-'));
  runBuildBundle({ inDir: path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route'), outDir: tmp });
  const publicRoot = path.join(tmp, 'public');
  fs.writeFileSync(path.join(publicRoot, 'catalog.json'), JSON.stringify(deriveInterimCatalog(publicRoot), null, 2));
  return { publicRoot, buildRoot: tmp };
}
