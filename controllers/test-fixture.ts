// The synthetic free package (route-491@1, be, base) shared by the
// controllers suites: one canonical restatement of the contract shapes
// (implementation-rules 2) instead of per-file copies. The layer documents
// mirror the run suites' world fixtures and the contentRepo sample package
// — the same field names the contracts own.
export const enc = (text: string) => new TextEncoder().encode(text);

export const ROUTE_JSON = JSON.stringify({
  route_id: 'route-491',
  version: '1',
  city_id: 'city-491',
  access: 'free_base',
  stops: [
    {
      id: 'stop-1',
      position: 0,
      place_id: 'place-1',
      access_tier: 'base',
      story_base_id: 'story-1',
      preview: { name: { be: 'Брама' } },
    },
  ],
});
export const PLACES_JSON = JSON.stringify([
  { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
]);
