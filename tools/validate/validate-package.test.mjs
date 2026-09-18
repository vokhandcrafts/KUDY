// G02.02 — acceptance suite for the package validator. Issue #103 criteria:
// 1. unknown refs, duplicate ids, invalid coordinates, missing
//    transcript/media, unapproved content and unsafe paths are caught.
// 2. Reordering stops never changes ids; RouteStop.id stability across
//    published versions is checked (--against).
// 3. Radius overlap is a field-check warning, never a rejection.
// 4. Discovery refs, duplicate/nested collections, wrong-kind feedback and
//    private projections are checked.
// 5. fixtures/discovery-contract/ is consumed as the conformance set: the
//    valid fixtures pass, every index-invalid-*.json fails on the rule its
//    text names, and the oversized catalog is rejected on discovery_index.bytes
//    before load (blocking criterion from G01.06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackage, validateDiscoveryIndex, haversineMeters } from './validate-package.mjs';
import { readCatalogDoc } from '../../contracts/reader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DEMO = path.join(REPO, 'fixtures/content/demo-route');
const FIXTURES = path.join(REPO, 'fixtures/discovery-contract');
const CLI = path.join(HERE, 'validate-package.mjs');

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8'));
const writeJson = (dir, rel, doc) => fs.writeFileSync(path.join(dir, ...rel.split('/')), JSON.stringify(doc, null, 2));

// Each negative case starts from a private copy of the demo author tree.
function copiedTree(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0202-'));
  fs.cpSync(DEMO, dir, { recursive: true });
  if (mutate) mutate(dir);
  return dir;
}

const rules = (result, name) => result.errors.filter((e) => e.rule === name);

test('positive: the demo package validates with no errors and no warnings', () => {
  const result = validatePackage(DEMO);
  assert.deepEqual(result, { ok: true, errors: [], warnings: [] });
});

test('criterion 1: unknown references are caught across the package', () => {
  const cases = [
    ['route.stops place', (d) => {
      const route = readJson(d, 'route.json');
      route.stops[0].place_id = 'place-ghost';
      writeJson(d, 'route.json', route);
    }],
    ['story voice', (d) => {
      const stories = readJson(d, 'be/base/stops.json');
      stories[0].voice_id = 'voice-ghost';
      writeJson(d, 'be/base/stops.json', stories);
    }],
    ['offer theme', (d) => {
      const index = readJson(d, 'discovery.json');
      index.offers[0].themes = ['theme-ghost'];
      writeJson(d, 'discovery.json', index);
    }],
    ['suggested_start_place_id', (d) => {
      const index = readJson(d, 'discovery.json');
      index.offers[0].suggested_start_place_id = 'place-ghost';
      writeJson(d, 'discovery.json', index);
    }],
    ['offer ref content_version', (d) => {
      const index = readJson(d, 'discovery.json');
      index.offers[1].ref.content_version = '9';
      writeJson(d, 'discovery.json', index);
    }],
    ['collection member', (d) => {
      const index = readJson(d, 'discovery.json');
      index.collections[0].members[0].place_id = 'place-ghost';
      writeJson(d, 'discovery.json', index);
    }],
    ['detail_ref target file', (d) => {
      fs.rmSync(path.join(d, 'places', 'place-1', 'public.json'));
    }],
  ];
  for (const [name, mutate] of cases) {
    const result = validatePackage(copiedTree(mutate));
    assert.ok(!result.ok, `${name} must fail`);
    assert.ok(rules(result, 'unknown-ref').length > 0, `${name} must name unknown-ref: ${JSON.stringify(result.errors)}`);
  }
});

test('criterion 1: duplicate ids are caught per collection', () => {
  const cases = [
    ['places', (d) => {
      const places = readJson(d, 'places.json');
      places.push({ ...places[0] });
      writeJson(d, 'places.json', places);
    }],
    ['voices', (d) => {
      const voices = readJson(d, 'voices.json');
      voices.push({ ...voices[0] });
      writeJson(d, 'voices.json', voices);
    }],
    ['route stops', (d) => {
      const route = readJson(d, 'route.json');
      route.stops.push({ ...route.stops[0] });
      writeJson(d, 'route.json', route);
    }],
    ['stories in one file', (d) => {
      const stories = readJson(d, 'be/base/stops.json');
      stories.push({ ...stories[0] });
      writeJson(d, 'be/base/stops.json', stories);
    }],
    ['discovery themes', (d) => {
      const index = readJson(d, 'discovery.json');
      index.themes.push({ ...index.themes[0] });
      writeJson(d, 'discovery.json', index);
    }],
    ['discovery collections', (d) => {
      const index = readJson(d, 'discovery.json');
      index.collections.push({ ...index.collections[0] });
      writeJson(d, 'discovery.json', index);
    }],
  ];
  for (const [name, mutate] of cases) {
    const result = validatePackage(copiedTree(mutate));
    assert.ok(!result.ok, `${name} duplicates must fail`);
    const expected = name === 'route stops' ? 'duplicate-stop-id' : 'duplicate-id';
    assert.ok(rules(result, expected).length > 0, `${name} must name ${expected}: ${JSON.stringify(result.errors)}`);
  }
});

