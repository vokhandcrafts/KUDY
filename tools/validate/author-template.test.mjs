// G02.05 — acceptance suite for the author template (issue #57). Criteria:
// 1. a small valid guide and a broken example (content/author-template[-invalid]);
// 2. texts and media are replaceable without any code;
// 3. an unknown schema_version is rejected safely (21 §3.3);
// 4. no custom importer in MVP — content/ ships data and docs only;
// 5. single place + Collection, one theme dictionary, time and season per 21 §3.2.
// The broken example is a copy of the valid one with seven seeded author
// mistakes; the SEEDED list below mirrors the README table — keep them in sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage, validateDiscoveryIndex } from './validate-package.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONTENT = path.join(REPO, 'content');
const TEMPLATE = path.join(CONTENT, 'author-template');
const BROKEN = path.join(CONTENT, 'author-template-invalid');

const SEEDED = [
  'content-not-approved',
  'duplicate-id',
  'guide-duration-not-in-range',
  'missing-media',
  'tier-mismatch',
  'unknown-ref',
  'unsafe-path',
];

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0205-'));
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  return dir;
}

test('criterion 1: the valid template package validates with no errors and no warnings', () => {
  assert.deepEqual(validatePackage(TEMPLATE), { ok: true, errors: [], warnings: [] });
});

test('criterion 1: the broken example fails on exactly the seven documented diagnostics', () => {
  const result = validatePackage(BROKEN);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.rule).sort(), SEEDED);
  // The duplicated place shares the original's coordinates: exactly one
  // radius-overlap warning — the non-blocking field-check hint the README
  // documents alongside the table.
  assert.deepEqual(result.warnings.map((w) => w.rule), ['radius-overlap']);
});

test('guard: the README error table stays in sync with SEEDED (implementation-rules 1)', () => {
  const readme = fs.readFileSync(path.join(CONTENT, 'README.md'), 'utf8');
  const section = readme.split('## Сем памылак')[1].split('\n## ')[0];
  // Data rows of the error table end with the diagnostic rule in backticks;
  // header and separator lines carry no trailing rule token.
  const rules = section
    .split('\n')
    .map((line) => line.match(/`([a-z-]+)`\s*\|\s*$/))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.equal(rules.length, SEEDED.length, 'the README table must carry one row per seeded mistake');
  assert.deepEqual([...new Set(rules)].sort(), SEEDED);
});

test('criterion 2: texts and media swap without any code change', () => {
  const dir = tempCopy();
  const discovery = readJson(dir, 'discovery.json');
  discovery.offers[0].localized.title = { be: 'Іншы шаблонны гід', en: 'Another template guide' };
  fs.writeFileSync(path.join(dir, 'discovery.json'), JSON.stringify(discovery, null, 2));
  const stories = readJson(dir, 'be/base/stops.json');
  stories[0].text = 'Зусім іншы тэкст базавай гісторыі, напісаны аўтарам замест шаблоннага.';
  stories[0].transcript = 'Зусім іншы транскрыпт той самай гісторыі.';
  fs.writeFileSync(path.join(dir, 'be/base/stops.json'), JSON.stringify(stories, null, 2));
  fs.writeFileSync(
    path.join(dir, 'be/base/audio/story-1-base.m4a'),
    Buffer.from('replacement audio bytes written by the author', 'utf8'),
  );
  assert.deepEqual(validatePackage(dir), { ok: true, errors: [], warnings: [] });
});

test('criterion 3: an unknown schema_version is rejected by the index schema', () => {
  const authoring = readJson(TEMPLATE, 'discovery.json');
  // The authoring discovery is a partial index: the packager stamps
  // schema_version (with availability and access) at build time (G02.02).
  assert.equal('schema_version' in authoring, false);
  const stamped = { ...authoring, schema_version: 2 };
  const result = validateDiscoveryIndex(stamped);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.rule === 'const'), JSON.stringify(result.errors));
});

test('criterion 4: the template ships data only — no executable code under content/', () => {
  const executable = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(entry.name)) executable.push(path.relative(CONTENT, child));
    }
  };
  walk(CONTENT);
  assert.deepEqual(executable, [], 'content/ must hold data and docs only; the import format stays with G12.01');
});

test('criterion 5: one theme dictionary, time range and season per 21 §3.2', () => {
  const discovery = readJson(TEMPLATE, 'discovery.json');
  const route = readJson(TEMPLATE, 'route.json');
  // One theme dictionary; every offer picks its themes from it.
  assert.equal(discovery.themes.length, 1);
  const themeIds = new Set(discovery.themes.map((t) => t.id));
  for (const offer of discovery.offers) {
    for (const id of offer.themes) assert.ok(themeIds.has(id), `${offer.offer_id} uses unknown theme ${id}`);
  }
  // Time: the guide offer's range must include route.duration_min.
  const guide = discovery.offers.find((o) => o.ref.kind === 'guide');
  assert.ok(
    guide.estimated_duration.min_minutes <= route.duration_min &&
      route.duration_min <= guide.estimated_duration.max_minutes,
    `estimated_duration ${JSON.stringify(guide.estimated_duration)} must include duration_min ${route.duration_min}`,
  );
  // Season: a non-empty recommendation with a localized reason on the guide offer.
  assert.equal(guide.season_recommendations.length, 1);
  assert.ok(['spring', 'summer', 'autumn', 'winter'].includes(guide.season_recommendations[0].season));
  // Collection: place + guide members and the overlap note explaining the shared start.
  const collection = discovery.collections[0];
  assert.deepEqual(collection.members.map((m) => m.kind), ['place', 'guide']);
  assert.ok(collection.overlap_note && collection.overlap_note.be && collection.overlap_note.en);
  // The place with an offer carries its public projection at the detail_ref path.
  const placeOffer = discovery.offers.find((o) => o.ref.kind === 'place');
  assert.ok(fs.existsSync(path.join(TEMPLATE, placeOffer.detail_ref.path)));
});
