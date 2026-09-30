// G06.01.a (issue #313) — the catalog service tests. The committed
// discovery-contract fixtures are the published data (rule 15: the tests run
// the production load path — loader port in, integrity pin, projection out).
// The envelope parity block pins the device-side envelope reading to the
// canonical reader.mjs verdicts (rule 2: one interpretation source, the
// projection may not drift).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// The canonical reader ships as untyped .mjs; the parity block uses only its
// result shape (the web bridge in web/lib/content/contract.ts declares the
// same surface locally).
// @ts-expect-error — reader.mjs has no type declarations
import { readCatalogDoc } from '../../contracts/reader.mjs';
import { loadCatalog, loadNearby, loadPreview } from './catalogService.ts';
import { readCatalogEnvelope } from './envelope.ts';
import { createOriginCatalogLoader } from './loader.ts';
import type { CatalogGuideCard, CatalogPathLoader, NearbyOfferFacts, Sha256 } from './types.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/discovery-contract');

function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

const sha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

const POINTER_PATH = 'discovery/city-a/r-2026-09-14-1/index.json';

// The real published fixture pair: the catalog pointer declares the index
// file's size and sha256, the loader serves both by relative path.
const fixtureLoader: CatalogPathLoader = (relPath) => {
  if (relPath === 'catalog.json') return Promise.resolve(fixtureText('catalog-with-discovery.json'));
  if (relPath === POINTER_PATH) return Promise.resolve(fixtureText('index-valid.json'));
  return Promise.reject(new Error(`unexpected path: ${relPath}`));
};

const opts = { localePreference: ['be', 'en'] };

// A catalog+index pair whose pointer's bytes and sha256 are computed from
// the served index text — the same pin publication applies (21 §3.3).
// `docs` serves additional origin paths (the route documents the preview
// assembly reads); every other path still serves the index text.
function serveIndexPair(
  routes: ReadonlyArray<Record<string, unknown>>,
  index: Record<string, unknown>,
  docs: Readonly<Record<string, string>> = {},
): CatalogPathLoader {
  const indexText = JSON.stringify(index);
  const indexBytes = new TextEncoder().encode(indexText);
  const catalogText = JSON.stringify({
    catalog_schema_version: 1,
    routes,
    discovery_index: {
      schema_version: 1,
      revision: 'rev',
      path: 'discovery/index.json',
      bytes: indexBytes.byteLength,
      sha256: createHash('sha256').update(indexBytes).digest('hex'),
    },
  });
  return (relPath) => {
    if (relPath === 'catalog.json') return Promise.resolve(catalogText);
    if (relPath in docs) return Promise.resolve(docs[relPath]);
    return Promise.resolve(indexText);
  };
}

function titles(guides: readonly CatalogGuideCard[]): string[] {
  return guides.map((card) => card.title);
}

describe('envelope parity with contracts/reader.mjs', () => {
  const cases: ReadonlyArray<[string, unknown]> = [
    ['catalog-with-discovery.json', JSON.parse(fixtureText('catalog-with-discovery.json'))],
    ['catalog-legacy.json', JSON.parse(fixtureText('catalog-legacy.json'))],
    ['catalog-legacy-v0.json', JSON.parse(fixtureText('catalog-legacy-v0.json'))],
    ['catalog-invalid-oversized.json', JSON.parse(fixtureText('catalog-invalid-oversized.json'))],
    ['unknown-major', { catalog_schema_version: 2, routes: [] }],
    ['not-an-object', 'nope'],
  ];

  for (const [name, doc] of cases) {
    it(`status routing matches the canon for ${name}`, () => {
      const canonical = readCatalogDoc(doc);
      const projected = readCatalogEnvelope(doc);
      assert.equal(projected.status, canonical.status, name);
      assert.equal(projected.routes.length, canonical.routes.length, name);
      // The oversized pointer: the canon rejects the document (ok: false),
      // the projection expresses the same verdict as an unusable pointer —
      // the fetch never happens.
      if (name === 'catalog-invalid-oversized.json') {
        assert.equal(canonical.ok, false, name);
        assert.equal(projected.discovery_index, null, name);
        return;
      }
      assert.equal(
        projected.discovery_index !== null,
        canonical.discovery_index !== null,
        name,
      );
      assert.equal(projected.degraded, canonical.degraded, name);
    });
  }

  it('legacy-v0 reads the bare routes array', () => {
    const projected = readCatalogEnvelope(JSON.parse(fixtureText('catalog-legacy-v0.json')));
    assert.equal(projected.status, 'legacy-v0');
    assert.ok(projected.routes.length > 0);
  });
});

