// G20.32 (#794): production createServices -> catalog/preview controllers ->
// catalog service -> persistent zone-A SQLite. Network is the only fake.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createServices } from '../createServices.ts';
import type { UiLocalePersistence, UiLocaleSwitchCode } from '../uiLocaleStore.ts';
import { checkpointProgress, getSession, openDatabase, rebuildDerived, startSession } from '../../services/db/db.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from '../../services/db/test-fixture.ts';
import type { SqlDriver } from '../../services/db/types.ts';
import type { BundlesStore } from '../../services/contentRepo/types.ts';
import { catalogSnapshotOver } from '../../services/catalog/snapshot.ts';
import type { CatalogPathLoader } from '../../services/catalog/types.ts';

const fixtures = path.resolve(import.meta.dirname, '../../fixtures/discovery-contract');
const paths: Readonly<Record<string, string>> = {
  'catalog.json': 'catalog-with-discovery.json',
  'discovery/city-a/r-2026-09-14-1/index.json': 'index-valid.json',
  'bundle/guide-route-b1/3/route.json': 'route-guide-route-b1.json',
  'bundle/guide-route-a1/1/route.json': 'route-guide-route-a1.json',
};
const loadPublished: CatalogPathLoader = async (relative) => {
  const file = paths[relative];
  if (!file) throw new Error('not published');
  return readFileSync(path.join(fixtures, file), 'utf8');
};
const noNetwork: CatalogPathLoader = async () => { throw new Error('network-offline'); };
const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Installed-layer metadata is supplied by the same BundlesStore port that
// production's readLayerFacts reader probes. The test does not mock the
// inventory reader or the preview-button derivation.
const lock = new TextEncoder().encode(JSON.stringify([
  { path: 'stops.json', bytes: 3, sha256: 'a'.repeat(64) },
]));
const installed: BundlesStore = {
  listDir: async (relative) => relative === 'bundles/guide-route-b1' ? ['3'] : [],
  readFile: async (relative) => relative === 'bundles/guide-route-b1/3/be/base/lock.json'
    ? { kind: 'present', bytes: lock }
    : { kind: 'absent' },
  statSize: async (relative) => relative === 'bundles/guide-route-b1/3/be/base/stops.json' ? 3 : null,
};
function root(driver: SqlDriver, loader: CatalogPathLoader, downloaded = false, uiLocalePersistence?: UiLocalePersistence) {
  return createServices({
    catalogLoader: loader,
    catalogSha256: sha256,
    catalogSnapshot: catalogSnapshotOver(driver),
    ...(uiLocalePersistence ? { uiLocalePersistence } : {}),
    ...(downloaded ? {
      bundlesStore: installed,
      evaluateLayer: async (input: { routeId: string; version: string; locale: string; tier: 'base' | 'extended' }) => ({
        status: 'ready' as const,
        routeId: input.routeId,
        version: input.version,
        tier: input.tier,
        tierAvailable: ['base' as const],
      }),
    } : {}),
  });
}
async function list(services: ReturnType<typeof root>) {
  const store = services.catalog?.controller;
  assert.ok(store, 'production catalog controller is composed');
  await store.getState().refresh();
  return store.getState().surface;
}
async function detail(services: ReturnType<typeof root>, routeId = 'guide-route-b1') {
  const store = services.preview?.create(routeId);
  assert.ok(store, 'production preview controller is composed');
  await store.getState().refresh();
  return store.getState();
}
function cacheRows(driver: SqlDriver): Array<{ route_id: string; payload: string }> {
  const rows = driver.prepare('SELECT route_id, payload FROM catalog_cache ORDER BY route_id').all();
  return rows.map((row) => ({ route_id: String(row.route_id), payload: String(row.payload) }));
}
function corruptRows(driver: SqlDriver): void {
  driver.prepare("UPDATE catalog_cache SET payload = '{\"bad\":true}'").run();
}

