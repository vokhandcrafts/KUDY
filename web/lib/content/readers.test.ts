// G10.01.a acceptance 2: readers return the demo-route fixture data with
// correct locale/tier projection; a modified schema_version input yields a
// defined safe rejection, not a partial render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoFixture } from './test-fixture.ts';
import { readBundleBaseStories, readBundleDiscoveryIndex, readBundlePreviews, readBundleRoute, readPlaceProjection } from './bundle.ts';
import { readBaseStories, readCatalog, isKnownLocale, readDiscoveryIndex, readPreviews } from './readers.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DISCOVERY_CONTRACT = path.join(REPO_ROOT, 'fixtures', 'discovery-contract');

const { publicRoot, buildRoot } = await buildDemoFixture();

test('route reader returns the demo-route fixture with base/extended stops', () => {
  const res = readBundleRoute(publicRoot, 'demo-route-a1', '1');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.route_id, 'demo-route-a1');
  assert.equal(res.data.version, '1');
  assert.equal(res.data.free_stop_count, 1);
  assert.deepEqual(res.data.stops.map((s) => s.id), ['stop-1', 'stop-2']);
  assert.equal(res.data.stops[0]!.access_tier, 'base');
  assert.equal(res.data.stops[1]!.access_tier, 'extended');
});

test('base stories reader returns the free tier only, with transcript', () => {
  const be = readBundleBaseStories(publicRoot, 'demo-route-a1', '1', 'be');
  assert.equal(be.ok, true);
  if (be.ok) {
    assert.equal(be.data.length, 1);
    assert.equal(be.data[0]!.story_id, 'story-1-base');
    assert.equal(be.data[0]!.tier, 'base');
    assert.ok(be.data[0]!.transcript.length > 0);
  }
  const en = readBundleBaseStories(publicRoot, 'demo-route-a1', '1', 'en');
  assert.equal(en.ok, true);
});

test('previews reader returns the locked stop with allowed fields only', () => {
  const res = readBundlePreviews(publicRoot, 'demo-route-a1', '1', 'be');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.length, 1);
  assert.deepEqual(Object.keys(res.data[0]!).sort(), ['announce', 'name', 'place_id', 'stop_id']);
  assert.equal(res.data[0]!.stop_id, 'stop-2');
  assert.equal(res.data[0]!.place_id, 'place-2');
});

test('place projection reader returns the public projection', () => {
  const res = readPlaceProjection(publicRoot, 'place-1');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal('place_id' in res.data && res.data.place_id, 'place-1');
  assert.ok('name' in res.data && 'summary' in res.data);
});

test('discovery index reader returns the assembled index with rules applied', () => {
  const res = readBundleDiscoveryIndex(publicRoot, 'demo-city', 'r-demo-1');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.city_id, 'demo-city');
  assert.ok(res.data.offers.length > 0);
});

test('a modified catalog schema_version is a defined safe rejection', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(DISCOVERY_CONTRACT, 'catalog-with-discovery.json'), 'utf8'));
  const bumped = { ...doc, catalog_schema_version: 2 };
  const res = readCatalog(bumped);
  assert.deepEqual(res, {
    ok: false,
    code: 'unknown-schema-version',
    errors: [{ rule: 'catalog-schema-version', path: 'catalog_schema_version' }],
  });
});

test('the v1 envelope with discovery and the legacy envelope without it both read', () => {
  const withDiscovery = readCatalog(JSON.parse(fs.readFileSync(path.join(DISCOVERY_CONTRACT, 'catalog-with-discovery.json'), 'utf8')));
  assert.equal(withDiscovery.ok, true);
  if (withDiscovery.ok) {
    assert.ok(withDiscovery.data.routes.length > 0);
    assert.ok(withDiscovery.data.discovery_index !== null);
  }
  const legacy = readCatalog(JSON.parse(fs.readFileSync(path.join(DISCOVERY_CONTRACT, 'catalog-legacy.json'), 'utf8')));
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.equal(legacy.data.discovery_index, null);
});

test('web policy rejects the bare-array legacy v0 catalog instead of rendering it', () => {
  const v0 = JSON.parse(fs.readFileSync(path.join(DISCOVERY_CONTRACT, 'catalog-legacy-v0.json'), 'utf8'));
  const res = readCatalog(v0);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'unknown-schema-version');
});

test('a modified discovery index schema_version is rejected by the contract schema', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(buildRoot, 'public', 'discovery', 'demo-city', 'r-demo-1', 'index.json'), 'utf8'));
  const bumped = { ...doc, schema_version: 2 };
  const res = readDiscoveryIndex(bumped);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'schema-invalid');
});

test('extended-tier story in a base layer is rejected whole', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(buildRoot, 'public', 'bundle', 'demo-route-a1', '1', 'be', 'base', 'stops.json'), 'utf8'));
  const poisoned = [{ ...doc[0], tier: 'extended' }];
  const res = readBaseStories(poisoned);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'non-base-story');
});

test('an unknown field in previews.json is rejected (closed 09 §5 set)', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(buildRoot, 'public', 'bundle', 'demo-route-a1', '1', 'be', 'base', 'previews.json'), 'utf8'));
  const res = readPreviews([{ ...doc[0], text: 'stuffed' }]);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'invalid-preview');
});

test('reserved and unknown locales are rejected; allowlist locales are known', () => {
  assert.equal(readBundleBaseStories(publicRoot, 'demo-route-a1', '1', 'pl').ok, false);
  const res = readBundleBaseStories(publicRoot, 'demo-route-a1', '1', 'pl');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'unknown-locale');
  assert.equal(isKnownLocale('be'), true);
  assert.equal(isKnownLocale('pl'), false);
});

test('path pieces cannot traverse out of the content root', () => {
  const res = readPlaceProjection(publicRoot, '..');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'unsafe-path');
  const res2 = readBundleDiscoveryIndex(publicRoot, '..', 'r-demo-1');
  assert.equal(res2.ok, false);
  if (!res2.ok) assert.equal(res2.code, 'unsafe-path');
});

test('missing and corrupt bundle files have defined rejections', () => {
  const missing = readBundleRoute(publicRoot, 'demo-route-a1', '999');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 'not-found');
  const corruptDir = path.join(buildRoot, 'public', 'bundle', 'demo-route-a1', '1');
  fs.writeFileSync(path.join(corruptDir, 'route.json'), '{oops');
  const corrupt = readBundleRoute(publicRoot, 'demo-route-a1', '1');
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) assert.equal(corrupt.code, 'invalid-json');
});
