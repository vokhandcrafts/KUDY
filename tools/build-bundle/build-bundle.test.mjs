import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BuildError,
  assembleIndex,
  buildBundle,
  canonicalJson,
  sha256Hex,
} from './build-bundle.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = path.join(repoRoot, 'fixtures', 'content', 'demo-route');
const contractDir = path.join(repoRoot, 'fixtures', 'discovery-contract');

async function tempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function copyTree(from, to) {
  await fsp.cp(from, to, { recursive: true });
}

async function buildDemoFixture() {
  const out = await tempDir('kudy-build-');
  await buildBundle({ inDir: fixtureDir, outDir: out });
  return out;
}

async function readOutTree(outDir) {
  const files = {};
  async function walk(rel) {
    const entries = await fsp.readdir(path.join(outDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relChild);
      else {
        const buf = await fsp.readFile(path.join(outDir, relChild));
        files[relChild] = sha256Hex(buf);
      }
    }
  }
  await walk('');
  return Object.fromEntries(Object.entries(files).sort());
}

function readJson(outDir, rel) {
  return JSON.parse(fs.readFileSync(path.join(outDir, ...rel.split('/')), 'utf8'));
}

// ------------------------------------------------------------- AC1: hashes

test('AC1: two builds of the same author tree are byte-identical', async () => {
  const outA = await buildDemoFixture();
  const outB = await buildDemoFixture();
  assert.deepEqual(await readOutTree(outA), await readOutTree(outB));
});

test('AC1: lock.json is [{path, bytes, sha256}] covering every layer file except itself', async () => {
  const out = await buildDemoFixture();
  for (const lockRel of [
    'public/bundle/demo-route-a1/1/be/base/lock.json',
    'public/bundle/demo-route-a1/1/en/base/lock.json',
    'public/bundle/demo-route-a1/1/uk/base/lock.json',
    'private/bundle/demo-route-a1/1/be/extended/lock.json',
    'private/bundle/demo-route-a1/1/en/extended/lock.json',
  ]) {
    const lock = readJson(out, lockRel);
    assert.ok(Array.isArray(lock), lockRel);
    const layerDir = path.posix.dirname(lockRel);
    const lockFileName = path.posix.basename(lockRel);
    const layerFiles = Object.keys(await readOutTree(path.join(out, ...layerDir.split('/'))))
      .map((rel) => rel.replaceAll('\\', '/'))
      .filter((rel) => rel !== lockFileName);
    assert.deepEqual(
      lock.map((entry) => Object.keys(entry).sort()),
      lock.map(() => ['bytes', 'path', 'sha256']),
      lockRel,
    );
    assert.deepEqual(
      lock.map((entry) => entry.path).sort(),
      layerFiles.sort(),
      `${lockRel} must list the full layer`,
    );
    for (const entry of lock) {
      const buf = await fsp.readFile(path.join(out, layerDir, ...entry.path.split('/')));
      assert.equal(entry.bytes, buf.length, `${lockRel}: ${entry.path}`);
      assert.equal(entry.sha256, sha256Hex(buf), `${lockRel}: ${entry.path}`);
    }
  }
});

test('AC1: release manifest lists every artifact with bytes and sha256', async () => {
  const out = await buildDemoFixture();
  const manifest = readJson(out, 'release/release-manifest.json');
  const tree = await readOutTree(out);
  const listed = manifest.artifacts.map((entry) => entry.path);
  const onDisk = Object.keys(tree).filter(
    (rel) => rel !== 'release/release-manifest.json' && !rel.startsWith('release/feedback-target-registry'),
  );
  assert.deepEqual(listed.sort(), onDisk.sort());
  for (const entry of manifest.artifacts) {
    assert.ok(entry.bytes > 0, entry.path);
    assert.equal(entry.sha256, tree[entry.path], entry.path);
  }
});

// -------------------------------------------------- AC1: EOL pin (rule 1/4)

