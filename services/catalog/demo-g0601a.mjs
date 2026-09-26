// G06.01.a (issue #313) — Showboat driver: the production catalog service
// over the published fixtures (fixtures/discovery-contract — the pair whose
// pointer pins the index by bytes and sha256), then the honest states of
// 21 §3.3: index degradation, offline over the last valid cache and the
// no-cache failure. Deterministic: fixed inputs, no clocks, no randomness.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadCatalog } from './catalogService.ts';

const FIXTURES = new URL('../../fixtures/discovery-contract/', import.meta.url);
const CATALOG = readFileSync(new URL('catalog-with-discovery.json', FIXTURES), 'utf8');
const INDEX = readFileSync(new URL('index-valid.json', FIXTURES), 'utf8');
const POINTER_PATH = 'discovery/city-a/r-2026-09-14-1/index.json';

const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const loader = (relPath) =>
  relPath === 'catalog.json'
    ? Promise.resolve(CATALOG)
    : relPath === POINTER_PATH
      ? Promise.resolve(INDEX)
      : Promise.reject(new Error('no such path'));
const opts = { localePreference: ['be', 'en'] };

// 1. The published city: the guide offer and the route-only entry, canon
// order (editorial_order, then offer_id; route-only tail by route_id).
const ready = await loadCatalog({ loader, sha256 }, opts, null);
for (const card of ready.guides) {
  const locales = card.localesKnown
    ? `text=${card.textLocales.join(',')} audio=${card.audioLocales.join(',')}`
    : `layers=${card.textLocales.join(',')}`;
  console.log(
    `card ${card.routeId} v${card.version} access=${card.access} order=${card.editorialOrder ?? '-'} ${locales} title="${card.title}"`,
  );
}
console.log(`state=ready degraded=${ready.degraded}`);

// 2. The index unreachable — the route entries still render, honestly
// degraded (21 §3.3: a corrupt or missing index never blocks ordinary guides).
const degraded = await loadCatalog(
  { loader: (relPath) => (relPath === 'catalog.json' ? Promise.resolve(CATALOG) : Promise.reject(new Error('index down'))), sha256 },
  opts,
  null,
);
console.log(`state=${degraded.kind} degraded=${degraded.degraded} guides=${degraded.guides.length}`);

// 3. The catalog down with a previous result — offline over the last valid
// cache (09 §4); with no previous result — the honest error.
const offline = await loadCatalog({ loader: () => Promise.reject(new Error('network down')), sha256 }, opts, ready.guides);
console.log(`state=${offline.kind} reason=${JSON.stringify(offline.reason)} guides=${offline.guides.length}`);
const fresh = await loadCatalog({ loader: () => Promise.reject(new Error('network down')), sha256 }, opts, null);
console.log(`state=${fresh.kind} reason=${JSON.stringify(fresh.reason)}`);
