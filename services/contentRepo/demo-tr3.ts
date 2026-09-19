// TR-3.1 demo — the reader is aligned with route.schema.json. Before the fix
// a schema-valid free_base package evaluated incomplete (the reader accepted
// the old 'free' spelling) and a route.json of literal null crashed the
// evaluation contrary to the "never throws" contract. Prints verdicts only
// (no paths, no timings) so the output is deterministic; the package is
// written to a fresh temp directory each run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluatePackage } from './contentRepo.ts';
import { createNodePackageStore } from './nodePackageStore.ts';
import { writeSamplePackage } from './test-fixture.ts';
import { nullRouteText, routeDoc, routeDocWithLegacyAccess } from '../../contracts/fixtures/bundle-docs.ts';

async function main(): Promise<void> {
  const root = writeSamplePackage(fs.mkdtempSync(path.join(os.tmpdir(), 'tr3-demo-')));
  const store = createNodePackageStore(root, { routeId: 'route-x', version: '1' });

  // 1. The schema enum value the reader used to reject: ready on base.
  fs.writeFileSync(`${root}/route.json`, JSON.stringify(routeDoc('free_base')));
  const freeBase = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`1. schema-valid free_base package:  ${JSON.stringify(freeBase)}`);

  // 2. free_base makes base public, not extended (09 §5.2): locked without a
  //    grant, ready with one.
  const locked = await evaluatePackage(store, { locale: 'be', tier: 'extended', grantedTiers: [] });
  console.log(`2. free_base extended, no grant:     ${JSON.stringify(locked)}`);
  const granted = await evaluatePackage(store, { locale: 'be', tier: 'extended', grantedTiers: ['extended'] });
  console.log(`3. free_base extended, granted:      ${JSON.stringify(granted)}`);

  // 4. The legacy 'free' spelling is not in the schema domain: type fault.
  fs.writeFileSync(`${root}/route.json`, JSON.stringify(routeDocWithLegacyAccess()));
  const legacy = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`4. legacy "free" (not in schema):    ${JSON.stringify(legacy)}`);

  // 5. Corrupt input: literal null is a diagnostic, never a crash.
  fs.writeFileSync(`${root}/route.json`, nullRouteText);
  const nullDoc = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`5. route.json text null:             ${JSON.stringify(nullDoc)}`);

  fs.rmSync(root, { recursive: true, force: true });
}

main();
