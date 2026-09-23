// G04.04.a — acceptance suite for the library inventory (issue #193). Every
// state is exercised on real directories through the node facts adapter;
// corrupt catalog and lock input answers with diagnostics, never a thrown
// error (criterion 4); each negative fixture isolates exactly one violation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluatePackage } from './contentRepo.ts';
import { inventoryPackages } from './inventory.ts';
import { createNodeBundlesStore } from './nodeBundlesStore.ts';
import {
  sha256Hex,
  storeAt,
  writeFlatLayer,
  writeSampleLayer,
} from './test-fixture.ts';
import type { BundlesStore, InventoryResult } from './types.ts';

// --- fixture helpers ---------------------------------------------------------

function catalogOf(routes: unknown): unknown {
  return { catalog_schema_version: 1, routes };
}

function routeRow(routeId: string, version: string, locales: string[], layers: string[]): unknown {
  return { route_id: routeId, version, locales, layers, sizes: { base: 1 } };
}

// --- fixture helpers ---------------------------------------------------------

// Records every statSize target so tests can assert that unsafe identifiers
// are never probed on the filesystem (implementation-rules 14: checked on
// input, before any fs call).
function recordingStatSize(store: BundlesStore): BundlesStore & { statCalls: string[] } {
  const statCalls: string[] = [];
  return {
    statCalls,
    listDir: (rel) => store.listDir(rel),
    readFile: (rel) => store.readFile(rel),
    statSize: async (rel) => {
      statCalls.push(rel);
      return store.statSize(rel);
    },
  };
}

function snapshotTree(root: string): Array<[string, string]> {
  const snap: Array<[string, string]> = [];
  const walk = (rel: string) => {
    for (const item of fs.readdirSync(`${root}/${rel}`, { withFileTypes: true })) {
      const child = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) walk(child);
      else snap.push([child, sha256Hex(fs.readFileSync(`${root}/${child}`))]);
    }
  };
  walk('');
  return snap.sort(([a], [b]) => a.localeCompare(b));
}

function findEntry(
  result: InventoryResult,
  version: string,
  locale = 'be',
  tier = 'base',
): InventoryResult['entries'][number] | undefined {
  return result.entries.find((entry) =>
    entry.routeId === 'route-x' && entry.version === version && entry.locale === locale && entry.tier === tier);
}

// --- criterion 1: the four states -------------------------------------------

test('AC1: not_downloaded — catalog versions without a layer on disk are listed, an absent bundles tree is an empty library, not a fault', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createNodeBundlesStore(root);
  const result = await inventoryPackages(store, {
    catalog: catalogOf([routeRow('route-x', '2', ['be', 'en'], ['base', 'extended'])]),
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.entries.length, 4);
  for (const entry of result.entries) {
    assert.equal(entry.state, 'not_downloaded');
    assert.equal(entry.missingCount, null);
    assert.deepEqual(entry.bytes, { declared: null, onDisk: null });
    assert.deepEqual(entry.diagnostics, []);
  }
  assert.deepEqual(
    result.entries.map((entry) => `${entry.locale}/${entry.tier}`),
    ['be/base', 'be/extended', 'en/base', 'en/extended'],
  );
});

test('AC1: ready — every lock file present at its declared size, bytes derived from lock and disk', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = { 'stops.json': '{"stories":[]}', 'audio/story-b.m4a': 'm4a-bytes' };
  writeFlatLayer(root, 'bundles/route-x/1/be/base', files);
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '1', ['be'], ['base'])]),
  });
  const entry = findEntry(result, '1');
  assert.equal(entry?.state, 'ready');
  assert.equal(entry?.missingCount, 0);
  const declared = Object.values(files).reduce((sum, data) => sum + Buffer.byteLength(data), 0);
  assert.equal(entry?.bytes.declared, declared);
  assert.equal(entry?.bytes.onDisk, declared);
  assert.deepEqual(entry?.diagnostics, []);
});

