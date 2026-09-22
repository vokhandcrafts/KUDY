// Generates data/selection-outcomes.json — the deterministic discovery
// results the browser prototype renders for every selector combination.
// Computed by the REAL selector over the accepted fixture copy, so the UI
// never re-implements selection (a second implementation would drift).
// The output is generated data: it is gitignored and regenerated here.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectDiscovery } from '../../../core/discovery/selectDiscovery.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(path.join(here, '../data/discovery-index.json'), 'utf8'));
const times = [30, 60, 120];
const themes = ['theme-history', 'theme-sea', 'theme-architecture'];
const themeSets = []; // every subset the selector UI can produce
for (let mask = 0; mask < 1 << themes.length; mask++)
  themeSets.push(themes.filter((_, i) => mask & (1 << i)));
const seasons = [undefined, 'spring', 'summer', 'autumn', 'winter'];

const outcomes = {};
for (const max_minutes of times)
  for (const theme_ids of themeSets)
    for (const preferred_season of seasons) {
      const criteria = { city_id: 'city-a', content_locale: 'be', max_minutes, theme_ids };
      if (preferred_season) criteria.preferred_season = preferred_season;
      const key = JSON.stringify([max_minutes, theme_ids, preferred_season ?? 'any']);
      outcomes[key] = selectDiscovery(index, criteria);
    }

const out = path.join(here, '../data/selection-outcomes.json');
writeFileSync(out, JSON.stringify(outcomes, null, 1) + '\n');
console.log(`selection-outcomes.json: ${Object.keys(outcomes).length} combinations`);
