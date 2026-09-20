// TR-7 parity — the packager side of the shared leak fixtures
// (contracts/fixtures/leak-scanner-cases.ts): every case's reject payload must
// fail the build with exactly the case's class, and the accept twin — the same
// tree with that one defect removed — must build. The web side runs the same
// array against leak-guard.ts (web/lib/content/leak-parity.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAK_FIXTURE_LAYOUT, LEAK_SCANNER_CASES } from '../../contracts/fixtures/leak-scanner-cases.ts';
import { BuildError, buildBundle, canonicalJson } from './build-bundle.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAYOUT = LEAK_FIXTURE_LAYOUT;

async function authorWorkDir() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'kudy-leak-parity-'));
  const work = path.join(base, 'author');
  await fsp.cp(path.join(repoRoot, LAYOUT.authorTree), work, { recursive: true });
  return work;
}

async function readJsonAt(work, rel) {
  return JSON.parse(await fsp.readFile(path.join(work, ...rel.split('/')), 'utf8'));
}

async function writeJsonAt(work, rel, doc) {
  const abs = path.join(work, ...rel.split('/'));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, canonicalJson(doc), 'utf8');
}

// Map a scanner-neutral payload onto the author tree the packager consumes:
// the public file joins the base tier, projection fields merge into the place
// projection, the note joins the public story and the narration replaces the
// private story text.
async function applyPayload(work, payload) {
  if (payload.publicFile) {
    await fsp.writeFile(path.join(work, LAYOUT.locale, 'base', payload.publicFile.name), payload.publicFile.content, 'utf8');
  }
  if (payload.projectionFields) {
    const doc = await readJsonAt(work, LAYOUT.projectionRel);
    await writeJsonAt(work, LAYOUT.projectionRel, { ...doc, ...payload.projectionFields });
  }
  if (payload.publicNote !== undefined) {
    const rel = `${LAYOUT.locale}/base/stops.json`;
    const doc = await readJsonAt(work, rel);
    doc.find((story) => story.story_id === LAYOUT.baseStoryId).note = payload.publicNote;
    await writeJsonAt(work, rel, doc);
  }
  if (payload.privateText !== undefined) {
    const rel = `${LAYOUT.locale}/extended/stops.json`;
    const doc = await readJsonAt(work, rel);
    doc.find((story) => story.story_id === LAYOUT.privateStoryId).text = payload.privateText;
    await writeJsonAt(work, rel, doc);
  }
}

for (const fixture of LEAK_SCANNER_CASES) {
  test(`TR-7 parity [${fixture.id}]: the packager rejects the fixture with ${fixture.code}`, async () => {
    const work = await authorWorkDir();
    await applyPayload(work, fixture.reject);
    const out = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'kudy-leak-parity-out-')), 'build');
    await assert.rejects(
      buildBundle({ inDir: work, outDir: out }),
      (error) => error instanceof BuildError && error.code === fixture.code,
    );
  });

  test(`TR-7 parity [${fixture.id}]: the packager accepts the clean twin`, async () => {
    const work = await authorWorkDir();
    await applyPayload(work, fixture.accept);
    const out = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'kudy-leak-parity-out-')), 'build');
    await buildBundle({ inDir: work, outDir: out });
  });
}
