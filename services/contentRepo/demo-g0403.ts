// G04.03 demo — the readiness card across its four states plus the discovery
// cache separation. Prints verdicts only (no paths, no timings) so the output
// is deterministic; the package is written to a fresh temp directory each run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluatePackage, createDiscoveryCache } from './contentRepo.ts';
import { createNodePackageStore } from './nodePackageStore.ts';
import { writeSamplePackage } from './test-fixture.ts';

async function main(): Promise<void> {
  const root = writeSamplePackage(fs.mkdtempSync(path.join(os.tmpdir(), 'g0403-demo-')));
  const store = createNodePackageStore(root, { routeId: 'route-x', version: '1' });

  // 1. Free start on a complete package: ready, base layer available.
  const free = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`1. free start on a complete package: ${JSON.stringify(free)}`);

  // 2. Paid extended start without a grant: access-locked — the purchase
  //    path, not a repair offer (ContentRepo never decides purchases).
  const locked = await evaluatePackage(store, { locale: 'be', tier: 'extended', grantedTiers: [] });
  console.log(`2. paid start without grant:          ${JSON.stringify(locked)}`);

  // 3. Media error: the audio file disappears — needs-recovery with the file
  //    list for the repair offer.
  fs.rmSync(`${root}/be/base/audio/story-b.m4a`);
  const recovery = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`3. media error:                       ${JSON.stringify(recovery)}`);
  fs.writeFileSync(`${root}/be/base/audio/story-b.m4a`, 'm4a-placeholder');

  // 4. Structural incompleteness: a missing layer file blocks start with the
  //    named reason.
  fs.rmSync(`${root}/be/base/stops.json`);
  const incomplete = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`4. missing layer file:                ${JSON.stringify(incomplete)}`);
  fs.writeFileSync(
    `${root}/be/base/stops.json`,
    JSON.stringify([{ story_id: 'story-b', place_id: 'place-1', voice_id: 'voice-1', tier: 'base', duration_s: 60, text: 'т', transcript: 'т', sources: ['с'] }]),
  );

  // 5. Discovery cache: a missing index keeps the guide startable and reads
  //    as nulls; a good read is cached; access state never touches it.
  fs.rmSync(`${root}/discovery.json`);
  const cache = createDiscoveryCache();
  const missingIndex = await cache.read(store);
  const stillStartable = await evaluatePackage(store, { locale: 'be', tier: 'base' });
  console.log(`5. missing discovery index:           ${JSON.stringify(missingIndex)} (start: ${stillStartable.status})`);
  fs.writeFileSync(`${root}/discovery.json`, JSON.stringify({ revision: 'r-1', city_id: 'city-x', offers: [] }));
  const first = await cache.read(store);
  const second = await cache.read(store);
  console.log(`5. discovery cached reads:            revision=${first.revision} fromCache=${first.fromCache} -> fromCache=${second.fromCache}`);

  fs.rmSync(root, { recursive: true, force: true });
}

main();
