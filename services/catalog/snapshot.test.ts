// G20.32 (#794): production createServices -> catalog/preview controllers ->
// catalog service -> persistent zone-A SQLite. Network is the only fake.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createServices } from '../../controllers/createServices.ts';
import { checkpointProgress, getSession, openDatabase, rebuildDerived, startSession } from '../db/db.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from '../db/test-fixture.ts';
import type { SqlDriver } from '../db/types.ts';
import { catalogSnapshotOver } from './snapshot.ts';
import type { CatalogPathLoader } from './types.ts';

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

function root(driver: SqlDriver, loader: CatalogPathLoader) {
  return createServices({
    catalogLoader: loader,
    catalogSha256: sha256,
    catalogSnapshot: catalogSnapshotOver(driver),
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
      const online = root(sqlite.driver, loadPublished);
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
      assert.equal(opened.button.enabled, false);
      assert.equal(opened.button.reason, 'preview#storage-unknown', 'no inventory port must not invent Start');

      const before = cacheRows(sqlite.driver);
      assert.equal(before.length, 2, 'one list and one free preview snapshot');
      assert.ok(before.every((row) => !row.payload.includes('https://') && !row.payload.includes('story_base_id')));
      online.dispose();
      sqlite.close();

      sqlite = nodeSqliteFileDriver(file);
      openDatabase(sqlite.driver);
      const offline = root(sqlite.driver, noNetwork);
      const fromDisk = await list(offline);
      assert.equal(fromDisk.kind, 'offline', 'offline banner survives an actual reopened SQLite database');
      assert.ok(fromDisk.kind === 'offline');
      assert.deepEqual(fromDisk.guides, initial.guides);
      const reopened = await detail(offline);
      assert.equal(reopened.surface.kind, 'ready');
      assert.ok(reopened.surface.kind === 'ready');
      assert.equal(reopened.surface.degraded, 'network-offline');
      assert.deepEqual(reopened.surface.preview, opened.surface.preview);
      assert.deepEqual(reopened.button, opened.button, 'download/Start readiness still comes from disk inventory');
      offline.dispose();
    } finally {
      sqlite.close();
      rmSync(temp, { recursive: true, force: true });
    }
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
    assert.equal(cacheRows(driver).length, 2);
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
    assert.equal(cacheRows(driver).length, 2);
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
