// G10.01.b step 3 data tests: the map page data joins catalog routes, ordered
// stop rows and the bundle places.json geo facts into GeoJSON markers with
// [lng, lat] coordinates. Missing or malformed geo facts fail loudly with
// named diagnostics (implementation-rules 14), never a silent missing dot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SiteDataError, readSiteMapPage } from './site.ts';
import { readPlacesGeo } from './readers.ts';
import { buildDemoFixture } from './test-fixture.ts';

const { publicRoot } = await buildDemoFixture();

test('the map data joins each stop to its place geo in [lng, lat] order (acceptance 4)', () => {
  const map = readSiteMapPage(publicRoot, 'be');
  assert.equal(map.cityId, 'demo-city');
  assert.equal(map.routes.length, 1);
  const route = map.routes[0]!;
  assert.equal(route.route_id, 'demo-route-a1');
  assert.equal(route.title, 'Дэма-гід: сукнаны двор');
  assert.equal(route.href, '/guides/demo-route-a1');
  assert.deepEqual(
    route.stops.map((stop) => [stop.stop_id, stop.name, stop.locked]),
    [
      ['stop-1', 'Двор сукнараў (дэма)', false],
      ['stop-2', 'Млынавая калона (дэма)', true],
    ],
  );
  assert.equal(map.markers.type, 'FeatureCollection');
  assert.deepEqual(
    map.markers.features.map((feature) => feature.geometry.coordinates),
    [
      [18.6534, 54.3487],
      [18.652, 54.3512],
    ],
  );
  assert.deepEqual(map.markers.features.map((feature) => feature.properties.locked), [false, true]);
  assert.deepEqual(map.markers.features.map((feature) => feature.properties.name), [
    'Двор сукнараў (дэма)',
    'Млынавая калона (дэма)',
  ]);
});

test('the en map data shows en names behind the locale prefix (acceptance 1)', async () => {
  const map = readSiteMapPage(publicRoot, 'en');
  assert.equal(map.routes[0]!.href, '/en/guides/demo-route-a1');
  assert.equal(map.routes[0]!.title, 'Demo guide: the cloth courtyard');
  assert.equal(map.routes[0]!.stops[0]!.name, "Cloth Merchants' Courtyard (demo)");
});

test('a stop whose place has no geo entry fails the build loudly, naming the place', async () => {
  const { publicRoot: mutatedRoot } = await buildDemoFixture();
  const placesPath = path.join(mutatedRoot, 'bundle', 'demo-route-a1', '1', 'places.json');
  const places = JSON.parse(fs.readFileSync(placesPath, 'utf8')) as { id: string }[];
  fs.writeFileSync(placesPath, JSON.stringify(places.filter((place) => place.id !== 'place-2')));
  assert.throws(
    () => readSiteMapPage(mutatedRoot, 'be'),
    (err: unknown) =>
      err instanceof SiteDataError && err.code === 'not-found' && /places\.json:place-2$/.test(err.dataPath),
  );
});

test('malformed geo facts are a schema-invalid rejection with a per-entry path (rule 14)', async () => {
  const { publicRoot: corruptRoot } = await buildDemoFixture();
  const placesPath = path.join(corruptRoot, 'bundle', 'demo-route-a1', '1', 'places.json');
  fs.writeFileSync(
    placesPath,
    JSON.stringify([{ id: 'place-1', content_version: '1', lat: 'high', lng: 18.65, trigger_radius_m: 30, kind: 'sight' }]),
  );
  assert.throws(
    () => readSiteMapPage(corruptRoot, 'be'),
    (err: unknown) => err instanceof SiteDataError && err.code === 'schema-invalid',
  );
  const pure = readPlacesGeo([{ id: 'place-1', lat: 'high' }]);
  assert.equal(pure.ok, false);
  if (!pure.ok) {
    assert.ok(pure.errors.some((error) => error.path.includes('places[0]') && error.path.includes('lat')));
  }
});

test('places.json that is not an array is rejected with a named rule', () => {
  const pure = readPlacesGeo({ place: 'object-not-array' });
  assert.equal(pure.ok, false);
  if (!pure.ok) {
    assert.equal(pure.code, 'schema-invalid');
    assert.ok(pure.errors.some((error) => error.rule === 'places-not-an-array'));
  }
});