test('AC1: partial — absent files count toward missing with derived byte sums', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = { 'a.txt': 'aaa', 'b.txt': 'bbb', 'c.txt': 'ccc' };
  writeFlatLayer(root, 'bundles/route-x/1/be/base', files);
  fs.rmSync(`${root}/bundles/route-x/1/be/base/a.txt`);
  fs.rmSync(`${root}/bundles/route-x/1/be/base/c.txt`);
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '1', ['be'], ['base'])]),
  });
  const entry = findEntry(result, '1');
  assert.equal(entry?.state, 'partial');
  assert.equal(entry?.missingCount, 2);
  assert.equal(entry?.bytes.declared, 9);
  assert.equal(entry?.bytes.onDisk, 3);
});

test('AC1: stale — the catalog advertises a newer version, the older disk version keeps its disk facts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/1/be/base');
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '2', ['be'], ['base'])]),
  });
  const stale = findEntry(result, '1');
  assert.equal(stale?.state, 'stale');
  assert.equal(stale?.missingCount, 0);
  assert.ok((stale?.bytes.declared ?? 0) > 0);
  const fresh = findEntry(result, '2');
  assert.equal(fresh?.state, 'not_downloaded', 'the advertised version lists alongside the stale one');
});

// --- criterion 2: stale is catalog-derived, the pinned version is untouched --

test('AC2: a newer catalog next to the pinned version replaces no file and changes no readiness', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layerRel = 'bundles/route-x/1/be/base';
  writeSampleLayer(root, layerRel);
  const before = snapshotTree(root);
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '2', ['be'], ['base'])]),
  });
  assert.deepEqual(snapshotTree(root), before, 'the inventory replaces no file');
  assert.equal(findEntry(result, '1')?.state, 'stale');
  // The paused session stays pinned to @1 (ADR G01.03 §3.4): its readiness is
  // the disk fact evaluatePackage derives, untouched by the newer catalog.
  const readiness = await evaluatePackage(storeAt(`${root}/${layerRel}`), { locale: 'be', tier: 'base' });
  assert.equal(readiness.status, 'ready');
});

test('AC2: an incomplete layer stays partial next to a newer catalog', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/1/be/base');
  fs.rmSync(`${root}/bundles/route-x/1/be/base/be/base/audio/story-b.m4a`);
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '2', ['be'], ['base'])]),
  });
  assert.equal(findEntry(result, '1')?.state, 'partial');
});

test('AC2: the catalog advertising the disk version itself reads ready, not stale', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/1/be/base');
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '1', ['be'], ['base'])]),
  });
  assert.equal(findEntry(result, '1')?.state, 'ready');
});

test('a non-numeric disk version cannot be ordered against the catalog and is never stale', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/beta/be/base');
  const result = await inventoryPackages(createNodeBundlesStore(root), {
    catalog: catalogOf([routeRow('route-x', '2', ['be'], ['base'])]),
  });
  assert.equal(findEntry(result, 'beta')?.state, 'ready');
});

// --- disk walk boundaries ----------------------------------------------------

test('staging beside the final layout is not a version', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/staging/be/base');
  const result = await inventoryPackages(createNodeBundlesStore(root), { catalog: catalogOf([]) });
  assert.deepEqual(result.entries, []);
});

test('a directory that is not a tier is a diagnostic, not a row', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/1/be/base');
  fs.mkdirSync(`${root}/bundles/route-x/1/be/junk`, { recursive: true });
  const result = await inventoryPackages(createNodeBundlesStore(root), { catalog: catalogOf([]) });
  assert.deepEqual(result.diagnostics, ['bundles/route-x/1/be/junk#type']);
  assert.equal(result.entries.length, 1);
  assert.equal(findEntry(result, '1')?.state, 'ready');
});

test('disk locales are listed as they are — the locale set is open on disk', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFlatLayer(root, 'bundles/route-x/1/pl/base', { 'stops.json': '[]' });
  const result = await inventoryPackages(createNodeBundlesStore(root), { catalog: catalogOf([]) });
  const entry = result.entries[0];
  assert.equal(entry?.locale, 'pl');
  assert.equal(entry?.state, 'ready');
});

// --- criterion 3: sizes derived, nothing stored ------------------------------

