// G15.03 (issue #70) — the discovery index reader tests: the production load
// path over the committed fixtures (loader port in, integrity pin, snapshot
// out). Every fault case proves the 21 §3.3 reader policy: the last valid
// snapshot survives, a city without one stays honestly without discovery.
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import { loadDiscoveryIndex, type DiscoverySnapshotStore } from './discoveryIndex.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/discovery-contract/${name}`, import.meta.url), 'utf8');

const VALID_CATALOG = fixture('catalog-with-discovery.json');
const VALID_INDEX = fixture('index-valid.json');
const POINTER_PATH = 'discovery/city-a/r-2026-09-14-1/index.json';

const sha256 = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

function memorySnapshot(initial: Uint8Array | null = null): DiscoverySnapshotStore & { writes: number } {
  let bytes = initial;
  return {
    writes: 0,
    async read() {
      return bytes;
    },
    async write(next) {
      // The atomicity contract: the whole snapshot replaces in one step.
      bytes = next;
      this.writes += 1;
    },
  };
}

function depsFromPaths(paths: Record<string, string>, snapshot: DiscoverySnapshotStore) {
  return {
    loader: async (rel: string) => {
      const hit = paths[rel];
      if (hit === undefined) throw new Error(`loader-404:${rel}`);
      return hit;
    },
    sha256,
    snapshot,
  };
}

// A catalog whose pointer pins the given text: the pin is computed, so the
// reader must accept these bytes as the honest fresh path.
async function catalogPinning(indexText: string, path = POINTER_PATH, bytesOverride?: number): Promise<string> {
  const bytes = new TextEncoder().encode(indexText);
  return JSON.stringify({
    catalog_schema_version: 1,
    routes: [{ route_id: 'guide-route-a1', version: '1', locales: ['be'], layers: ['base'] }],
    discovery_index: {
      schema_version: 1,
      revision: 'r-test-1',
      path,
      bytes: bytesOverride ?? bytes.byteLength,
      sha256: await sha256(bytes),
    },
  });
}

describe('loadDiscoveryIndex — fresh path', () => {
  it('serves the committed fixture pair fresh and writes the snapshot', async () => {
    const snapshot = memorySnapshot();
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': VALID_CATALOG, [POINTER_PATH]: VALID_INDEX }, snapshot),
    );
    assert.equal(state.kind, 'ready');
    assert.ok(state.kind === 'ready');
    assert.equal(state.stale, false);
    assert.equal(state.reason, null);
    assert.equal(state.revision, 'r-2026-09-14-1');
    assert.equal(state.index.city_id, 'city-a');
    assert.equal(state.index.offers.length, 7);
    assert.equal(snapshot.writes, 1);
    const written = await snapshot.read();
    assert.ok(written !== null);
    assert.equal(new TextDecoder().decode(written), VALID_INDEX);
  });

  it('keeps serving fresh when the snapshot write fails (zone A is best-effort)', async () => {
    const snapshot: DiscoverySnapshotStore = {
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
    };
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': VALID_CATALOG, [POINTER_PATH]: VALID_INDEX }, snapshot),
    );
    assert.ok(state.kind === 'ready' && state.stale === false);
  });
});

describe('loadDiscoveryIndex — catalogs that cannot name an index', () => {
  it('legacy v1 envelope without a pointer → unavailable', async () => {
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': fixture('catalog-legacy.json') }, memorySnapshot()),
    );
    assert.deepEqual(state, { kind: 'unavailable', reason: 'discovery-not-published' });
  });

  it('legacy v0 bare routes array → unavailable', async () => {
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': fixture('catalog-legacy-v0.json') }, memorySnapshot()),
    );
    assert.deepEqual(state, { kind: 'unavailable', reason: 'discovery-not-published' });
  });

  it('corrupt catalog json → unavailable without a snapshot', async () => {
    const state = await loadDiscoveryIndex(depsFromPaths({ 'catalog.json': '{oops' }, memorySnapshot()));
    assert.deepEqual(state, { kind: 'unavailable', reason: 'catalog-corrupt' });
  });

  it('unsafe pointer path never fetches → unavailable', async () => {
    const catalog = await catalogPinning(VALID_INDEX, '../secrets/index.json');
    const state = await loadDiscoveryIndex(depsFromPaths({ 'catalog.json': catalog }, memorySnapshot()));
    assert.deepEqual(state, { kind: 'unavailable', reason: 'index-path-unsafe' });
  });
});

