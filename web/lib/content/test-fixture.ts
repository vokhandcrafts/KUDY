// Shared demo fixture for the web tests: builds fixtures/content/demo-route
// with the merged packager into a fresh tmpdir, derives the interim catalog
// (the same derivation the prebuild script runs) and returns the roots. One
// builder, two consumers (readers tests, page tests) — no second variant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../../tools/build-bundle/build-bundle.mjs';
import { deriveInterimCatalog } from './interim-catalog.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export async function buildDemoFixture(): Promise<{ publicRoot: string; buildRoot: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-fixture-'));
  await buildBundle({ inDir: path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route'), outDir: tmp });
  const publicRoot = path.join(tmp, 'public');
  fs.writeFileSync(path.join(publicRoot, 'catalog.json'), JSON.stringify(deriveInterimCatalog(publicRoot), null, 2));
  return { publicRoot, buildRoot: tmp };
}
