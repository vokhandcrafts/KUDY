// G06.01.a (issue #313) — the catalog controller state machine: boot load,
// the 09 §4 revalidation rule (failure keeps the cached surface), the
// superseded-refresh guard and the honest error path.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCatalogController } from './catalogController.ts';
import { createCatalogService } from '../../services/catalog/catalogService.ts';
import type { CatalogPathLoader } from '../../services/catalog/types.ts';

// The root constructs the service over its ports and hands it to the
// controller; the tests repeat exactly that wiring with fake ports.
function makeController(loader: CatalogPathLoader, sha: (bytes: Uint8Array) => Promise<string> = sha256) {
  return createCatalogController(createCatalogService({ loader, sha256: sha }, { localePreference: ['be', 'en'] }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'condition not reached');
}

const EMPTY_CATALOG = JSON.stringify({ catalog_schema_version: 1, routes: [] });

function loaderFromTexts(map: Record<string, string>): CatalogPathLoader {
  return (relPath) =>
    relPath in map ? Promise.resolve(map[relPath]) : Promise.reject(new Error(`unexpected: ${relPath}`));
}

const sha256 = async () => 'deadbeef';

describe('catalog controller', () => {
  it('boots into the ready surface with the published guides', async () => {
    const controller = makeController(loaderFromTexts({ 'catalog.json': EMPTY_CATALOG }));
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready' && surface.guides.length === 0);
  });

  it('keeps the cached guides visible when a revalidation fails (09 §4)', async () => {
    const texts: Record<string, string> = {
      'catalog.json': JSON.stringify({
        catalog_schema_version: 1,
        routes: [{ route_id: 'r-1', version: '1', locales: ['be'], layers: ['base'] }],
      }),
    };
    let fail = false;
    const controller = makeController((relPath) => {
      if (fail) return Promise.reject(new Error('network gone'));
      return loaderFromTexts(texts)(relPath);
    });
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    fail = true;
    const refresh = controller.getState().refresh();
    assert.equal(controller.getState().refreshing, true);
    await refresh;
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'offline' && surface.reason === 'network gone');
    assert.ok(surface.guides.length === 1);
    assert.equal(controller.getState().refreshing, false);
  });

  it('renders the honest error when there is no cache to fall back to', async () => {
    const controller = makeController(() => Promise.reject(new Error('offline at boot')));
    await waitUntil(() => controller.getState().surface.kind === 'error');
    assert.deepEqual(controller.getState().surface, { kind: 'error', reason: 'offline at boot' });
  });

  it('a superseded refresh never overwrites the newer result', async () => {
    const bootGate = deferred<string>();
    const laterGate = deferred<string>();
    let call = 0;
    const controller = makeController(() => (call++ === 0 ? bootGate.promise : laterGate.promise));
    controller.getState().refresh();
    laterGate.resolve(JSON.stringify({
      catalog_schema_version: 1,
      routes: [{ route_id: 'r-new', version: '1', locales: ['be'], layers: ['base'] }],
    }));
    await waitUntil(() => controller.getState().surface.kind === 'ready');
    // The stale boot run now resolves with different content — the run
    // guard must drop it.
    bootGate.resolve(JSON.stringify({
      catalog_schema_version: 1,
      routes: [{ route_id: 'r-stale', version: '1', locales: ['be'], layers: ['base'] }],
    }));
    await new Promise((resolve) => setImmediate(resolve));
    const surface = controller.getState().surface;
    assert.ok(surface.kind === 'ready' && surface.guides[0]?.routeId === 'r-new');
    assert.equal(controller.getState().refreshing, false);
  });
});