describe('loadDiscoveryIndex — faults keep the last valid snapshot', () => {
  it('offline restart serves the snapshot stale with the same revision', async () => {
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    const state = await loadDiscoveryIndex(depsFromPaths({}, snapshot));
    assert.ok(state.kind === 'ready');
    assert.equal(state.stale, true);
    assert.equal(state.reason, 'catalog-unavailable');
    assert.equal(state.revision, 'r-2026-09-14-1');
    assert.equal(state.index.city_id, 'city-a');
  });

  it('hash mismatch falls back to the snapshot, never renders substitute content', async () => {
    const forged = VALID_INDEX.replace('Двор сукнараў', 'Падробка');
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': VALID_CATALOG, [POINTER_PATH]: forged }, snapshot),
    );
    assert.ok(state.kind === 'ready');
    assert.equal(state.stale, true);
    assert.equal(state.reason, 'index-pin-mismatch');
    assert.equal(state.index.offers.length, 7);
  });

  it('declared size mismatch is the same pin fault', async () => {
    // The pin counts UTF-8 bytes, not UTF-16 code units (Cyrillic fixture).
    const realBytes = new TextEncoder().encode(VALID_INDEX);
    const catalog = await catalogPinning(VALID_INDEX, POINTER_PATH, realBytes.byteLength + 1);
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: VALID_INDEX }, memorySnapshot(realBytes)),
    );
    assert.ok(state.kind === 'ready' && state.stale === true && state.reason === 'index-pin-mismatch');
  });

  it('corrupt json with a correct pin → unsupported as index-json-corrupt, snapshot answers', async () => {
    const catalog = await catalogPinning('{oops');
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: '{oops' }, snapshot),
    );
    assert.ok(state.kind === 'ready' && state.stale === true && state.reason === 'index-json-corrupt');
  });

  it('unknown major schema version is not interpreted; snapshot answers stale', async () => {
    const future = JSON.stringify({ ...JSON.parse(VALID_INDEX), schema_version: 2 });
    const catalog = await catalogPinning(future);
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: future }, snapshot),
    );
    assert.ok(state.kind === 'ready' && state.stale === true && state.reason === 'index-unsupported');
  });

  it('over-limit offers are an invalid index (§3.2 count active on input)', async () => {
    const valid = JSON.parse(VALID_INDEX) as { offers: unknown[] };
    const overflow = JSON.stringify({
      ...valid,
      offers: Array.from({ length: 65 }, (_, i) => valid.offers[i % valid.offers.length]),
    });
    const catalog = await catalogPinning(overflow);
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: overflow }, snapshot),
    );
    assert.ok(state.kind === 'ready' && state.stale === true && state.reason === 'index-offers-limit');
  });

  it('a pin-valid index with a corrupt theme element answers index-theme-shape, never throws', async () => {
    const broken = JSON.parse(VALID_INDEX) as { themes: unknown[] };
    broken.themes = [null, ...broken.themes];
    const catalog = await catalogPinning(JSON.stringify(broken));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: JSON.stringify(broken) }, memorySnapshot()),
    );
    assert.ok(state.kind === 'unavailable' && state.reason === 'index-theme-shape');
  });

  it('a pin-valid index with a malformed offer element answers index-offer-shape, never throws', async () => {
    const broken = JSON.parse(VALID_INDEX) as { offers: Array<Record<string, unknown>> };
    delete broken.offers[0].availability;
    const catalog = await catalogPinning(JSON.stringify(broken));
    const state = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': catalog, [POINTER_PATH]: JSON.stringify(broken) }, memorySnapshot()),
    );
    assert.ok(state.kind === 'unavailable' && state.reason === 'index-offer-shape');
  });

  it('a corrupt snapshot answers unavailable instead of rendering garbage', async () => {
    const snapshot = memorySnapshot(new TextEncoder().encode('{half-written'));
    const state = await loadDiscoveryIndex(depsFromPaths({}, snapshot));
    assert.deepEqual(state, { kind: 'unavailable', reason: 'snapshot-index-json-corrupt' });
  });

  it('an unreadable snapshot store is the honest unavailable state', async () => {
    const snapshot: DiscoverySnapshotStore = {
      read: async () => {
        throw new Error('io');
      },
      write: async () => {},
    };
    const state = await loadDiscoveryIndex(depsFromPaths({}, snapshot));
    assert.deepEqual(state, { kind: 'unavailable', reason: 'catalog-unavailable' });
  });
});

describe('loadDiscoveryIndex — snapshot lifecycle', () => {
  it('a fresh load replaces the snapshot and the next offline session reads it (restart)', async () => {
    const snapshot = memorySnapshot();
    const fresh = await loadDiscoveryIndex(
      depsFromPaths({ 'catalog.json': VALID_CATALOG, [POINTER_PATH]: VALID_INDEX }, snapshot),
    );
    assert.ok(fresh.kind === 'ready' && fresh.stale === false);
    // The "restart": a new service over the same zone-A store, now offline.
    const restarted = await loadDiscoveryIndex(depsFromPaths({}, snapshot));
    assert.ok(restarted.kind === 'ready');
    assert.equal(restarted.stale, true);
    assert.equal(restarted.revision, 'r-2026-09-14-1');
  });

  it('a bad refresh preserves the snapshot bytes byte-for-byte', async () => {
    const snapshot = memorySnapshot(new TextEncoder().encode(VALID_INDEX));
    await loadDiscoveryIndex(depsFromPaths({}, snapshot));
    const preserved = await snapshot.read();
    assert.ok(preserved !== null);
    assert.equal(new TextDecoder().decode(preserved), VALID_INDEX);
  });
});