describe('loadCatalog on the published fixtures', () => {
  it('merges the guide offer and the route-only entry in canonical order', async () => {
    const state = await loadCatalog({ loader: fixtureLoader, sha256 }, opts, null);
    assert.equal(state.kind, 'ready');
    assert.ok(state.kind === 'ready');
    assert.equal(state.degraded, null);
    assert.deepEqual(
      state.guides.map((card) => card.routeId),
      ['guide-route-a1', 'guide-route-b1'],
    );
    const [offerCard, routeCard] = state.guides;
    // The offer-backed card carries the editorial facts of 21 §3.2.
    assert.equal(offerCard.offerId, 'offer-b1-guide');
    assert.equal(offerCard.title, 'Гісторыі сукнараў: ад мытні да порта');
    assert.equal(offerCard.access, 'paid');
    assert.equal(offerCard.editorialOrder, 1);
    assert.deepEqual([...offerCard.textLocales], ['be', 'en', 'uk']);
    assert.deepEqual([...offerCard.audioLocales], ['be', 'en']);
    assert.ok(offerCard.localesKnown);
    assert.deepEqual(offerCard.estimatedDuration, {
      min_minutes: 45,
      max_minutes: 75,
      basis: 'author_estimate',
    });
    // The route without an offer stays honest: the identifier stands in, no
    // availability split is claimed.
    assert.equal(routeCard.offerId, null);
    assert.equal(routeCard.title, 'guide-route-b1');
    assert.equal(routeCard.access, 'free');
    assert.ok(!routeCard.localesKnown);
    assert.deepEqual([...routeCard.textLocales], ['be']);
  });

  it('orders offers by editorial_order then offer_id, route-only last by route_id', async () => {
    const index = {
      schema_version: 1,
      revision: 'rev',
      city_id: 'city-a',
      themes: [],
      offers: [
        {
          offer_id: 'offer-z',
          ref: { kind: 'guide', route_id: 'r-a', version: '1' },
          city_id: 'city-a',
          editorial_order: 5,
          themes: [],
          localized: { title: { be: 'Пяты' } },
          season_recommendations: [],
          availability: { text_locales: ['be'], audio_locales: [] },
          access: 'free',
        },
        {
          offer_id: 'offer-a',
          ref: { kind: 'guide', route_id: 'r-b', version: '1' },
          city_id: 'city-a',
          editorial_order: 5,
          themes: [],
          localized: { title: { be: 'Таксама пяты' } },
          season_recommendations: [],
          availability: { text_locales: ['be'], audio_locales: [] },
          access: 'free',
        },
        {
          offer_id: 'offer-early',
          ref: { kind: 'guide', route_id: 'r-c', version: '1' },
          city_id: 'city-a',
          editorial_order: 2,
          themes: [],
          localized: { title: { be: 'Ранні' } },
          season_recommendations: [],
          availability: { text_locales: ['be'], audio_locales: [] },
          access: 'paid',
        },
      ],
      collections: [],
    };
    const loader = serveIndexPair(
      [
        { route_id: 'r-c', version: '1', locales: ['be'], layers: ['base'] },
        { route_id: 'r-b', version: '1', locales: ['be'], layers: ['base'] },
        { route_id: 'r-a', version: '1', locales: ['be'], layers: ['base'] },
        { route_id: 'r-0', version: '1', locales: ['be'], layers: ['base'] },
      ],
      index,
    );
    const state = await loadCatalog({ loader, sha256 }, opts, null);
    assert.ok(state.kind === 'ready');
    // editorial_order 2 first; the 5-tie breaks by offer_id; the route with
    // no offer closes the list by route_id.
    assert.deepEqual(titles(state.guides), ['Ранні', 'Таксама пяты', 'Пяты', 'r-0']);
  });

  it('renders a route exactly once when a malformed publication pins two offers to it (issue #324)', async () => {
    const offer = (offer_id: string, editorial_order: number, title: string) => ({
      offer_id,
      ref: { kind: 'guide', route_id: 'r-1', version: '1' },
      city_id: 'city-a',
      editorial_order,
      themes: [],
      localized: { title: { be: title } },
      season_recommendations: [],
      availability: { text_locales: ['be'], audio_locales: [] },
      access: 'free',
    });
    // The higher-order duplicate comes first in the input: the winner must be
    // the canonically sorted one, not the first seen.
    const index = {
      schema_version: 1,
      revision: 'rev',
      city_id: 'city-a',
      themes: [],
      offers: [offer('offer-dup-late', 5, 'Дубль позні'), offer('offer-dup-early', 1, 'Дубль ранні')],
      collections: [],
    };
    const loader = serveIndexPair([{ route_id: 'r-1', version: '1', locales: ['be'], layers: ['base'] }], index);
    const state = await loadCatalog({ loader, sha256 }, opts, null);
    assert.ok(state.kind === 'ready');
    assert.deepEqual(state.guides.map((card) => card.offerId), ['offer-dup-early']);
    assert.equal(state.guides[0].title, 'Дубль ранні');
  });

  it('renders the empty city when nothing is published (NAV3 input)', async () => {
    const loader: CatalogPathLoader = () =>
      Promise.resolve(JSON.stringify({ catalog_schema_version: 1, routes: [] }));
    const state = await loadCatalog({ loader, sha256 }, opts, null);
    assert.deepEqual(state, { kind: 'ready', guides: [], degraded: null });
  });

  it('degrades to route cards when the index is unreachable, unsafe or tampered', async () => {
    const catalogText = fixtureText('catalog-with-discovery.json');
    const degradedLoader: CatalogPathLoader = (relPath) =>
      relPath === 'catalog.json' ? Promise.resolve(catalogText) : Promise.reject(new Error('down'));
    const unreachable = await loadCatalog({ loader: degradedLoader, sha256 }, opts, null);
    assert.ok(unreachable.kind === 'ready' && unreachable.degraded === 'index-unavailable');
    assert.deepEqual(
      unreachable.guides.map((card) => card.routeId),
      ['guide-route-a1', 'guide-route-b1'],
    );

    // A pointer path that leaves the origin is never fetched.
    const catalogDoc = JSON.parse(catalogText) as Record<string, unknown>;
    const unsafe = JSON.parse(catalogText) as { discovery_index: Record<string, unknown> };
    unsafe.discovery_index = { ...catalogDoc.discovery_index as Record<string, unknown>, path: '../secrets.json' };
    let fetched = 0;
    const countingLoader: CatalogPathLoader = (relPath) => {
      fetched += 1;
      return relPath === 'catalog.json' ? Promise.resolve(JSON.stringify(unsafe)) : Promise.resolve('{}');
    };
    const unsafeState = await loadCatalog({ loader: countingLoader, sha256 }, opts, null);
    assert.ok(unsafeState.kind === 'ready' && unsafeState.degraded === 'index-unavailable');
    assert.equal(fetched, 1);

    // A tampered index fails the pointer's sha256 pin and degrades.
    const tamperedLoader: CatalogPathLoader = (relPath) =>
      relPath === 'catalog.json'
        ? Promise.resolve(catalogText)
        : Promise.resolve(fixtureText('index-valid.json').replace('Гісторыі', 'Падмененыя'));
    const tampered = await loadCatalog({ loader: tamperedLoader, sha256 }, opts, null);
    assert.ok(tampered.kind === 'ready' && tampered.degraded === 'index-unavailable');
    assert.equal(tampered.guides.length, 2);

    // Corrupt index text and a parsed document without offers degrade the
    // same way (corrupt-input diagnostics, never a crash).
    for (const indexBody of ['{ not json', '{}']) {
      const corruptLoader: CatalogPathLoader = (relPath) =>
        relPath === 'catalog.json' ? Promise.resolve(catalogText) : Promise.resolve(indexBody);
      const corrupt = await loadCatalog({ loader: corruptLoader, sha256 }, opts, null);
      assert.ok(corrupt.kind === 'ready' && corrupt.degraded === 'index-unavailable', indexBody);
      assert.equal(corrupt.guides.length, 2, indexBody);
    }
  });

  it('drops offers whose route is not published, without crashing on corrupt offers', async () => {
    const index = {
      schema_version: 1,
      revision: 'rev',
      city_id: 'city-a',
      themes: [],
      offers: [
        null,
        { offer_id: 'offer-ghost', ref: { kind: 'guide', route_id: 'r-missing', version: '1' }, editorial_order: 1 },
        {
          offer_id: 'offer-bad-access',
          ref: { kind: 'guide', route_id: 'r-1', version: '1' },
          city_id: 'city-a',
          editorial_order: 2,
          themes: [],
          localized: { title: { be: 'Невядомы доступ' } },
          season_recommendations: [],
          availability: { text_locales: ['be'], audio_locales: [] },
          access: 'oops',
        },
        {
          offer_id: 'offer-real',
          ref: { kind: 'guide', route_id: 'r-1', version: '1' },
          city_id: 'city-a',
          editorial_order: 1,
          themes: [],
          localized: { title: { en: 'Only English' } },
          season_recommendations: [],
          availability: { text_locales: ['en'], audio_locales: [] },
          access: 'free',
        },
      ],
      collections: [],
    };
    const loader = serveIndexPair([{ route_id: 'r-1', version: '1', locales: ['be'], layers: ['base'] }], index);
    const state = await loadCatalog({ loader, sha256 }, opts, null);
    assert.ok(state.kind === 'ready');
    assert.equal(state.guides.length, 1);
    // The display label falls back through the preference to any published
    // one; the availability list stays the honest language statement.
    assert.equal(state.guides[0].title, 'Only English');
    assert.deepEqual([...state.guides[0].textLocales], ['en']);
  });

  it('answers corrupt catalog text with a named state, not a throw', async () => {
    const loader: CatalogPathLoader = () => Promise.resolve('{ not json');
    const fresh = await loadCatalog({ loader, sha256 }, opts, null);
    assert.deepEqual(fresh, { kind: 'error', reason: 'catalog-json-corrupt' });
    const cached = await loadCatalog({ loader, sha256 }, opts, [
      {
        routeId: 'r-1',
        version: '1',
        offerId: null,
        title: 'r-1',
        summary: null,
        textLocales: ['be'],
        audioLocales: [],
        localesKnown: false,
        access: 'free',
        editorialOrder: null,
        estimatedDuration: null,
      },
    ]);
    assert.equal(cached.kind, 'offline');
    assert.ok(cached.kind === 'offline' && cached.guides.length === 1);
  });

  it('loader failure is fatal only with no previous result (09 §4)', async () => {
    const loader: CatalogPathLoader = () => Promise.reject(new Error('network down'));
    const fresh = await loadCatalog({ loader, sha256 }, opts, null);
    assert.deepEqual(fresh, { kind: 'error', reason: 'network down' });
    const cached = await loadCatalog({ loader, sha256 }, opts, []);
    // An empty cache carries nothing to show: the error state renders the
    // normal city page without discovery (21 §3.3).
    assert.equal(cached.kind, 'error');
  });
});

