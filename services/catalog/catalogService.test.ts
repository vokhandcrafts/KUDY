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
import { loadCatalog } from './catalogService.ts';
import { readCatalogEnvelope } from './envelope.ts';
import { createOriginCatalogLoader } from './loader.ts';
import type { CatalogGuideCard, CatalogPathLoader, Sha256 } from './types.ts';

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
function serveIndexPair(
  routes: ReadonlyArray<Record<string, unknown>>,
  index: Record<string, unknown>,
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
  return (relPath) =>
    relPath === 'catalog.json' ? Promise.resolve(catalogText) : Promise.resolve(indexText);
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