test('AC3: sizes are derived per call — a disk change is reflected, the module never writes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layerRel = 'bundles/route-x/1/be/base';
  writeFlatLayer(root, layerRel, { 'a.txt': 'aaa' });
  const store = createNodeBundlesStore(root);
  const catalog = catalogOf([routeRow('route-x', '1', ['be'], ['base'])]);
  const first = await inventoryPackages(store, { catalog });
  assert.equal(findEntry(first, '1')?.bytes.onDisk, 3);
  // The file grows beyond its declared size: the next call re-derives the
  // facts from disk — the mismatch is diagnosed, nothing is written.
  fs.writeFileSync(`${root}/${layerRel}/a.txt`, 'aaaaaa');
  const second = await inventoryPackages(store, { catalog });
  assert.equal(findEntry(second, '1')?.bytes.onDisk, 0);
  assert.deepEqual(findEntry(second, '1')?.diagnostics, ['lock.json[0]#size-mismatch']);
  fs.writeFileSync(`${root}/${layerRel}/a.txt`, 'aaa');
  const third = await inventoryPackages(store, { catalog });
  assert.equal(findEntry(third, '1')?.bytes.onDisk, 3);
  assert.deepEqual(third, await inventoryPackages(store, { catalog }), 'the same state yields the same listing');
});

// --- criterion 4: corrupt input yields diagnostics, never a thrown error -----

test('AC4: a corrupt catalog cache is diagnosed, not thrown', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createNodeBundlesStore(root);
  const nullDoc = await inventoryPackages(store, { catalog: null });
  assert.deepEqual(nullDoc.diagnostics, ['catalog#type']);
  assert.deepEqual(nullDoc.entries, []);
  const badRoutes = await inventoryPackages(store, { catalog: { catalog_schema_version: 1, routes: 42 } });
  assert.deepEqual(badRoutes.diagnostics, ['catalog.routes#type']);
  const nullEntry = await inventoryPackages(store, { catalog: catalogOf([null]) });
  assert.deepEqual(nullEntry.diagnostics, ['catalog.routes[0]#type']);
  const numericId = await inventoryPackages(store, { catalog: catalogOf([{ route_id: 42, version: '1', locales: ['be'], layers: ['base'] }]) });
  assert.deepEqual(numericId.diagnostics, ['catalog.routes[0].route_id#type']);
  const badLocales = await inventoryPackages(store, { catalog: catalogOf([{ route_id: 'route-x', version: '1', locales: 'be', layers: ['base'] }]) });
  assert.deepEqual(badLocales.diagnostics, ['catalog.routes[0].locales#type']);
  const junkLayer = await inventoryPackages(store, { catalog: catalogOf([{ route_id: 'route-x', version: '1', locales: ['be'], layers: ['vip'] }]) });
  assert.deepEqual(junkLayer.diagnostics, ['catalog.routes[0].layers[0]#type']);
  assert.deepEqual(junkLayer.entries, []);
});

test('AC4: an unsafe catalog route_id is diagnosed and never probed on the filesystem', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeSampleLayer(root, 'bundles/route-x/1/be/base');
  const store = recordingStatSize(createNodeBundlesStore(root));
  const result = await inventoryPackages(store, {
    catalog: catalogOf([{ route_id: '../evil', version: '1', locales: ['be'], layers: ['base'] }]),
  });
  assert.deepEqual(result.diagnostics, ['catalog.routes[0].route_id#unsafe-path:../evil']);
  assert.deepEqual(result.entries.filter((entry) => entry.routeId === '../evil'), []);
  assert.equal(
    store.statCalls.some((rel) => rel.includes('..')),
    false,
    'no filesystem probe may carry the untrusted identifier',
  );
});

test('AC4: corrupt lock entries are diagnosed, the layer is not ready', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layerRel = 'bundles/route-x/1/be/base';
  const store = createNodeBundlesStore(root);
  const run = (lock: unknown) => {
    writeFlatLayer(root, layerRel, { 'a.txt': 'aaa' }, lock);
    return inventoryPackages(store, { catalog: catalogOf([routeRow('route-x', '1', ['be'], ['base'])]) });
  };

  const notJson = await run('{oops');
  assert.equal(findEntry(notJson, '1')?.state, 'partial');
  assert.equal(findEntry(notJson, '1')?.missingCount, null);
  assert.deepEqual(findEntry(notJson, '1')?.diagnostics, ['lock.json#invalid-json']);

  const notArray = await run(42);
  assert.deepEqual(findEntry(notArray, '1')?.diagnostics, ['lock.json#type']);

  const nullEntry = await run([null]);
  assert.deepEqual(findEntry(nullEntry, '1')?.diagnostics, ['lock.json[0]#type']);
  assert.equal(findEntry(nullEntry, '1')?.missingCount, 1, 'a corrupt entry is a file slot that cannot be verified');

  const missingBytes = await run([{ path: 'a.txt', sha256: 'h'.repeat(64) }]);
  assert.deepEqual(findEntry(missingBytes, '1')?.diagnostics, ['lock.json[0].bytes#type']);

  const missingHash = await run([{ path: 'a.txt', bytes: 3 }]);
  assert.deepEqual(findEntry(missingHash, '1')?.diagnostics, ['lock.json[0].sha256#type']);

  const negative = await run([{ path: 'a.txt', bytes: -1, sha256: 'h'.repeat(64) }]);
  assert.deepEqual(findEntry(negative, '1')?.diagnostics, ['lock.json[0].bytes#type']);
});

