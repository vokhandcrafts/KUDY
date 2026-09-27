// G06.01.b (issue #314) — Showboat driver (preview assembly): the
// production catalog service assembles the guide preview from the published
// fixtures (the envelope + discovery index + the public route documents of
// bundle/<route_id>/<version>/). Deterministic: fixed inputs, no clocks, no
// randomness. The button-meaning table over these facts is demoed beside
// the controller (demo-g0601b-button.mjs) — controllers/ value-imports
// services/ only in the composition root (19 §2.2).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadPreview } from './catalogService.ts';

const FIXTURES = new URL('../../fixtures/discovery-contract/', import.meta.url);
const text = (name) => readFileSync(new URL(name, FIXTURES), 'utf8');
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

const PAGES = {
  'catalog.json': text('catalog-with-discovery.json'),
  'discovery/city-a/r-2026-09-14-1/index.json': text('index-valid.json'),
  'bundle/guide-route-a1/1/route.json': text('route-guide-route-a1.json'),
  'bundle/guide-route-b1/3/route.json': text('route-guide-route-b1.json'),
};
const loader = (relPath) =>
  relPath in PAGES ? Promise.resolve(PAGES[relPath]) : Promise.reject(new Error('no such path'));
const opts = { localePreference: ['be', 'en'] };

// 1. The paid preview: canon facts from the route document, every stop
// locked by the route tariff, free_stop_count shown (AC1, AC2).
const paid = await loadPreview({ loader, sha256 }, opts, 'guide-route-a1', null);
if (paid.kind !== 'ready') throw new Error('expected the ready paid preview');
const p = paid.preview;
console.log(
  `preview guide-route-a1 access=${p.access} route=${p.routeAccess} free_stops=${p.freeStopCount}` +
    ` stops=${p.stops.length} locked=${p.stops.filter((stop) => stop.locked).length}` +
    ` size_mb=${Math.round(p.baseSizeBytes / 1048576)} duration_min=${p.durationMin}`,
);
for (const stop of p.stops) {
  console.log(`  stop ${stop.stopId} locked=${stop.locked} name=${stop.name}`);
}

// 2. The free preview: the extended stop locked, the base stop open (NAV5).
const free = await loadPreview({ loader, sha256 }, opts, 'guide-route-b1', null);
if (free.kind !== 'ready') throw new Error('expected the ready free preview');
const f = free.preview;
console.log(
  `preview guide-route-b1 access=${f.access} route=${f.routeAccess}` +
    ` stops=${f.stops.length} locked=${f.stops.filter((stop) => stop.locked).length}`,
);
for (const stop of f.stops) {
  console.log(`  stop ${stop.stopId} locked=${stop.locked} name=${stop.name ?? `Кропка ${stop.position + 1}`}`);
}
console.log(`state=ready degraded=${paid.degraded}`);
