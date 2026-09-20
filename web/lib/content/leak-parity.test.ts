// TR-7 parity — the web side of the shared leak fixtures
// (contracts/fixtures/leak-scanner-cases.ts): the guard must reject every
// case's reject payload, mapped onto the tree the web build consumes, with
// exactly the case's class, and accept the clean twin — the same tree with
// that one defect removed. The packager side runs the same array against
// buildBundle (tools/build-bundle/leak-parity.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../../tools/build-bundle/build-bundle.mjs';
import { LEAK_FIXTURE_LAYOUT, LEAK_SCANNER_CASES } from '../../../contracts/fixtures/leak-scanner-cases.ts';
import type { LeakFixturePayload } from '../../../contracts/fixtures/leak-scanner-cases.ts';
import { scanWebContentInput, type ScanResult } from './leak-guard.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const LAYOUT = LEAK_FIXTURE_LAYOUT;

// A fresh clean build per case: the guard verifies the tree the web build
// actually consumes, so each payload poisons its own build output.
async function cleanBuild(): Promise<{ publicDir: string; privateDir: string }> {
  const buildRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-leak-parity-web-')), 'build');
  await buildBundle({ inDir: path.join(REPO_ROOT, LAYOUT.authorTree), outDir: buildRoot });
  return { publicDir: path.join(buildRoot, 'public'), privateDir: path.join(buildRoot, 'private') };
}

function mergedJson(file: string, fields: Record<string, string>): void {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(file, JSON.stringify({ ...doc, ...fields }));
}

function withStoryField(file: string, storyId: string, field: string, value: string): void {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { story_id: string }[];
  (doc.find((story) => story.story_id === storyId) as Record<string, unknown>)[field] = value;
  fs.writeFileSync(file, JSON.stringify(doc));
}

// Map the same scanner-neutral payload onto the consumed tree: the public file
// joins the public base tier, projection fields merge into the public place
// projection, the note joins the public story and the narration replaces the
// private story text the guard collects grams from.
function applyPayload(dirs: { publicDir: string; privateDir: string }, payload: LeakFixturePayload): void {
  if (payload.publicFile) {
    fs.writeFileSync(
      path.join(dirs.publicDir, LAYOUT.bundleRoot, LAYOUT.locale, 'base', payload.publicFile.name),
      payload.publicFile.content,
    );
  }
  if (payload.projectionFields) {
    mergedJson(path.join(dirs.publicDir, ...LAYOUT.projectionRel.split('/')), payload.projectionFields);
  }
  if (payload.publicNote !== undefined) {
    withStoryField(
      path.join(dirs.publicDir, LAYOUT.bundleRoot, LAYOUT.locale, 'base', 'stops.json'),
      LAYOUT.baseStoryId,
      'note',
      payload.publicNote,
    );
  }
  if (payload.privateText !== undefined) {
    withStoryField(
      path.join(dirs.privateDir, LAYOUT.bundleRoot, LAYOUT.locale, 'extended', 'stops.json'),
      LAYOUT.privateStoryId,
      'text',
      payload.privateText,
    );
  }
}

for (const fixture of LEAK_SCANNER_CASES) {
  test(`TR-7 parity [${fixture.id}]: leak-guard rejects the fixture with ${fixture.code}`, async () => {
    const dirs = await cleanBuild();
    applyPayload(dirs, fixture.reject);
    const res: ScanResult = scanWebContentInput(dirs);
    assert.equal(res.ok, false, JSON.stringify(res.violations));
    assert.ok(
      res.violations.some((violation) => violation.code === fixture.code),
      JSON.stringify(res.violations),
    );
  });

  test(`TR-7 parity [${fixture.id}]: leak-guard accepts the clean twin`, async () => {
    const dirs = await cleanBuild();
    applyPayload(dirs, fixture.accept);
    const res: ScanResult = scanWebContentInput(dirs);
    assert.deepEqual(res, { ok: true, violations: [] });
  });
}
