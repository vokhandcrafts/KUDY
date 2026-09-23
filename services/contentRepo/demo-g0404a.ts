// G04.04.a demo — the library inventory across its four states plus the
// stale-next-to-pinned separation (criterion 2). Prints verdicts only (no
// paths, no timings); the bundles tree lives in a fresh temp directory and is
// removed afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluatePackage } from './contentRepo.ts';
import { inventoryPackages } from './inventory.ts';
import { createNodeBundlesStore } from './nodeBundlesStore.ts';
import { storeAt, writeSampleLayer } from './test-fixture.ts';
import type { InventoryResult } from './types.ts';

function catalogFor(version: string): unknown {
  return {
    catalog_schema_version: 1,
    routes: [{ route_id: 'route-x', version, locales: ['be'], layers: ['base'], sizes: { base: 0 } }],
  };
}

function show(label: string, result: InventoryResult): void {
  for (const entry of result.entries) {
    const missing = entry.missingCount === null ? 'unknown' : String(entry.missingCount);
    console.log(
      `${label} ${entry.routeId}@${entry.version}/${entry.locale}/${entry.tier}: ` +
        `${entry.state} (missing ${missing}), bytes ${entry.bytes.declared ?? 'null'}/${entry.bytes.onDisk ?? 'null'}` +
        (entry.diagnostics.length > 0 ? ` diagnostics ${JSON.stringify(entry.diagnostics)}` : ''),
    );
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g0404a-demo-'));
  const layerRel = 'bundles/route-x/1/be/base';
  const layer = `${root}/${layerRel}`;
  writeSampleLayer(root, layerRel);
  const store = createNodeBundlesStore(root);

  show('1.', await inventoryPackages(store, { catalog: catalogFor('1') }));

  fs.rmSync(`${layer}/be/base/audio/story-b.m4a`);
  show('2.', await inventoryPackages(store, { catalog: catalogFor('1') }));
  fs.writeFileSync(`${layer}/be/base/audio/story-b.m4a`, 'm4a-placeholder');

  show('3.', await inventoryPackages(store, { catalog: catalogFor('2') }));

  const readiness = await evaluatePackage(storeAt(layer), { locale: 'be', tier: 'base' });
  console.log(`4. pinned readiness of the stale version: ${readiness.status}`);

  fs.writeFileSync(`${layer}/lock.json`, '[null]');
  show('5.', await inventoryPackages(store, { catalog: catalogFor('2') }));

  fs.rmSync(root, { recursive: true, force: true });
}

main();