test('criterion 1: invalid coordinates are caught by the place schema', () => {
  const tooHigh = validatePackage(copiedTree((d) => {
    const places = readJson(d, 'places.json');
    places[0].lat = 91;
    writeJson(d, 'places.json', places);
  }));
  assert.ok(tooHigh.errors.some((e) => e.rule === 'maximum' && e.path.startsWith('places.json[0]')), JSON.stringify(tooHigh.errors));
  const tooLow = validatePackage(copiedTree((d) => {
    const places = readJson(d, 'places.json');
    places[0].lat = -91;
    writeJson(d, 'places.json', places);
  }));
  assert.ok(tooLow.errors.some((e) => e.rule === 'minimum' && e.path.startsWith('places.json[0]')), JSON.stringify(tooLow.errors));
  const tooWide = validatePackage(copiedTree((d) => {
    const places = readJson(d, 'places.json');
    places[0].lng = 200;
    writeJson(d, 'places.json', places);
  }));
  assert.ok(tooWide.errors.some((e) => e.rule === 'maximum' && e.path.startsWith('places.json[0]')), JSON.stringify(tooWide.errors));
});

test('criterion 1: a missing transcript is caught by the story schema', () => {
  const result = validatePackage(copiedTree((d) => {
    const stories = readJson(d, 'be/base/stops.json');
    delete stories[0].transcript;
    writeJson(d, 'be/base/stops.json', stories);
  }));
  assert.ok(!result.ok);
  assert.ok(result.errors.some((e) => e.rule === 'required' && e.path.includes('transcript')), JSON.stringify(result.errors));
});

test('criterion 1: missing and orphaned media are caught', () => {
  const missingCover = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.cover = 'img/cover.webp';
    writeJson(d, 'route.json', route);
  }));
  assert.ok(rules(missingCover, 'missing-media').some((e) => e.path.includes('route.json#cover')), JSON.stringify(missingCover.errors));
  const orphan = validatePackage(copiedTree((d) => {
    fs.writeFileSync(path.join(d, 'be', 'base', 'audio', 'story-ghost.m4a'), 'x');
  }));
  assert.ok(rules(orphan, 'orphan-media').some((e) => e.path === 'be/base/audio/story-ghost.m4a'), JSON.stringify(orphan.errors));
});

test('round-3 review: a story without its audio file is missing-media; text-only layers stay clean', () => {
  const missingAudio = validatePackage(copiedTree((d) => {
    fs.rmSync(path.join(d, 'be', 'base', 'audio', 'story-1-base.m4a'));
  }));
  assert.ok(
    rules(missingAudio, 'missing-media').some((e) => e.path === 'be/base/stops.json[0]#audio'),
    JSON.stringify(missingAudio.errors),
  );
  // The uk layer ships no audio directory at all (text-only): its story must
  // not be flagged for media the layer never declared.
  const clean = validatePackage(copiedTree(null));
  assert.deepEqual(rules(clean, 'missing-media').filter((e) => e.path.startsWith('uk/')), [], JSON.stringify(clean.errors));
});

test('round-3 review: null array elements yield diagnostics, not crashes', () => {
  for (const [rel, inject] of [
    ['places.json', (doc) => { doc.push(null); }],
    ['voices.json', (doc) => { doc.push(null); }],
    ['route.json', (doc) => { doc.stops.push(null); }],
    ['be/base/stops.json', (doc) => { doc.push(null); }],
    ['discovery.json', (doc) => { doc.offers.push(null); }],
    ['discovery.json', (doc) => { doc.themes.push(null); }],
  ]) {
    const result = validatePackage(copiedTree((d) => {
      const doc = readJson(d, rel);
      inject(doc);
      writeJson(d, rel, doc);
    }));
    assert.equal(result.ok, false, `${rel} with a null element must not validate`);
    assert.ok(
      result.errors.some((e) => e.rule === 'type' || e.rule === 'required'),
      `${rel} must carry a diagnostic for the null element: ${JSON.stringify(result.errors)}`,
    );
  }
});