describe('G20.32 catalog snapshot across production controllers', () => {
  it('persists to file-backed SQLite, reloads fresh offline controllers, and preserves public free preview', async () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'kudy-catalog-794-'));
    const file = path.join(temp, 'catalog.sqlite');
    let sqlite = nodeSqliteFileDriver(file);
    try {
      openDatabase(sqlite.driver);
      const online = root(sqlite.driver, loadPublished, true);
      const initial = await list(online);
      assert.equal(initial.kind, 'ready');
      assert.ok(initial.kind === 'ready');
      assert.equal(initial.guides[0]?.title, 'Гісторыі сукнараў: ад мытні да порта');
      const opened = await detail(online);
      assert.equal(opened.surface.kind, 'ready');
      assert.ok(opened.surface.kind === 'ready');
      assert.equal(opened.surface.preview.routeAccess, 'free_base');
      assert.equal(opened.surface.preview.stops?.[0]?.name, 'Стары порт');
      assert.equal(opened.surface.preview.stops?.[1]?.locked, true);
      assert.equal(opened.button.action, 'start');
      assert.equal(opened.button.enabled, true, 'Start still derives from verified installed-layer facts');

      const before = cacheRows(sqlite.driver);
      assert.equal(before.length, 4, 'locale-specific and latest-verified copies of the list and free preview');
      assert.ok(before.every((row) => !row.payload.includes('https://') && !row.payload.includes('story_base_id')));
      online.dispose();
      sqlite.close();

      sqlite = nodeSqliteFileDriver(file);
      openDatabase(sqlite.driver);
      const offline = root(sqlite.driver, noNetwork, true);
      const fromDisk = await list(offline);
      assert.equal(fromDisk.kind, 'offline', 'offline banner survives an actual reopened SQLite database');
      assert.ok(fromDisk.kind === 'offline');
      assert.deepEqual(fromDisk.guides, initial.guides);
      const reopened = await detail(offline);
      assert.equal(reopened.surface.kind, 'ready');
      assert.ok(reopened.surface.kind === 'ready');
      assert.equal(reopened.surface.degraded, 'network-offline');
      assert.deepEqual(reopened.surface.preview, opened.surface.preview);
      assert.deepEqual(reopened.button, opened.button, 'Start readiness still comes from disk inventory');
      offline.dispose();
    } finally {
      sqlite.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('restores the last verified catalog and free preview after a UI-language switch while offline and a fresh restart', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    let selected: UiLocaleSwitchCode = 'be';
    const uiLocalePersistence: UiLocalePersistence = {
      read: () => selected,
      write: (locale) => { selected = locale; },
    };

    const online = root(driver, loadPublished, false, uiLocalePersistence);
    const firstList = await list(online);
    assert.equal(firstList.kind, 'ready');
    assert.ok(firstList.kind === 'ready');
    const firstPreview = await detail(online);
    assert.equal(firstPreview.surface.kind, 'ready');
    assert.ok(firstPreview.surface.kind === 'ready');
    assert.equal(firstPreview.surface.preview.stops?.[0]?.name, 'Стары порт');
    const persisted = cacheRows(driver);
    assert.equal(persisted.length, 4);
    assert.ok(persisted.some((row) => row.route_id === JSON.stringify(['guides:v1', '', []])));
    assert.ok(persisted.some((row) => row.route_id === JSON.stringify(['preview:v1', 'guide-route-b1', []])));
    online.dispose();

    // A real UI switch changes the production service's localePreference
    // without a network refresh. The offline banner stays visible; the
    // cached Belarusian labels are the last verified projection, not a
    // fabricated English translation.
    const switched = root(driver, noNetwork, false, uiLocalePersistence);
    switched.uiLocale.set('en');
    assert.equal(selected, 'en');
    const switchedList = await list(switched);
    assert.equal(switchedList.kind, 'offline');
    assert.ok(switchedList.kind === 'offline');
    assert.deepEqual(switchedList.guides, firstList.guides);
    const switchedPreview = await detail(switched);
    assert.equal(switchedPreview.surface.kind, 'ready');
    assert.ok(switchedPreview.surface.kind === 'ready');
    assert.equal(switchedPreview.surface.degraded, 'network-offline');
    assert.deepEqual(switchedPreview.surface.preview, firstPreview.surface.preview);
    switched.dispose();

    // The new composition root reads the persisted UI locale and the same
    // zone-A database; it cannot depend on any in-memory previous result.
    const restarted = root(driver, noNetwork, false, uiLocalePersistence);
    assert.equal(restarted.uiLocale.current(), 'en');
    const restartedList = await list(restarted);
    assert.equal(restartedList.kind, 'offline');
    assert.ok(restartedList.kind === 'offline');
    assert.deepEqual(restartedList.guides, firstList.guides);
    const restartedPreview = await detail(restarted);
    assert.equal(restartedPreview.surface.kind, 'ready');
    assert.ok(restartedPreview.surface.kind === 'ready');
    assert.equal(restartedPreview.surface.degraded, 'network-offline');
    assert.deepEqual(restartedPreview.surface.preview, firstPreview.surface.preview);
    assert.deepEqual(cacheRows(driver), persisted, 'offline locale switches must not rewrite verified snapshots');
    restarted.dispose();

    // A later successful online refresh in English publishes v4. Switching
    // back to Belarusian while offline must not resurrect its older v3
    // locale-specific snapshot in preference to the verified v4 publication.
    const upgradedOrigin: CatalogPathLoader = async (relative) => {
      if (relative === 'catalog.json') {
        const catalog: { routes: Array<{ route_id: string; version: string }> } =
          JSON.parse(await loadPublished(relative));
        const route = catalog.routes.find((entry) => entry.route_id === 'guide-route-b1');
        assert.ok(route);
        route.version = '4';
        return JSON.stringify(catalog);
      }
      if (relative === 'bundle/guide-route-b1/4/route.json') {
        const doc: { version: string } = JSON.parse(await loadPublished('bundle/guide-route-b1/3/route.json'));
        doc.version = '4';
        return JSON.stringify(doc);
      }
      return loadPublished(relative);
    };
    const updatedOnline = root(driver, upgradedOrigin, false, uiLocalePersistence);
    assert.equal(updatedOnline.uiLocale.current(), 'en');
    const newerList = await list(updatedOnline);
    assert.equal(newerList.kind, 'ready');
    assert.ok(newerList.kind === 'ready');
    assert.equal(newerList.guides.find((guide) => guide.routeId === 'guide-route-b1')?.version, '4');
    const newerPreview = await detail(updatedOnline);
    assert.equal(newerPreview.surface.kind, 'ready');
    assert.ok(newerPreview.surface.kind === 'ready');
    assert.equal(newerPreview.surface.preview.version, '4');
    updatedOnline.dispose();

    const backOffline = root(driver, noNetwork, false, uiLocalePersistence);
    backOffline.uiLocale.set('be');
    assert.equal(selected, 'be');
    const latestList = await list(backOffline);
    assert.equal(latestList.kind, 'offline');
    assert.ok(latestList.kind === 'offline');
    assert.equal(latestList.guides.find((guide) => guide.routeId === 'guide-route-b1')?.version, '4',
      'old be catalog v3 must not downgrade the newer verified en catalog v4');
    const latestPreview = await detail(backOffline);
    assert.equal(latestPreview.surface.kind, 'ready');
    assert.ok(latestPreview.surface.kind === 'ready');
    assert.equal(latestPreview.surface.preview.version, '4',
      'old be preview v3 must not downgrade the newer verified en preview v4');
    assert.equal(latestPreview.surface.degraded, 'network-offline');
    backOffline.dispose();

    const backRestart = root(driver, noNetwork, false, uiLocalePersistence);
    assert.equal(backRestart.uiLocale.current(), 'be');
    const backPreview = await detail(backRestart);
    assert.equal(backPreview.surface.kind, 'ready');
    assert.ok(backPreview.surface.kind === 'ready');
    assert.equal(backPreview.surface.preview.version, '4');
    backRestart.dispose();
  });

  it('never persists paid previews or free previews with missing stop facts (review negative guard)', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    const online = root(driver, loadPublished);
    assert.equal((await list(online)).kind, 'ready');
    const listOnly = cacheRows(driver);
    assert.equal(listOnly.length, 2, 'one validated list projection plus cross-locale fallback');

    const paid = await detail(online, 'guide-route-a1');
    assert.equal(paid.surface.kind, 'ready');
    assert.ok(paid.surface.kind === 'ready');
    assert.equal(paid.surface.preview.routeAccess, 'paid', 'the published paid fixture reaches production');
    assert.ok(paid.surface.preview.stops?.length, 'paid route has public preview rows');
    assert.deepEqual(cacheRows(driver), listOnly, 'paid preview is not a durable snapshot');
    online.dispose();

    const noStops: CatalogPathLoader = async (relative) => {
      if (relative !== 'bundle/guide-route-b1/3/route.json') return loadPublished(relative);
      const doc: Record<string, unknown> = JSON.parse(await loadPublished(relative));
      delete doc.stops;
      return JSON.stringify(doc);
    };
    const incomplete = root(driver, noStops);
    const freeWithoutStops = await detail(incomplete);
    assert.equal(freeWithoutStops.surface.kind, 'ready');
    assert.ok(freeWithoutStops.surface.kind === 'ready');
    assert.equal(freeWithoutStops.surface.preview.routeAccess, 'free_base');
    assert.equal(freeWithoutStops.surface.preview.stops, null);
    assert.deepEqual(cacheRows(driver), listOnly, 'missing stop facts cannot overwrite the cache');
    incomplete.dispose();

    const verified = root(driver, loadPublished);
    const freeWithStops = await detail(verified);
    assert.equal(freeWithStops.surface.kind, 'ready');
    assert.ok(freeWithStops.surface.kind === 'ready');
    assert.equal(freeWithStops.surface.preview.stops?.[0]?.name, 'Стары порт');
    assert.equal(cacheRows(driver).length, 4, 'only a verified free-base preview and its locale fallback are persisted');
    verified.dispose();
  });

  it('rejects a stale v3 snapshot and in-memory preview when the catalog publishes v4 without its route document', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    let upgraded = false;
    const changingOrigin: CatalogPathLoader = async (relative) => {
      if (!upgraded) return loadPublished(relative);
      if (relative === 'catalog.json') {
        const catalog: { routes: Array<{ route_id: string; version: string }> } =
          JSON.parse(await loadPublished(relative));
        const published = catalog.routes.find((route) => route.route_id === 'guide-route-b1');
        assert.ok(published);
        published.version = '4';
        return JSON.stringify(catalog);
      }
      if (relative === 'bundle/guide-route-b1/4/route.json') {
        throw new Error('v4 route not available');
      }
      return loadPublished(relative);
    };

    const existing = root(driver, changingOrigin);
    const store = existing.preview?.create('guide-route-b1');
    assert.ok(store, 'real preview controller is composed');
    await store.getState().refresh();
    const v3 = store.getState().surface;
    assert.equal(v3.kind, 'ready');
    assert.ok(v3.kind === 'ready');
    assert.equal(v3.preview.version, '3');
    assert.equal(v3.preview.stops?.[0]?.name, 'Стары порт');
    const savedV3 = cacheRows(driver);
    assert.equal(savedV3.length, 4, 'locale-specific and latest list and verified v3 free preview were persisted');
    const previewV3 = savedV3.find((row) => row.route_id.includes('"preview:v1"'));
    assert.ok(previewV3, 'the verified v3 preview row is present');

    upgraded = true;
    await store.getState().refresh();
    const updated = store.getState().surface;
    assert.equal(updated.kind, 'ready');
    assert.ok(updated.kind === 'ready');
    assert.equal(updated.preview.version, '4', 'old in-memory v3 must not masquerade as v4');
    assert.equal(updated.degraded, 'route-doc-unavailable');
    assert.equal(updated.preview.stops, null, 'v3 stop labels must not be used for the unpublished v4 document');
    assert.deepEqual(cacheRows(driver).find((row) => row.route_id.includes('"preview:v1"')), previewV3,
      'degraded v4 refresh must preserve, not rewrite, the verified v3 preview');
    existing.dispose();

    const fresh = root(driver, changingOrigin);
    const diskOnly = await detail(fresh);
    assert.equal(diskOnly.surface.kind, 'ready');
    assert.ok(diskOnly.surface.kind === 'ready');
    assert.equal(diskOnly.surface.preview.version, '4', 'the persisted v3 cache must not masquerade as v4');
    assert.equal(diskOnly.surface.degraded, 'route-doc-unavailable');
    assert.equal(diskOnly.surface.preview.stops, null, 'disk-only recovery cannot leak obsolete v3 stops');
    assert.deepEqual(cacheRows(driver).find((row) => row.route_id.includes('"preview:v1"')), previewV3,
      'the old v3 preview stays unchanged even while the catalog-list snapshot advances to v4');
    fresh.dispose();
  });

  it('malformed responses, failed index pins and missing route docs keep the last good stored projection', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    const first = root(driver, loadPublished);
    assert.equal((await list(first)).kind, 'ready');
    assert.equal((await detail(first)).surface.kind, 'ready');
    const lastGood = cacheRows(driver);
    first.dispose();

    const corruptResponse: CatalogPathLoader = async (rel) =>
      rel === 'catalog.json' ? '{bad json' : loadPublished(rel);
    const malformed = root(driver, corruptResponse);
    assert.equal((await list(malformed)).kind, 'offline');
    assert.equal((await detail(malformed)).surface.kind, 'ready');
    assert.deepEqual(cacheRows(driver), lastGood);
    malformed.dispose();

    const badIndex: CatalogPathLoader = async (rel) =>
      rel === 'discovery/city-a/r-2026-09-14-1/index.json' ? '{}' : loadPublished(rel);
    const pinned = root(driver, badIndex);
    const catalog = await list(pinned);
    assert.equal(catalog.kind, 'offline');
    assert.ok(catalog.kind === 'offline');
    assert.equal(catalog.reason, 'index-unavailable');
    assert.deepEqual(cacheRows(driver), lastGood);
    pinned.dispose();

    const missingDoc: CatalogPathLoader = async (rel) =>
      rel === 'bundle/guide-route-b1/3/route.json' ? Promise.reject(new Error('missing')) : loadPublished(rel);
    const noDocument = root(driver, missingDoc);
    const preview = await detail(noDocument);
    assert.equal(preview.surface.kind, 'ready');
    assert.ok(preview.surface.kind === 'ready');
    assert.equal(preview.surface.degraded, 'route-doc-unavailable');
    assert.equal(preview.surface.preview.stops?.[0]?.name, 'Стары порт');
    assert.deepEqual(cacheRows(driver), lastGood);
    noDocument.dispose();
  });

  it('missing and malformed persisted snapshots fail safely; verified refresh repairs them', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    const noCache = root(driver, noNetwork);
    const absent = await list(noCache);
    assert.equal(absent.kind, 'error');
    assert.ok(absent.kind === 'error');
    assert.equal(absent.reason, 'network-offline');
    assert.equal((await detail(noCache)).surface.kind, 'unavailable');
    noCache.dispose();

    const prime = root(driver, loadPublished);
    assert.equal((await list(prime)).kind, 'ready');
    assert.equal((await detail(prime)).surface.kind, 'ready');
    prime.dispose();
    corruptRows(driver);
    const corrupt = root(driver, noNetwork);
    const catalog = await list(corrupt);
    assert.equal(catalog.kind, 'error');
    assert.ok(catalog.kind === 'error');
    assert.equal(catalog.reason, 'catalog-cache-corrupt');
    const preview = await detail(corrupt);
    assert.equal(preview.surface.kind, 'unavailable');
    assert.ok(preview.surface.kind === 'unavailable');
    assert.equal(preview.surface.reason, 'catalog-preview-cache-corrupt');
    corrupt.dispose();

    const recovered = root(driver, loadPublished);
    assert.equal((await list(recovered)).kind, 'ready');
    assert.equal((await detail(recovered)).surface.kind, 'ready');
    assert.equal(cacheRows(driver).length, 4);
    const offlineAgain = root(driver, noNetwork);
    assert.equal((await list(offlineAgain)).kind, 'offline');
    assert.equal((await detail(offlineAgain)).surface.kind, 'ready');
    recovered.dispose();
    offlineAgain.dispose();
  });

  it('rebuildDerived deletes only zone-A cache and preserves the real durable walk history', async () => {
    const driver = nodeSqliteDriver();
    openDatabase(driver);
    const start = {
      sessionId: '11111111-1111-4111-8111-111111111111',
      routeId: 'guide-route-b1',
      version: '3',
      locale: 'be',
      startedAt: 1760000000000,
    };
    startSession(driver, start);
    checkpointProgress(driver, start.sessionId, { heard: ['story-b1-1'], autoFired: ['stop-b1-1'], playSeq: 1 });
    const before = root(driver, loadPublished);
    assert.equal((await list(before)).kind, 'ready');
    assert.equal((await detail(before)).surface.kind, 'ready');
    assert.equal(cacheRows(driver).length, 4);
    before.dispose();

    rebuildDerived(driver);
    assert.equal(cacheRows(driver).length, 0);
    const session = getSession(driver, start.sessionId);
    assert.ok(session);
    assert.deepEqual(session.heard, ['story-b1-1']);
    assert.deepEqual(session.autoFired, ['stop-b1-1']);
    const fresh = root(driver, noNetwork);
    assert.equal((await list(fresh)).kind, 'error');
    assert.equal((await detail(fresh)).surface.kind, 'unavailable');
    fresh.dispose();
  });

  it('the bundled demo loader still renders when no snapshot port is supplied', async () => {
    const demo = createServices({ catalogLoader: loadPublished, catalogSha256: sha256 });
    const catalog = await list(demo);
    assert.equal(catalog.kind, 'ready');
    const preview = await detail(demo);
    assert.equal(preview.surface.kind, 'ready');
    demo.dispose();
  });
});