test('AC1: hashed input paths carry the -text pin; reverting .gitattributes fails this check', () => {
  const out = execFileSync('git', ['check-attr', 'text', 'fixtures/content/demo-route/route.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(out, /text: unset/, out);
});

test('AC1: lock hashes equal the committed LF blob, not a CRLF working copy', async () => {
  const out = await buildDemoFixture();
  const lock = readJson(out, 'public/bundle/demo-route-a1/1/be/base/lock.json');
  const stopsEntry = lock.find((entry) => entry.path === 'stops.json');
  const blob = execFileSync('git', ['show', 'HEAD:fixtures/content/demo-route/be/base/stops.json'], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(stopsEntry.sha256, sha256Hex(blob));
});

// ------------------------------------------------------------- AC2: previews

test('AC2: base layer carries the serialized preview of locked stops, allowed fields only', async () => {
  const out = await buildDemoFixture();
  const previews = readJson(out, 'public/bundle/demo-route-a1/1/be/base/previews.json');
  assert.deepEqual(previews, [
    {
      stop_id: 'stop-2',
      place_id: 'place-2',
      name: {
        be: 'Млынавая калона (дэма)',
        en: 'The Mill Column (demo)',
        uk: 'Млинарська колона (демо)',
      },
      announce: {
        be: 'За паваротам — апошняя калона старога млына і гісторыя пра яе вяртуна.',
        en: 'Around the bend stands the last column of the old mill; a story about its weathervane.',
        uk: 'За поворотом — остання колона старого млина та історія про її флюгер.',
      },
    },
  ]);
});

test('AC2: a locked stop without a preview fails the build (09 §3 invariant 3)', async () => {
  const work = await tempDir('kudy-author-');
  await copyTree(fixtureDir, work);
  const routeRel = path.join(work, 'route.json');
  const route = JSON.parse(await fsp.readFile(routeRel, 'utf8'));
  delete route.stops.find((stop) => stop.id === 'stop-2').preview;
  await fsp.writeFile(routeRel, canonicalJson(route), 'utf8');
  const out = await tempDir('kudy-build-');
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'preview-missing',
  );
});

// ------------------------------------------------- AC3: private leak guards

test('AC3: public tree has no extended paths, no source maps, and private text stays private', async () => {
  const out = await buildDemoFixture();
  const tree = await readOutTree(out);
  for (const rel of Object.keys(tree)) {
    if (rel.startsWith('public/')) {
      assert.ok(!rel.includes('/extended/') && !rel.includes('/private/'), rel);
      assert.ok(!rel.endsWith('.map'), rel);
    }
  }
  const publicStops = readJson(out, 'public/bundle/demo-route-a1/1/be/base/stops.json');
  assert.equal(publicStops.some((story) => story.story_id === 'story-2-ext'), false);
  const extendedStops = readJson(out, 'private/bundle/demo-route-a1/1/be/extended/stops.json');
  assert.equal(extendedStops[0].story_id, 'story-2-ext');
});

test('AC3: paid text copied into a preview fails the build with private-text-leak', async () => {
  const work = await tempDir('kudy-author-');
  await copyTree(fixtureDir, work);
  const routeRel = path.join(work, 'route.json');
  const route = JSON.parse(await fsp.readFile(routeRel, 'utf8'));
  const extStops = JSON.parse(
    await fsp.readFile(path.join(work, 'be', 'extended', 'stops.json'), 'utf8'),
  );
  const words = extStops[0].text.split(' ');
  route.stops.find((stop) => stop.id === 'stop-2').preview.announce.be =
    words.slice(0, 10).join(' ');
  await fsp.writeFile(routeRel, canonicalJson(route), 'utf8');
  const out = await tempDir('kudy-build-');
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'private-text-leak',
  );
});

test('AC3: build errors carry codes and ids, never paid content', async () => {
  const work = await tempDir('kudy-author-');
  await copyTree(fixtureDir, work);
  const routeRel = path.join(work, 'route.json');
  const route = JSON.parse(await fsp.readFile(routeRel, 'utf8'));
  delete route.stops.find((stop) => stop.id === 'stop-2').preview;
  await fsp.writeFile(routeRel, canonicalJson(route), 'utf8');
  try {
    const out = await tempDir('kudy-build-');
    await buildBundle({ inDir: work, outDir: out });
    assert.fail('build must fail');
  } catch (error) {
    assert.ok(error instanceof BuildError);
    const paidFragment = 'Платны дэма-тэкст пашыранай гісторыі';
    assert.equal(error.message.includes(paidFragment), false);
    assert.equal(JSON.stringify(error.ids).includes(paidFragment), false);
  }
});

// ------------------------------------------------- AC4: index and registry

test('AC4: index computes availability from published content; uk stays text-only', async () => {
  const out = await buildDemoFixture();
  const index = readJson(out, 'public/discovery/demo-city/r-demo-1/index.json');
  assert.equal(index.schema_version, 1);
  assert.equal(index.city_id, 'demo-city');
  const guide = index.offers.find((offer) => offer.offer_id === 'offer-guide-demo');
  assert.deepEqual(guide.availability, { text_locales: ['be', 'en', 'uk'], audio_locales: ['be', 'en'] });
  assert.equal(guide.access, 'paid');
  const place = index.offers.find((offer) => offer.offer_id === 'offer-place-1');
  assert.deepEqual(place.availability, { text_locales: ['be', 'en', 'uk'], audio_locales: [] });
  assert.equal(place.access, 'free');
  const collection = index.offers.find((offer) => offer.offer_id === 'offer-collection-demo');
  assert.deepEqual(collection.availability, { text_locales: ['be', 'en', 'uk'], audio_locales: [] });
  assert.equal(collection.access, 'mixed', 'paid guide member makes the collection mixed');
  assert.deepEqual(
    index.offers.map((offer) => offer.offer_id),
    ['offer-guide-demo', 'offer-place-1', 'offer-collection-demo'],
  );
  assert.ok(index.collections[0].overlap_note, 'overlap_note required: guide starts at member place-1');
  assert.equal(index.collections[0].members.length, 2);
});

test('AC4: collection projection is built through the real packager path (integration)', async () => {
  const out = await buildDemoFixture();
  const projection = readJson(out, 'public/collections/collection-demo/public.json');
  assert.equal(projection.collection_id, 'collection-demo');
  assert.ok(projection.name.be && projection.description.en);
  const manifest = readJson(out, 'release/release-manifest.json');
  const entry = manifest.artifacts.find((artifact) => artifact.path === 'public/collections/collection-demo/public.json');
  assert.equal(entry?.kind, 'collection_public');
});

test('AC4: collections are not feedback targets (21 §5.2), registry keeps guide/place only', async () => {
  const out = await buildDemoFixture();
  const registry = readJson(out, 'release/feedback-target-registry.json');
  assert.equal(registry.targets.some((target) => target.kind === 'collection'), false);
});

test('AC4: wrong detail_ref content version fails the real build with detail-ref-mismatch', async () => {
  const work = await tempDir('kudy-author-');
  await copyTree(fixtureDir, work);
  const discoveryRel = path.join(work, 'discovery.json');
  const discovery = JSON.parse(await fsp.readFile(discoveryRel, 'utf8'));
  // point the place-1 offer at the collection projection file: the path
  // exists in the public manifest but belongs to another entity/version
  discovery.offers.find((offer) => offer.offer_id === 'offer-place-1').detail_ref.path =
    'collections/collection-demo/public.json';
  await fsp.writeFile(discoveryRel, canonicalJson(discovery), 'utf8');
  const out = await tempDir('kudy-build-');
  await assert.rejects(
    buildBundle({ inDir: work, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'detail-ref-mismatch',
  );
});

test('MEDIUM fix: corrupt tier JSON fails with invalid-json, not an uncaught SyntaxError', async () => {
  for (const tierRel of ['be/base/stops.json', 'be/extended/stops.json']) {
    const work = await tempDir('kudy-author-');
    await copyTree(fixtureDir, work);
    await fsp.writeFile(path.join(work, ...tierRel.split('/')), '{ not json', 'utf8');
    const out = await tempDir('kudy-build-');
    await assert.rejects(
      buildBundle({ inDir: work, outDir: out }),
      (error) =>
        error instanceof BuildError &&
        error.code === 'invalid-json' &&
        error.ids.path.endsWith(tierRel),
    );
  }
});

test('AC4: registry export is prepared, ids only, one entry per target revision', async () => {
  const out = await buildDemoFixture();
  const registry = readJson(out, 'release/feedback-target-registry.json');
  assert.equal(registry.status, 'prepared');
  assert.deepEqual(registry.targets, [
    { kind: 'guide', route_id: 'demo-route-a1', version: '1', locale: 'be', status: 'prepared' },
    { kind: 'guide', route_id: 'demo-route-a1', version: '1', locale: 'en', status: 'prepared' },
    { kind: 'guide', route_id: 'demo-route-a1', version: '1', locale: 'uk', status: 'prepared' },
    { kind: 'place', place_id: 'place-1', content_version: '1', locale: 'be', status: 'prepared' },
    { kind: 'place', place_id: 'place-1', content_version: '1', locale: 'en', status: 'prepared' },
    { kind: 'place', place_id: 'place-1', content_version: '1', locale: 'uk', status: 'prepared' },
  ]);
});

test('AC4: index file stays within the 512 KiB budget of 21 §3.2', async () => {
  const out = await buildDemoFixture();
  const buf = await fsp.readFile(path.join(out, 'public', 'discovery', 'demo-city', 'r-demo-1', 'index.json'));
  assert.ok(buf.length <= 512 * 1024);
});

// ------------------------------- index assembly vs the contract fixtures

function stubContext(index) {
  const refInfo = new Map();
  const pathMeta = new Map();
  for (const offer of index.offers ?? []) {
    refInfo.set(JSON.stringify(offer.ref), { ok: true, availability: offer.availability, access: offer.access });
    const path = offer.detail_ref?.path;
    if (path && !pathMeta.has(path)) {
      pathMeta.set(path, {
        ok: true,
        placeId: offer.ref?.place_id,
        collectionId: offer.ref?.collection_id,
        contentVersion: offer.ref?.content_version,
      });
    }
  }
  return {
    cityId: index.city_id,
    resolveRef(ref) {
      return refInfo.get(JSON.stringify(ref)) ?? { ok: false };
    },
    routeDuration: () => null,
    publicPathMeta: (rel) => pathMeta.get(rel) ?? { ok: false },
  };
}

function stripComputed(index) {
  const clone = JSON.parse(JSON.stringify(index));
  for (const offer of clone.offers ?? []) {
    delete offer.availability;
    delete offer.access;
  }
  return clone;
}

test('AC4: assembling the normative fixture reproduces index-valid.json', async () => {
  const original = JSON.parse(await fsp.readFile(path.join(contractDir, 'index-valid.json'), 'utf8'));
  const { index } = assembleIndex(stripComputed(original), stubContext(original));
  assert.deepEqual(index, original);
});

const negativeCases = [
  ['index-invalid-duplicate-ref.json', 'duplicate-member-ref'],
  ['index-invalid-nested-collection.json', 'nested-collection'],
  ['index-invalid-unknown-locale.json', 'unknown-locale'],
  ['index-invalid-unknown-season.json', 'unknown-season'],
  ['index-invalid-foreign-city.json', 'foreign-city'],
  ['index-invalid-private-path.json', 'private-path'],
  ['index-invalid-missing-overlap-note.json', 'missing-overlap-note'],
  ['index-invalid-duration-range.json', 'duration-range'],
];

for (const [file, expectedCode] of negativeCases) {
  test(`AC4: ${file} fails the builder on ${expectedCode}`, async () => {
    const fixture = JSON.parse(await fsp.readFile(path.join(contractDir, file), 'utf8'));
    assert.throws(
      () => assembleIndex(stripComputed(fixture), stubContext(fixture)),
      (error) => error instanceof BuildError && error.code === expectedCode,
    );
  });
}

// Assembly-level codes without contract fixtures: covered here instead of
// adding files to fixtures/discovery-contract/ (that set belongs to the
// G01.06 contract and is G02.02's blocking input).
function minimalContext({ resolveRefOk = true, metaContentVersion = '1' } = {}) {
  return {
    cityId: 'demo-city',
    resolveRef: (ref) =>
      resolveRefOk && ref.kind === 'place' && ref.place_id === 'place-1' && ref.content_version === '1'
        ? { ok: true, availability: { text_locales: ['be'], audio_locales: [] }, access: 'free' }
        : { ok: false },
    routeDuration: () => null,
    publicPathMeta: (rel) =>
      rel === 'places/place-1/public.json'
        ? { ok: true, placeId: 'place-1', collectionId: undefined, contentVersion: metaContentVersion }
        : { ok: false },
  };
}

function minimalAuthoring({ offerId = 'offer-x1', themeId = 'theme-x1', ref } = {}) {
  return {
    revision: 'r-test',
    city_id: 'demo-city',
    themes: [{ id: themeId, labels: { be: 'Тэма' } }],
    offers: [
      {
        offer_id: offerId,
        ref: ref ?? { kind: 'place', place_id: 'place-1', content_version: '1' },
        city_id: 'demo-city',
        editorial_order: 1,
        themes: [themeId],
        localized: { title: { be: 'Назва' } },
        season_recommendations: [],
        detail_ref: { kind: 'place_public', path: 'places/place-1/public.json' },
      },
    ],
    collections: [],
  };
}

test('AC4: unknown-ref — an offer ref the context cannot resolve fails assembly', () => {
  assert.throws(
    () => assembleIndex(minimalAuthoring(), minimalContext({ resolveRefOk: false })),
    (error) => error instanceof BuildError && error.code === 'unknown-ref',
  );
});

test('AC4: detail-ref-mismatch — a public path of another entity/version fails assembly', () => {
  assert.throws(
    () => assembleIndex(minimalAuthoring(), minimalContext({ metaContentVersion: '9' })),
    (error) => error instanceof BuildError && error.code === 'detail-ref-mismatch',
  );
});

test('AC4: duplicate-offer-id — two offers with one id fail assembly', () => {
  const authoring = minimalAuthoring();
  authoring.offers.push({ ...authoring.offers[0] });
  assert.throws(
    () => assembleIndex(authoring, minimalContext()),
    (error) => error instanceof BuildError && error.code === 'duplicate-offer-id',
  );
});

test('AC4: duplicate-theme — two themes with one id fail assembly', () => {
  const authoring = minimalAuthoring();
  authoring.themes.push({ ...authoring.themes[0] });
  assert.throws(
    () => assembleIndex(authoring, minimalContext()),
    (error) => error instanceof BuildError && error.code === 'duplicate-theme',
  );
});

test('AC4: invalid-identifier — a bad revision fails assembly', () => {
  const authoring = minimalAuthoring();
  authoring.revision = 'Bad Revision!';
  assert.throws(
    () => assembleIndex(authoring, minimalContext()),
    (error) => error instanceof BuildError && error.code === 'invalid-identifier',
  );
});

// ------------------------------------------------------------------ guards

test('guard: build output directory is gitignored (implementation-rules 5)', () => {
  const out = execFileSync('git', ['check-ignore', '-v', 'tools/build-bundle/build/demo'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(out, /tools\/build-bundle\/build\//, out);
});

test('guard: non-empty output directory is refused', async () => {
  const out = await buildDemoFixture();
  await assert.rejects(
    buildBundle({ inDir: fixtureDir, outDir: out }),
    (error) => error instanceof BuildError && error.code === 'out-dir-not-empty',
  );
});