test('criterion 1: unapproved content is caught', () => {
  for (const decision of ['pending', 'rejected']) {
    const result = validatePackage(copiedTree((d) => {
      const stories = readJson(d, 'be/base/stops.json');
      stories[0].review.decision = decision;
      writeJson(d, 'be/base/stops.json', stories);
    }));
    assert.ok(!result.ok, `${decision} must fail`);
    assert.ok(rules(result, 'content-not-approved').length > 0, JSON.stringify(result.errors));
  }
});

test('criterion 1: unsafe paths are caught even where the schema pattern passes', () => {
  // "places/../public.json" and "places/private/public.json" both match the
  // schema charset pattern — the segment denylist is the validator's own job.
  for (const unsafePath of ['places/../public.json', 'places/private/public.json']) {
    const result = validatePackage(copiedTree((d) => {
      const index = readJson(d, 'discovery.json');
      index.offers[1].detail_ref.path = unsafePath;
      writeJson(d, 'discovery.json', index);
    }));
    assert.ok(!result.ok, unsafePath + ' must fail');
    assert.ok(rules(result, 'unsafe-path').length > 0, JSON.stringify(result.errors));
  }
  const traversal = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.cover = 'private/extended/cover.webp';
    writeJson(d, 'route.json', route);
  }));
  assert.ok(rules(traversal, 'unsafe-path').some((e) => e.path === 'route.json#cover'), JSON.stringify(traversal.errors));
});

test('criterion 2: reordering stops keeps every id and stays valid', () => {
  const route = readJson(DEMO, 'route.json');
  const ids = route.stops.map((s) => s.id).sort();
  const result = validatePackage(copiedTree((d) => {
    writeJson(d, 'route.json', { ...route, stops: [...route.stops].reverse() });
  }));
  assert.ok(result.ok, JSON.stringify(result.errors));
  assert.deepEqual(readJson(DEMO, 'route.json').stops.map((s) => s.id).sort(), ids);
});

test('criterion 2: --against catches a renumbered stop, drift and a changed route id', () => {
  const previous = copiedTree(null);
  const renumbered = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.stops[0].id = 'stop-9';
    writeJson(d, 'route.json', route);
  }), { previous });
  assert.deepEqual(renumbered.errors.map((e) => e.rule), ['stop-id-renumbered'], JSON.stringify(renumbered.errors));

  const drifted = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.stops[0].place_id = 'place-2';
    writeJson(d, 'route.json', route);
  }), { previous });
  assert.deepEqual(drifted.errors.map((e) => e.rule), ['stop-id-drift'], JSON.stringify(drifted.errors));

  const changed = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.route_id = 'demo-route-b2';
    writeJson(d, 'route.json', route);
  }), { previous });
  assert.ok(rules(changed, 'route-id-changed').length > 0, JSON.stringify(changed.errors));
});

test('criterion 2: inserting a stop keeps id stability clean', () => {
  const previous = copiedTree(null);
  const result = validatePackage(copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.stops.unshift({ id: 'stop-0', position: 0, place_id: 'place-2', access_tier: 'base', story_base_id: 'story-1-base' });
    writeJson(d, 'route.json', route);
  }), { previous });
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
});

test('round-2 review: a missing current route.json is missing-file, not route-id-changed', () => {
  const previous = copiedTree(null);
  const result = validatePackage(copiedTree((d) => {
    fs.rmSync(path.join(d, 'route.json'));
  }), { previous });
  assert.ok(rules(result, 'missing-file').some((e) => e.path === 'route.json'), JSON.stringify(result.errors));
  assert.deepEqual(rules(result, 'route-id-changed'), [], JSON.stringify(result.errors));
});

test('round-2 review: entries without an identity field are not duplicate-id verdicts', () => {
  const result = validatePackage(copiedTree((d) => {
    const stops = readJson(d, 'be/base/stops.json');
    const anonymised = { ...stops[0] };
    delete anonymised.story_id;
    writeJson(d, 'be/base/stops.json', [anonymised, anonymised]);
  }));
  assert.deepEqual(rules(result, 'duplicate-id'), [], JSON.stringify(result.errors));
  assert.ok(
    rules(result, 'required').some((e) => e.path.startsWith('be/base/stops.json')),
    'the schema must carry the missing-identity diagnostic',
  );
});