test('AC4: an unsafe lock path is diagnosed and never probed on the filesystem', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(`${root}/victim.txt`, 'outside the layer');
  writeFlatLayer(root, 'bundles/route-x/1/be/base', {}, [
    { path: '../victim.txt', bytes: 18, sha256: 'h'.repeat(64) },
  ]);
  const store = recordingStatSize(createNodeBundlesStore(root));
  const result = await inventoryPackages(store, { catalog: catalogOf([]) });
  const entry = findEntry(result, '1');
  assert.deepEqual(entry?.diagnostics, ['lock.json[0]#unsafe-path:../victim.txt']);
  assert.equal(entry?.state, 'partial');
  assert.deepEqual(store.statCalls, [], 'no filesystem probe may carry an untrusted path');
});

test('AC4: a file at the wrong size fails the level-2 metadata check with a diagnostic', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFlatLayer(root, 'bundles/route-x/1/be/base', { 'a.txt': 'aaaa' }, [
    { path: 'a.txt', bytes: 3, sha256: 'h'.repeat(64) },
  ]);
  const result = await inventoryPackages(createNodeBundlesStore(root), { catalog: catalogOf([]) });
  const entry = findEntry(result, '1');
  assert.equal(entry?.state, 'partial');
  assert.equal(entry?.missingCount, 1);
  assert.deepEqual(entry?.diagnostics, ['lock.json[0]#size-mismatch']);
  assert.equal(entry?.bytes.declared, 3);
  assert.equal(entry?.bytes.onDisk, 0, 'a size-mismatched file is not counted as on disk');
});

test('AC4: a layer directory without a lock is partial with an unknowable count', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(`${root}/bundles/route-x/1/be/base`, { recursive: true });
  fs.writeFileSync(`${root}/bundles/route-x/1/be/base/a.txt`, 'aaa');
  const result = await inventoryPackages(createNodeBundlesStore(root), { catalog: catalogOf([]) });
  const entry = findEntry(result, '1');
  assert.equal(entry?.state, 'partial');
  assert.equal(entry?.missingCount, null);
  assert.deepEqual(entry?.diagnostics, ['lock.json#missing-file']);
});

// --- determinism -------------------------------------------------------------

test('the listing is deterministic: multi-route output is sorted and repeatable', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFlatLayer(root, 'bundles/route-b/10/be/base', { 'a.txt': 'a' });
  writeFlatLayer(root, 'bundles/route-a/9/be/extended', { 'a.txt': 'a' });
  writeFlatLayer(root, 'bundles/route-a/100/be/extended', { 'a.txt': 'a' });
  const store = createNodeBundlesStore(root);
  const catalog = catalogOf([
    routeRow('route-b', '10', ['be'], ['base']),
    routeRow('route-a', '100', ['be'], ['extended']),
    routeRow('route-c', '1', ['be'], ['base']),
  ]);
  const result = await inventoryPackages(store, { catalog });
  assert.deepEqual(
    result.entries.map((entry) => `${entry.routeId}@${entry.version}/${entry.tier}/${entry.state}`),
    [
      'route-a@9/extended/stale',
      'route-a@100/extended/ready',
      'route-b@10/base/ready',
      'route-c@1/base/not_downloaded',
    ],
    'versions order numerically (9 before 100), routes and states lexicographically',
  );
  assert.deepEqual(await inventoryPackages(store, { catalog }), result);
});
