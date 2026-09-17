// G02.01 — acceptance suite for the content contracts. Issue #54 criteria:
// 1. route_id is the UI "Гід" identity; reordering stops never changes ids.
// 2. origin/namespace isolation.
// 3. Per-file checks: history/version, language, transcript, rights, access.
// 4. An import cannot claim official provenance.
// 5. DiscoveryIndex/refs, FeedbackTarget, time range, seasonal reasons and the
//    separate UI/text/audio readiness per 21 §3.2; catalog envelope/legacy
//    reader per the G01.06 decision (21 §3.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateSchemaFile,
  readCatalogDoc,
  checkIndexRules,
  checkOfficialProfile,
  checkImportedProfile,
} from './reader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));

const schema = (name, doc) => validateSchemaFile(`schemas/${name}`, doc);
const fixtureStops = [];

test('positive: demo-route authoring files conform to the schemas', () => {
  for (const [file, name] of [
    ['fixtures/content/demo-route/route.json', 'route.schema.json'],
    ['fixtures/content/demo-route/voices.json', 'voice.schema.json'],
  ]) {
    const res = schema(name, readJson(file));
    assert.ok(res.ok, `${file}: ${JSON.stringify(res.errors)}`);
  }
  for (const places of [readJson('fixtures/content/demo-route/places.json')]) {
    for (const [i, place] of places.entries()) {
      const res = schema('place.schema.json', place);
      assert.ok(res.ok, `places.json[${i}]: ${JSON.stringify(res.errors)}`);
    }
  }
});

test('positive: per-locale stops files (base and extended) conform', () => {
  const localesDir = path.join(REPO, 'fixtures/content/demo-route');
  for (const locale of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue;
    for (const tier of ['base', 'extended']) {
      const file = path.join(localesDir, locale.name, tier, 'stops.json');
      if (!fs.existsSync(file)) continue;
      const stories = JSON.parse(fs.readFileSync(file, 'utf8'));
      fixtureStops.push(...stories);
      for (const [i, story] of stories.entries()) {
        const res = schema('story.schema.json', story);
        assert.ok(res.ok, `${locale.name}/${tier}/stops.json[${i}]: ${JSON.stringify(res.errors)}`);
      }
    }
  }
  assert.ok(fixtureStops.length > 0, 'demo-route carries at least one story');
});

test('positive: public projections conform (places, collections)', () => {
  const projDir = path.join(REPO, 'fixtures/content/demo-route');
  for (const dir of ['places', 'collections']) {
    const base = path.join(projDir, dir);
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(base, entry.name, 'public.json');
      const res = schema('public-projection.schema.json', JSON.parse(fs.readFileSync(file, 'utf8')));
      assert.ok(res.ok, `${dir}/${entry.name}/public.json: ${JSON.stringify(res.errors)}`);
    }
  }
});

test('criterion 1: reordering stops never changes stop ids; route_id keys the guide', () => {
  const route = readJson('fixtures/content/demo-route/route.json');
  const idsBefore = route.stops.map((s) => s.id).sort();
  const reordered = { ...route, stops: [...route.stops].reverse() };
  assert.deepEqual(reordered.stops.map((s) => s.id).sort(), idsBefore);
  for (const stop of reordered.stops) {
    const original = route.stops.find((s) => s.id === stop.id);
    assert.deepEqual(stop, original, 'each stop keeps its own record: ids travel with stops, not with indexes');
  }
  const res = schema('route.schema.json', reordered);
  assert.ok(res.ok, JSON.stringify(res.errors));
  assert.equal(typeof route.route_id, 'string');
  assert.match(route.route_id, /^[a-z0-9._-]{1,64}$/);
});

test('criterion 2: origin accepts only official|imported (namespace isolation)', () => {
  const bad = { ...readJson('fixtures/content/demo-route/route.json'), origin: 'kudy-official' };
  const res = schema('route.schema.json', bad);
  assert.ok(!res.ok);
  assert.ok(res.errors.some((e) => e.keyword === 'enum'));
});

test('criterion 3: history, language, transcript, rights and access are checked per file', () => {
  const story = readJson('fixtures/content/demo-route/be/base/stops.json')[0];
  for (const [field, name] of [
    ['transcript', 'story.schema.json'],
    ['review', 'story.schema.json'],
  ]) {
    const broken = { ...story };
    delete broken[field];
    const res = schema(name, broken);
    assert.ok(!res.ok, `${field} must be required`);
  }
  const unreviewed = { ...story, review: { ...story.review, decision: 'pending' } };
  assert.ok(schema('story.schema.json', unreviewed).ok, 'pending review is a valid authoring state');
  const media = readJson('contracts/examples/media-demo.json');
  const noLicense = { ...media };
  delete noLicense.license;
  assert.ok(!schema('media.schema.json', noLicense).ok, 'media rights (license) required');
  const plVoice = { ...readJson('fixtures/content/demo-route/voices.json')[0], locale: 'pl' };
  assert.ok(!schema('voice.schema.json', plVoice).ok, 'reserved locales are not in the allowlist');
});