test('criterion 3: radius overlap is a warning, not a rejection', () => {
  const result = validatePackage(copiedTree((d) => {
    const places = readJson(d, 'places.json');
    places[1].lat = places[0].lat + 0.00005;
    places[1].lng = places[0].lng + 0.00005;
    writeJson(d, 'places.json', places);
  }));
  assert.ok(result.ok, 'overlap must not reject the package');
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].rule, 'radius-overlap');
  assert.match(result.warnings[0].path, /#place-1\+place-2$/);
});

test('criterion 3: haversine distance is sane for the demo places', () => {
  const places = readJson(DEMO, 'places.json');
  const d = haversineMeters(places[0].lat, places[0].lng, places[1].lat, places[1].lng);
  assert.ok(d > places[0].trigger_radius_m + places[1].trigger_radius_m, `demo places must not overlap: ${d}m`);
  assert.ok(d > 200 && d < 400, `expected ~283m, got ${d}m`);
});

test('criterion 4: a wrong-kind feedback target in the registry is rejected', () => {
  const result = validatePackage(copiedTree((d) => {
    fs.mkdirSync(path.join(d, 'release'));
    // The shape the G02.03 packager emits: {schema_version, status, targets}.
    writeJson(d, 'release/feedback-target-registry.json', {
      schema_version: 1,
      status: 'prepared',
      targets: [
        { kind: 'guide', route_id: 'demo-route-a1', version: '1', locale: 'be' },
        { kind: 'place', place_id: 'place-1', content_version: '1', locale: 'en' },
        { kind: 'collection', collection_id: 'collection-demo', content_version: '1', locale: 'be' },
      ],
    });
  }));
  assert.ok(!result.ok);
  const hits = result.errors.filter((e) => e.rule === 'oneOf' && e.path.startsWith('release/feedback-target-registry.json'));
  assert.equal(hits.length, 1, `only the collection entry fails: ${JSON.stringify(result.errors)}`);
});

test('criterion 1 follow-ups: guide duration range, tier mismatch, detail-ref ownership', () => {
  const duration = validatePackage(copiedTree((d) => {
    const index = readJson(d, 'discovery.json');
    index.offers[0].estimated_duration = { min_minutes: 90, max_minutes: 120, basis: 'author_estimate' };
    writeJson(d, 'discovery.json', index);
  }));
  assert.ok(rules(duration, 'guide-duration-not-in-range').length > 0, JSON.stringify(duration.errors));

  const tier = validatePackage(copiedTree((d) => {
    const stories = readJson(d, 'be/base/stops.json');
    stories[0].tier = 'extended';
    writeJson(d, 'be/base/stops.json', stories);
  }));
  assert.ok(rules(tier, 'tier-mismatch').length > 0, JSON.stringify(tier.errors));

  const owner = validatePackage(copiedTree((d) => {
    const index = readJson(d, 'discovery.json');
    index.offers[1].detail_ref.path = 'places/place-2/public.json';
    writeJson(d, 'discovery.json', index);
  }));
  assert.ok(rules(owner, 'detail-ref-mismatch').length > 0, JSON.stringify(owner.errors));
});

test('criterion 4: voice locale must match the story locale', () => {
  const result = validatePackage(copiedTree((d) => {
    const stories = readJson(d, 'be/base/stops.json');
    stories[0].voice_id = 'voice-en-1';
    writeJson(d, 'be/base/stops.json', stories);
  }));
  assert.ok(rules(result, 'voice-locale-mismatch').length > 0, JSON.stringify(result.errors));
});

test('criterion 5: the valid conformance fixtures pass the validator', () => {
  assert.deepEqual(validateDiscoveryIndex(readJson(FIXTURES, 'index-valid.json')), { ok: true, errors: [] });
  for (const file of ['catalog-legacy.json', 'catalog-with-discovery.json', 'catalog-legacy-v0.json']) {
    const doc = readCatalogDoc(readJson(FIXTURES, file));
    assert.ok(doc.ok, `${file}: ${JSON.stringify(doc.errors)}`);
  }
});

