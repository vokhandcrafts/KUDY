# G15.01 — pure discovery selector: exact vs labeled alternatives

*2026-09-21T00:07:30Z by Showboat 0.6.1*
<!-- showboat-id: 8ca8551e-aed2-4d45-bf7a-151428b53b8b -->

The pure selector on the validated G01.06 index (fixtures/discovery-contract/). Criteria 1–2: at 60 minutes the [45,75] paid guide leaves exact and is labeled over_time; at 120 it is exact first by editorial_order. Zero exact stays zero — the unknown-duration place is an explicitly labeled alternative, never a silent widening.

```sh
node --experimental-strip-types -e "
const { selectDiscovery } = await import('./core/discovery/selectDiscovery.ts');
const fs = await import('node:fs');
const index = JSON.parse(fs.readFileSync('fixtures/discovery-contract/index-valid.json', 'utf8'));
const at60 = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'] });
console.log('exact@60 :', at60.exact.map((m) => m.offer_id).join(', '));
console.log('b1@60    :', JSON.stringify(at60.alternatives.find((m) => m.offer_id === 'offer-b1-guide')));
const at120 = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', max_minutes: 120, theme_ids: ['theme-history'] });
console.log('exact@120:', at120.exact.map((m) => m.offer_id).join(', '));
" 2>/dev/null
```

```output
exact@60 : offer-a1-place, offer-g1-place, offer-h1-place
b1@60    : {"offer_id":"offer-b1-guide","reasons":["editorial","theme_match"],"differences":["over_time"]}
exact@120: offer-b1-guide, offer-a1-place, offer-f1-collection, offer-g1-place, offer-h1-place
```

Criteria 3–4 and 5: wrong city and unknown content locale are excluded even from alternatives; explicit autumn separates season_unassessed from season_not_recommended while the one recommended offer stays exact alone; the same input returns deep-equal output twice.

```sh
node --experimental-strip-types -e "
const { selectDiscovery } = await import('./core/discovery/selectDiscovery.ts');
const fs = await import('node:fs');
const index = JSON.parse(fs.readFileSync('fixtures/discovery-contract/index-valid.json', 'utf8'));
const autumn = { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'], preferred_season: 'autumn' };
const r = selectDiscovery(index, autumn);
console.log('exact@autumn      :', r.exact.map((m) => m.offer_id).join(', '));
const label = (id) => { const m = r.alternatives.find((x) => x.offer_id === id); return m ? m.differences.join(',') : 'absent'; };
console.log('g1 (no season)    :', label('offer-g1-place'));
console.log('a1 (summer only)  :', label('offer-a1-place'));
const en = selectDiscovery(index, { city_id: 'city-a', content_locale: 'be', theme_ids: ['theme-architecture'] });
const shown = [...en.exact, ...en.alternatives].some((m) => m.offer_id === 'offer-e1-place');
console.log('en-only e1 shown  :', shown);
console.log('deterministic     :', JSON.stringify(selectDiscovery(index, autumn)) === JSON.stringify(selectDiscovery(index, autumn)));
" 2>/dev/null
```

```output
exact@autumn      : offer-h1-place
g1 (no season)    : season_unassessed
a1 (summer only)  : season_not_recommended
en-only e1 shown  : false
deterministic     : true
```

Step-4 immutability proofs: rewriting every access flag to free and injecting a hypothetical score field both leave the result byte-identical for every accepted criteria case — paid does not boost rank and no ratings input exists.

```sh
node --experimental-strip-types -e "
const { selectDiscovery } = await import('./core/discovery/selectDiscovery.ts');
const fs = await import('node:fs');
const index = JSON.parse(fs.readFileSync('fixtures/discovery-contract/index-valid.json', 'utf8'));
const crits = [
  { id: 'A', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'] } },
  { id: 'B-over', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'] } },
  { id: 'B-exact', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 120, theme_ids: ['theme-history'] } },
  { id: 'C', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-sea'] } },
  { id: 'G', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'], preferred_season: 'autumn' } },
  { id: 'H', c: { city_id: 'city-a', content_locale: 'be', max_minutes: 60, theme_ids: ['theme-history'], preferred_season: 'autumn' } },
];
const allFree = { ...index, offers: index.offers.map((o) => ({ ...o, access: 'free' })) };
const scored = { ...index, offers: index.offers.map((o) => ({ ...o, hypothetical_score: 5, rating: 4.9 })) };
for (const { id, c } of crits) {
  const base = JSON.stringify(selectDiscovery(index, c));
  console.log(id.padEnd(8), 'access-blind:', base === JSON.stringify(selectDiscovery(allFree, c)), ' score-blind:', base === JSON.stringify(selectDiscovery(scored, c)));
}
" 2>/dev/null
```

```output
A        access-blind: true  score-blind: true
B-over   access-blind: true  score-blind: true
B-exact  access-blind: true  score-blind: true
C        access-blind: true  score-blind: true
G        access-blind: true  score-blind: true
H        access-blind: true  score-blind: true
```