test('criterion 4: an import cannot claim official provenance', () => {
  const imported = readJson('contracts/examples/imported-route.json');
  assert.ok(schema('route.schema.json', imported).ok, 'imported doc is structurally valid content');
  assert.ok(checkImportedProfile(imported).ok, 'import profile accepts its own namespace');
  const official = checkOfficialProfile(imported);
  assert.ok(!official.ok, 'official profile rejects imported provenance');
  assert.ok(official.errors.some((e) => e.rule === 'origin-not-official'));
  const masquerade = { ...imported, origin: 'official' };
  assert.ok(schema('route.schema.json', masquerade).ok, 'the charset alone cannot detect a masquerade');
  const caught = checkOfficialProfile(masquerade);
  assert.ok(!caught.ok, 'official profile rejects imp. ids claiming official');
  assert.ok(caught.errors.some((e) => e.rule === 'import-namespace-in-official'));
  const target = { kind: 'guide', route_id: 'imp.osm-demo.route-1', version: '1', locale: 'be' };
  assert.ok(!checkOfficialProfile(target).ok, 'imported ids never reach feedback targets');
});

test('criterion 5: discovery index — valid fixture passes schema and named rules', () => {
  const index = readJson('fixtures/discovery-contract/index-valid.json');
  const res = schema('discovery-index.schema.json', index);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const rules = checkIndexRules(index);
  assert.ok(rules.ok, JSON.stringify(rules.errors));
});

test('criterion 5: index-invalid fixtures fail on their named rule', () => {
  const expected = {
    'index-invalid-duplicate-ref.json': ['duplicate-member-ref'],
    'index-invalid-duration-range.json': ['estimated_duration_range'],
    'index-invalid-foreign-city.json': ['foreign-city'],
    'index-invalid-missing-overlap-note.json': ['missing-overlap-note'],
    'index-invalid-nested-collection.json': [],
    'index-invalid-private-path.json': [],
    'index-invalid-unknown-locale.json': [],
    'index-invalid-unknown-season.json': [],
    'index-invalid-limits.json': [],
  };
  for (const [file, namedRules] of Object.entries(expected)) {
    const doc = readJson(`fixtures/discovery-contract/${file}`);
    const res = schema('discovery-index.schema.json', doc);
    const rules = res.ok ? checkIndexRules(doc) : { ok: false, errors: [] };
    assert.ok(!res.ok || !rules.ok, `${file} must fail`);
    for (const rule of namedRules) {
      assert.ok(
        res.errors.some((e) => e.rule === rule) || rules.errors.some((e) => e.rule === rule),
        `${file} must fail on ${rule}: ${JSON.stringify({ schema: res.errors, rules: rules.errors })}`,
      );
    }
  }
});

test('criterion 5: FeedbackTarget shape per 21 §5.1', () => {
  const guide = { kind: 'guide', route_id: 'demo-route-a1', version: '1', locale: 'be' };
  const place = { kind: 'place', place_id: 'place-1', content_version: '1', locale: 'en' };
  assert.ok(schema('feedback-target.schema.json', guide).ok);
  assert.ok(schema('feedback-target.schema.json', place).ok);
  assert.ok(!schema('feedback-target.schema.json', { kind: 'collection', collection_id: 'c', content_version: '1', locale: 'be' }).ok);
});

test('catalog envelope: v1 with and without discovery_index, legacy v0, unknown major', () => {
  const withDiscovery = readCatalogDoc(readJson('fixtures/discovery-contract/catalog-with-discovery.json'));
  assert.equal(withDiscovery.status, 'v1');
  assert.ok(withDiscovery.ok, JSON.stringify(withDiscovery.errors));
  assert.ok(withDiscovery.discovery_index);
  const legacy = readCatalogDoc(readJson('fixtures/discovery-contract/catalog-legacy.json'));
  assert.equal(legacy.status, 'v1');
  assert.ok(legacy.ok);
  assert.equal(legacy.discovery_index, null);
  const v0 = readCatalogDoc(readJson('fixtures/discovery-contract/catalog-legacy-v0.json'));
  assert.equal(v0.status, 'legacy-v0');
  assert.ok(v0.ok && Array.isArray(v0.routes));
  const unknownMajor = readCatalogDoc({
    catalog_schema_version: 2,
    routes: [{ route_id: 'r', version: '1', locales: ['be'], layers: ['base'], sizes: { base: 1 } }],
    discovery_index: { schema_version: 1, revision: 'r', path: 'discovery/c/r/index.json', bytes: 10, sha256: 'a'.repeat(64) },
  });
  assert.equal(unknownMajor.status, 'unknown-major');
  assert.equal(unknownMajor.discovery_index, null, 'discovery is not pulled for unknown major');
  assert.deepEqual(unknownMajor.routes.map((r) => r.route_id), ['r']);
});

test('catalog rejects an oversized discovery index before any fetch', () => {
  const doc = readCatalogDoc(readJson('fixtures/discovery-contract/catalog-invalid-oversized.json'));
  assert.ok(!doc.ok);
  assert.ok(doc.errors.some((e) => e.rule === 'discovery-index-oversized'));
});

test('examples: moment and media conform; all schema files are valid JSON with $schema', () => {
  assert.ok(schema('moment.schema.json', readJson('contracts/examples/moment-demo.json')).ok);
  assert.ok(schema('media.schema.json', readJson('contracts/examples/media-demo.json')).ok);
  const schemasDir = path.join(HERE, 'schemas');
  for (const file of fs.readdirSync(schemasDir)) {
    const doc = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf8'));
    assert.equal(doc.$schema, 'http://json-schema.org/draft-07/schema#', file);
  }
});