test('criterion 5: every index-invalid fixture fails on the rule its text names', () => {
  const expected = {
    'index-invalid-duplicate-ref.json': ['duplicate-member-ref'],
    'index-invalid-duration-range.json': ['estimated_duration_range'],
    'index-invalid-foreign-city.json': ['foreign-city'],
    'index-invalid-missing-overlap-note.json': ['missing-overlap-note'],
    'index-invalid-nested-collection.json': ['oneOf', 'nested-collection'],
    'index-invalid-private-path.json': ['oneOf', 'unsafe-path'],
    'index-invalid-unknown-locale.json': ['enum'],
    'index-invalid-unknown-season.json': ['enum'],
  };
  for (const [file, namedRules] of Object.entries(expected)) {
    const result = validateDiscoveryIndex(readJson(FIXTURES, file));
    assert.ok(!result.ok, `${file} must fail`);
    for (const name of namedRules) {
      assert.ok(
        result.errors.some((e) => e.rule === name),
        `${file} must fail on ${name}: ${JSON.stringify(result.errors)}`,
      );
    }
  }
});

test('criterion 5: every limits case fails on its own bound', () => {
  const wrapper = readJson(FIXTURES, 'index-invalid-limits.json');
  // The exact case→keyword matrix is pinned by contracts/contracts.test.mjs
  // (G02.01); here every case must fail through the validator on a bound
  // keyword — the rule its text names — not on some unrelated error.
  const boundKeywords = new Set(['maxItems', 'maxLength', 'maximum', 'minimum', 'pattern']);
  assert.ok(wrapper.cases.length >= 14, 'one case per 21 §3.2 bound');
  for (const c of wrapper.cases) {
    const result = validateDiscoveryIndex(c.index);
    assert.ok(!result.ok, `${c.id} (${c.rule}) must fail: ${JSON.stringify(result.errors)}`);
    assert.ok(
      result.errors.some((e) => boundKeywords.has(e.rule)),
      `${c.id} must fail on its bound: ${JSON.stringify(result.errors)}`,
    );
  }
});

test('criterion 5: an oversized discovery index is rejected before load', () => {
  const doc = readCatalogDoc(readJson(FIXTURES, 'catalog-invalid-oversized.json'));
  assert.ok(!doc.ok);
  assert.ok(doc.errors.some((e) => e.rule === 'discovery-index-oversized'));
});

test('CLI: --in prints the JSON verdict and exits 0 on a clean package', () => {
  const stdout = execFileSync(process.execPath, [CLI, '--in', DEMO], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(stdout), { ok: true, errors: [], warnings: [] });
});

test('CLI: --in and --against exit 1 and print diagnostics for a broken package', () => {
  const previous = copiedTree(null);
  const broken = copiedTree((d) => {
    const route = readJson(d, 'route.json');
    route.stops[0].id = 'stop-9';
    writeJson(d, 'route.json', route);
  });
  let stdout = '';
  try {
    execFileSync(process.execPath, [CLI, '--in', broken, '--against', previous], { encoding: 'utf8' });
    assert.fail('must exit non-zero');
  } catch (err) {
    assert.equal(err.status, 1);
    stdout = err.stdout;
  }
  const verdict = JSON.parse(stdout);
  assert.ok(!verdict.ok);
  assert.ok(verdict.errors.some((e) => e.rule === 'stop-id-renumbered'), stdout);
});

test('robustness: a corrupt package yields diagnostics, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0202-corrupt-'));
  fs.writeFileSync(path.join(dir, 'route.json'), '{"route_id": "r", "stops": "oops"}');
  fs.writeFileSync(path.join(dir, 'places.json'), '{"not": "an array"}');
  fs.writeFileSync(path.join(dir, 'voices.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'discovery.json'), '"just a string"');
  const result = validatePackage(dir);
  assert.ok(!result.ok);
  const present = new Set(result.errors.map((e) => e.rule));
  for (const rule of ['invalid-json', 'type']) {
    assert.ok(present.has(rule), `${rule} expected: ${JSON.stringify(result.errors)}`);
  }
  const absent = validatePackage(path.join(dir, 'no-such-dir'));
  assert.ok(!absent.ok);
  assert.ok(absent.errors.every((e) => e.rule === 'missing-file'), JSON.stringify(absent.errors));
});

test('robustness: nested non-arrays in discovery yield diagnostics, not a crash', () => {
  const dir = copiedTree((d) => {
    writeJson(d, 'discovery.json', {
      revision: 'r-demo-1',
      city_id: 'demo-city',
      themes: 'oops',
      offers: 'oops',
      collections: [{ collection_id: 'c', content_version: '1', city_id: 'demo-city', localized: {}, members: 'oops' }],
    });
  });
  const result = validatePackage(dir);
  assert.ok(!result.ok);
  assert.ok(result.errors.filter((e) => e.rule === 'type').length >= 3, JSON.stringify(result.errors));
});

test('guard: the suite is wired into npm test (implementation-rules 7)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tools\/validate\/\*\.test\.mjs/);
});