describe('origin catalog loader', () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/catalog.json') {
      response.end(JSON.stringify({ catalog_schema_version: 1, routes: [] }));
      return;
    }
    response.statusCode = 404;
    response.end('no');
  });
  after(() => void server.close());
  const url = new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`));
  });

  it('fetches published paths against the configured origin', async () => {
    const loader = createOriginCatalogLoader(await url);
    const text = await loader('catalog.json');
    assert.deepEqual(JSON.parse(text), { catalog_schema_version: 1, routes: [] });
    await assert.rejects(loader('missing.json'), /catalog-loader-404/);
  });
});

// The route documents of the two published fixture guides (the build-bundle
// public layout: bundle/<route_id>/<version>/route.json); `withDocs: false`
// serves a catalog whose guides have no route document on the origin.
function previewLoader(withDocs: boolean, extra: Record<string, string> = {}): CatalogPathLoader {
  const map: Record<string, string> = {
    'catalog.json': fixtureText('catalog-with-discovery.json'),
    [POINTER_PATH]: fixtureText('index-valid.json'),
    ...(withDocs
      ? {
          'bundle/guide-route-a1/1/route.json': fixtureText('route-guide-route-a1.json'),
          'bundle/guide-route-b1/3/route.json': fixtureText('route-guide-route-b1.json'),
        }
      : {}),
    ...extra,
  };
  return (relPath) =>
    relPath in map ? Promise.resolve(map[relPath]) : Promise.reject(new Error(`unexpected path: ${relPath}`));
}

describe('loadPreview — the guide preview assembly (G06.01.b)', () => {
  it('assembles the offer-backed paid preview from the published pair and the route document', async () => {
    const state = await loadPreview({ loader: previewLoader(true), sha256 }, opts, 'guide-route-a1', null);
    assert.equal(state.kind, 'ready');
    assert.ok(state.kind === 'ready');
    const preview = state.preview;
    assert.equal(preview.title, 'Гісторыі сукнараў: ад мытні да порта');
    assert.equal(preview.access, 'paid');
    assert.equal(preview.routeAccess, 'paid');
    assert.equal(preview.durationMin, 45);
    assert.equal(preview.freeStopCount, 1);
    assert.equal(preview.baseSizeBytes, 52428800);
    assert.equal(preview.textLocales.join(','), 'be,en,uk');
    assert.ok(preview.stops);
    assert.equal(preview.stops.length, 2);
    assert.equal(preview.stops[0]?.name, 'Мытня');
    assert.ok(preview.stops[0]?.announce);
    assert.ok(state.degraded === null);
  });

  it('a paid route locks every stop; a free_base route locks only its extended stop (NAV5)', async () => {
    const paid = await loadPreview({ loader: previewLoader(true), sha256 }, opts, 'guide-route-a1', null);
    assert.ok(paid.kind === 'ready' && paid.preview.stops);
    assert.ok(paid.preview.stops.every((stop) => stop.locked), 'paid route: every stop locked');

    const free = await loadPreview({ loader: previewLoader(true), sha256 }, opts, 'guide-route-b1', null);
    assert.ok(free.kind === 'ready' && free.preview.stops);
    const [open, locked] = free.preview.stops;
    assert.equal(open?.locked, false);
    assert.equal(locked?.locked, true);
    assert.equal(open?.tier, 'base');
    assert.equal(locked?.tier, 'extended');
  });

  it('joins the stop rows with the index place titles; unknown and untitled places hide the line (UX 05, issue #351)', async () => {
    // The dedup of 21 §4 rule 6 applies inside the title map too: of two
    // offers pinned to one place, the sorted-first title wins.
    const index = {
      offers: [
        {
          offer_id: 'offer-place-known',
          ref: { kind: 'place', place_id: 'place-known', content_version: '1' },
          editorial_order: 1,
          localized: { title: { be: 'Вядомы двор', en: 'Known Courtyard' } },
          availability: { text_locales: ['be'], audio_locales: [] },
          access: 'free',
        },
        {
          offer_id: 'offer-place-untitled',
          ref: { kind: 'place', place_id: 'place-untitled', content_version: '1' },
          editorial_order: 2,
          localized: {},
          availability: {},
          access: 'free',
        },
        {
          offer_id: 'offer-place-dup-late',
          ref: { kind: 'place', place_id: 'place-dup', content_version: '1' },
          editorial_order: 5,
          localized: { title: { be: 'Дубль' } },
          availability: {},
          access: 'free',
        },
        {
          offer_id: 'offer-place-dup-early',
          ref: { kind: 'place', place_id: 'place-dup', content_version: '1' },
          editorial_order: 4,
          localized: { title: { be: 'Пераможца' } },
          availability: {},
          access: 'free',
        },
      ],
    };
    const routeDoc = JSON.stringify({
      route_id: 'guide-route-b1',
      version: '3',
      city_id: 'gdansk',
      access: 'free_base',
      distance_m: 100,
      duration_min: 30,
      free_stop_count: 3,
      published: true,
      stops: [
        { id: 'stop-known', position: 0, place_id: 'place-known', access_tier: 'base', story_base_id: 's1' },
        { id: 'stop-unknown', position: 1, place_id: 'place-unknown', access_tier: 'base', story_base_id: 's2' },
        { id: 'stop-untitled', position: 2, place_id: 'place-untitled', access_tier: 'base', story_base_id: 's3' },
        { id: 'stop-dup', position: 3, place_id: 'place-dup', access_tier: 'base', story_base_id: 's4' },
      ],
    });
    const loader = serveIndexPair(
      [{ route_id: 'guide-route-b1', version: '3', locales: ['be'], layers: ['base'] }],
      index,
      { 'bundle/guide-route-b1/3/route.json': routeDoc },
    );
    const state = await loadPreview({ loader, sha256 }, opts, 'guide-route-b1', null);
    assert.ok(state.kind === 'ready' && state.preview.stops);
    const [known, unknown, untitled, dup] = state.preview.stops;
    assert.equal(known?.placeName, 'Вядомы двор');
    // No offer, or an offer without a title — the place line hides, the raw
    // place_id never reaches the view (nothing invented).
    assert.equal(unknown?.placeName, null);
    assert.equal(untitled?.placeName, null);
    assert.equal(dup?.placeName, 'Пераможца');
  });

  it('renders the route-only guide honestly from the entry facts', async () => {
    const state = await loadPreview({ loader: previewLoader(true), sha256 }, opts, 'guide-route-b1', null);
    assert.ok(state.kind === 'ready');
    const preview = state.preview;
    assert.equal(preview.title, 'guide-route-b1');
    assert.equal(preview.access, 'free');
    assert.equal(preview.localesKnown, false);
    assert.equal(preview.durationMin, 35);
    assert.equal(preview.estimatedDuration, null);
  });

  it('a missing route document degrades with the named reason, stops are null — nothing invented', async () => {
    const state = await loadPreview({ loader: previewLoader(false), sha256 }, opts, 'guide-route-b1', null);
    assert.ok(state.kind === 'ready');
    assert.equal(state.preview.stops, null);
    assert.equal(state.preview.degradedRouteDoc, 'route-doc-unavailable');
    assert.equal(state.degraded, 'route-doc-unavailable');
    assert.equal(state.preview.durationMin, null);
  });

  it('a foreign or corrupt route document fails closed to the corrupt state', async () => {
    const foreign = JSON.stringify({ route_id: 'other-route', version: '1', stops: [] });
    const state = await loadPreview(
      { loader: previewLoader(true, { 'bundle/guide-route-b1/3/route.json': foreign }), sha256 },
      opts,
      'guide-route-b1',
      null,
    );
    assert.ok(state.kind === 'ready');
    assert.equal(state.preview.stops, null);
    assert.equal(state.preview.degradedRouteDoc, 'route-doc-corrupt');
  });

  it('per-row identity faults drop the row and keep the valid ones, without a degradation note', async () => {
    const partial = JSON.stringify({
      route_id: 'guide-route-b1',
      version: '3',
      city_id: 'gdansk',
      access: 'free_base',
      distance_m: 1800,
      duration_min: 35,
      free_stop_count: 1,
      published: true,
      stops: [
        {
          id: 'stop-good',
          position: 0,
          place_id: 'place-good',
          access_tier: 'base',
          story_base_id: 'story-good',
          preview: { name: { be: 'Захаваная кропка' }, announce: { be: 'Анонс' } },
        },
        { id: 'stop-no-place', position: 1, access_tier: 'base', story_base_id: 'story-x' },
        { id: 'stop-bad-tier', position: 2, place_id: 'place-x', access_tier: 'premium' },
        { position: 3, place_id: 'place-x', access_tier: 'base' },
      ],
    });
    const state = await loadPreview(
      { loader: previewLoader(true, { 'bundle/guide-route-b1/3/route.json': partial }), sha256 },
      opts,
      'guide-route-b1',
      null,
    );
    assert.ok(state.kind === 'ready');
    assert.ok(state.preview.stops);
    assert.deepEqual(state.preview.stops.map((stop) => stop.stopId), ['stop-good']);
    assert.equal(state.preview.degradedRouteDoc, null);
  });

  it('a stops array whose every row is malformed is corruption, not an honest zero', async () => {
    const allBad = JSON.stringify({
      route_id: 'guide-route-b1',
      version: '3',
      city_id: 'gdansk',
      access: 'free_base',
      distance_m: 1800,
      duration_min: 35,
      free_stop_count: 0,
      published: true,
      stops: [
        { id: 'stop-a', position: 0 },
        { position: 1, place_id: 'place-x', access_tier: 'base' },
        { id: 'stop-c', position: 2, place_id: 'place-x', access_tier: 'nope' },
      ],
    });
    const state = await loadPreview(
      { loader: previewLoader(true, { 'bundle/guide-route-b1/3/route.json': allBad }), sha256 },
      opts,
      'guide-route-b1',
      null,
    );
    assert.ok(state.kind === 'ready');
    assert.equal(state.preview.stops, null);
    assert.equal(state.preview.degradedRouteDoc, 'route-doc-corrupt');
    assert.equal(state.degraded, 'route-doc-corrupt');
  });

  it('a published empty stops array is the honest zero, not a fault', async () => {
    const empty = JSON.stringify({
      route_id: 'guide-route-b1',
      version: '3',
      city_id: 'gdansk',
      access: 'free_base',
      distance_m: 1800,
      duration_min: 35,
      free_stop_count: 0,
      published: true,
      stops: [],
    });
    const state = await loadPreview(
      { loader: previewLoader(true, { 'bundle/guide-route-b1/3/route.json': empty }), sha256 },
      opts,
      'guide-route-b1',
      null,
    );
    assert.ok(state.kind === 'ready');
    assert.deepEqual(state.preview.stops, []);
    assert.equal(state.preview.degradedRouteDoc, null);
  });

  it('an unsafe route_id never composes a fetch path (21 §3.3)', async () => {
    const unsafeCatalog = JSON.stringify({
      catalog_schema_version: 1,
      routes: [{ route_id: '../evil', version: '1', locales: ['be'], layers: ['base'] }],
    });
    const loader: CatalogPathLoader = (relPath) => {
      if (relPath === 'catalog.json') return Promise.resolve(unsafeCatalog);
      return Promise.reject(new Error(`unexpected path: ${relPath}`));
    };
    const state = await loadPreview({ loader, sha256 }, opts, '../evil', null);
    assert.ok(state.kind === 'ready');
    assert.equal(state.preview.degradedRouteDoc, 'route-doc-unavailable');
    assert.equal(state.preview.stops, null);
  });

  it('a route the catalog does not name is not-published, never a fabricated preview', async () => {
    const state = await loadPreview({ loader: previewLoader(true), sha256 }, opts, 'no-such-route', null);
    assert.deepEqual(state, { kind: 'not-published' });
  });

  it('duplicate offers on one route: the preview shows the same sorted-first offer the list dedups to (#324)', async () => {
    const offer = (id: string, order: number, title: string) => ({
      offer_id: id,
      editorial_order: order,
      ref: { kind: 'guide', route_id: 'guide-route-a1' },
      localized: { title: { be: title } },
      availability: { text_locales: ['be'], audio_locales: [] },
      access: 'paid',
    });
    // The index deliberately lists the order-2 duplicate first: the pick
    // must follow the canon order, not the array order.
    const loader = serveIndexPair(
      [{ route_id: 'guide-route-a1', version: '1', locales: ['be'], layers: ['base'] }],
      { offers: [offer('dup-2', 2, 'Дублікат'), offer('dup-1', 1, 'Пераможца')] },
    );
    const state = await loadPreview({ loader, sha256 }, opts, 'guide-route-a1', null);
    assert.ok(state.kind === 'ready');
    assert.equal(state.preview.title, 'Пераможца');
  });

  it('an envelope failure keeps the previous preview (09 §4) or names the error', async () => {
    const previous = {
      routeId: 'guide-route-b1',
      version: '3',
      title: 'guide-route-b1',
      summary: null,
      textLocales: ['be'],
      audioLocales: [],
      localesKnown: false,
      access: 'free' as const,
      routeAccess: 'free_base' as const,
      productId: null,
      estimatedDuration: null,
      durationMin: 35,
      freeStopCount: null,
      baseSizeBytes: null,
      stops: null,
      degradedRouteDoc: null,
    };
    const failing: CatalogPathLoader = () => Promise.reject(new Error('network gone'));
    const cached = await loadPreview({ loader: failing, sha256 }, opts, 'guide-route-b1', previous);
    assert.ok(cached.kind === 'ready' && cached.degraded === 'network gone');
    const bare = await loadPreview({ loader: failing, sha256 }, opts, 'guide-route-b1', null);
    assert.deepEqual(bare, { kind: 'error', reason: 'network gone' });
  });
});

// G07.01 (issue #281) — the Nearby projection of the same validated index:
// guide and place offers, the collection kind left to G07.02, the authored
// distance passed through only when the contract range publishes it.
describe('loadNearby — the Nearby offer projection (G07.01)', () => {
  // The full offer shape the projection reads — one builder for the negative
  // suites (a sibling literal pair is a jscpd clone).
  const nearbyOffer = (
    offer_id: string,
    ref: Record<string, unknown>,
    editorial_order: number,
    title: string,
  ): Record<string, unknown> => ({
    offer_id,
    ref,
    city_id: 'city-a',
    editorial_order,
    themes: [],
    localized: { title: { be: title } },
    season_recommendations: [],
    availability: { text_locales: ['be'], audio_locales: [] },
    access: 'free',
  });
  const previous: readonly NearbyOfferFacts[] = [
    {
      offer_id: 'offer-kept',
      kind: 'place',
      route_id: null,
      place_id: 'place-kept',
      editorial_order: 9,
      title: 'Кэш',
      summary: null,
      distance_m: null,
      text_locales: ['be'],
      audio_locales: [],
      access: 'free',
      estimated_duration: null,
    },
  ];

  it('projects guide and place offers, drops the collection kind (G07.02)', async () => {
    const state = await loadNearby({ loader: fixtureLoader, sha256 }, opts, null);
    assert.equal(state.kind, 'ready');
    assert.ok(state.kind === 'ready');
    assert.equal(state.degraded, null);
    // The canon order (21 §4 rule 6: editorial_order, offer_id tiebreak).
    assert.deepEqual(
      state.offers.map((offer) => offer.offer_id),
      [
        'offer-b1-guide',
        'offer-a1-place',
        'offer-c1-place',
        'offer-e1-place',
        'offer-g1-place',
        'offer-h1-place',
      ],
    );
    const [guide, place] = state.offers;
    assert.equal(guide.kind, 'guide');
    assert.equal(guide.route_id, 'guide-route-a1');
    assert.equal(guide.place_id, null);
    assert.equal(guide.distance_m, 3200);
    assert.equal(place.kind, 'place');
    assert.equal(place.route_id, null);
    assert.equal(place.place_id, 'place-a1');
    assert.equal(place.distance_m, 800);
    // An offer without a Belarusian label falls back to any published one —
    // the availability line stays the honest language statement.
    const english = state.offers.find((offer) => offer.offer_id === 'offer-e1-place');
    assert.equal(english?.title, 'Brick Arches Photo Stop');
  });

  it('a duplicated ref renders once: the sorted-first offer wins (issue #324 canon)', async () => {
    // The index deliberately lists the order-2 duplicate first: the pick
    // must follow the canon order, not the array order.
    const loader = serveIndexPair([], {
      offers: [
        nearbyOffer('offer-dup-2', { kind: 'guide', route_id: 'r-dup', version: '1' }, 2, 'Дублікат'),
        nearbyOffer('offer-dup-1', { kind: 'guide', route_id: 'r-dup', version: '1' }, 1, 'Пераможца'),
        nearbyOffer('offer-place-twin-b', { kind: 'place', place_id: 'place-twin', content_version: '1' }, 4, 'Двойчы'),
        nearbyOffer('offer-place-twin-a', { kind: 'place', place_id: 'place-twin', content_version: '1' }, 3, 'Адзінае месца'),
      ],
    });
    const state = await loadNearby({ loader, sha256 }, opts, null);
    assert.ok(state.kind === 'ready');
    assert.deepEqual(
      state.offers.map((offer) => offer.offer_id),
      ['offer-dup-1', 'offer-place-twin-a'],
    );
  });

  it('a corrupt ref drops whole: a guide without route_id, a place without place_id', async () => {
    const loader = serveIndexPair([], {
      offers: [
        nearbyOffer('offer-guide-no-route', { kind: 'guide', version: '1' }, 1, 'Без маршруту'),
        nearbyOffer('offer-place-no-place', { kind: 'place', content_version: '1' }, 2, 'Без месца'),
        nearbyOffer('offer-kept', { kind: 'place', place_id: 'place-kept', content_version: '1' }, 3, 'Застаецца'),
      ],
    });
    const state = await loadNearby({ loader, sha256 }, opts, null);
    assert.ok(state.kind === 'ready');
    assert.deepEqual(
      state.offers.map((offer) => offer.offer_id),
      ['offer-kept'],
    );
  });

  it('honors the locale preference for the localized labels', async () => {
    const state = await loadNearby(
      { loader: fixtureLoader, sha256 },
      { localePreference: ['en', 'be'] },
      null,
    );
    assert.ok(state.kind === 'ready');
    const guide = state.offers.find((offer) => offer.offer_id === 'offer-b1-guide');
    assert.equal(guide?.title, "Cloth Merchants' Stories: from the Customs House to the Port");
  });

  it('a distance outside the published contract range is not published, not invented', async () => {
    const placeOffer = (distance: unknown): Record<string, unknown> => ({
      offer_id: 'offer-place-x',
      ref: { kind: 'place', place_id: 'place-x', content_version: '1' },
      city_id: 'city-a',
      editorial_order: 1,
      themes: [],
      localized: { title: { be: 'Месца' } },
      season_recommendations: [],
      availability: { text_locales: ['be'], audio_locales: [] },
      access: 'free',
      ...(distance === undefined ? {} : { distance_m: distance }),
    });
    const over = await loadNearby(
      { loader: serveIndexPair([], { offers: [placeOffer(100_001)] }), sha256 },
      opts,
      null,
    );
    assert.ok(over.kind === 'ready' && over.offers[0]?.distance_m === null);
    const negative = await loadNearby(
      { loader: serveIndexPair([], { offers: [placeOffer(-5)] }), sha256 },
      opts,
      null,
    );
    assert.ok(negative.kind === 'ready' && negative.offers[0]?.distance_m === null);
    const absent = await loadNearby(
      { loader: serveIndexPair([], { offers: [placeOffer(undefined)] }), sha256 },
      opts,
      null,
    );
    assert.ok(absent.kind === 'ready' && absent.offers[0]?.distance_m === null);
  });

  it('a catalog without the discovery pointer is a ready empty list, not an error', async () => {
    const loader: CatalogPathLoader = (relPath) =>
      relPath === 'catalog.json'
        ? Promise.resolve(JSON.stringify({ catalog_schema_version: 1, routes: [] }))
        : Promise.reject(new Error(`unexpected path: ${relPath}`));
    const state = await loadNearby({ loader, sha256 }, opts, null);
    assert.deepEqual(state, { kind: 'ready', offers: [], degraded: null });
  });

  it('a declared index that fails its pins degrades — the state is named, offers stay empty', async () => {
    const loader: CatalogPathLoader = (relPath) =>
      relPath === 'catalog.json'
        ? Promise.resolve(fixtureText('catalog-with-discovery.json'))
        : Promise.reject(new Error('index-loader-404'));
    const state = await loadNearby({ loader, sha256 }, opts, null);
    assert.deepEqual(state, { kind: 'ready', offers: [], degraded: 'index-unavailable' });
  });

  it('an envelope failure keeps the previous list (09 §4) or names the error', async () => {
    const failing: CatalogPathLoader = () => Promise.reject(new Error('network gone'));
    const cached = await loadNearby({ loader: failing, sha256 }, opts, previous);
    assert.deepEqual(cached, { kind: 'offline', offers: previous, reason: 'network gone' });
    const bare = await loadNearby({ loader: failing, sha256 }, opts, null);
    assert.deepEqual(bare, { kind: 'error', reason: 'network gone' });
  });
});
