// G06.02 (issue #278) — Showboat driver (the run map's marker model): the
// pure runMapView over scripted engine states renders the five marker states
// of ADR G01.01 §4.5, the POI point beside them and the BE/EN words. The
// states here mirror the acceptance suite's moves (the full stack over the
// composition root is the node/jest suites' path); the inputs are fixed and
// deterministic — no clocks, no randomness.
import { runMapView, runMapStrings } from './runMap.ts';

const STOPS = [
  { stopId: 'stop-1', lat: 54.352, lng: 18.648, radius: 30, storyBaseId: 'story-1' },
  { stopId: 'stop-2', lat: 54.3535, lng: 18.651, radius: 30, storyBaseId: 'story-2' },
  { stopId: 'stop-3', lat: 54.3548, lng: 18.654, radius: 30, storyExtendedId: 'story-3' },
  { stopId: 'stop-4', lat: 54.35, lng: 18.6475, radius: 25, storyBaseId: 'story-4' },
];
const FACTS = [
  { stopId: 'stop-1', placeId: 'place-1', storyBaseId: 'story-1', name: { be: 'Мытня', en: 'Customs' } },
  { stopId: 'stop-2', placeId: 'place-2', storyBaseId: 'story-2', name: { be: 'Порт', en: 'Port' } },
  { stopId: 'stop-3', placeId: 'place-3', storyExtendedId: 'story-3', name: { be: 'Вежа', en: 'Tower' } },
  { stopId: 'stop-4', placeId: 'place-4', storyBaseId: 'story-4', name: { be: 'Плошча', en: 'Square' } },
];
const PLACES = [
  { placeId: 'place-1', lat: 54.352, lng: 18.648, radius: 30, kind: 'historic' },
  { placeId: 'place-2', lat: 54.3535, lng: 18.651, radius: 30, kind: 'historic' },
  { placeId: 'place-3', lat: 54.3548, lng: 18.654, radius: 30, kind: 'viewpoint' },
  { placeId: 'place-4', lat: 54.35, lng: 18.6475, radius: 25, kind: 'square' },
  { placeId: 'place-9', lat: 54.3512, lng: 18.6498, radius: 10, kind: 'cafe' },
];

const session = (overrides) => ({
  phase: 'Active',
  sessionId: 'walk-1',
  routeId: 'route-map',
  version: '1',
  locale: 'be',
  tier: ['base'],
  stops: STOPS.map(({ stopId, storyBaseId, storyExtendedId }) => ({ stopId, storyBaseId, storyExtendedId })),
  accessibleStopIds: ['stop-1', 'stop-2', 'stop-4'],
  tierAvailable: ['base'],
  heard: [],
  autoFired: [],
  playing: null,
  queued: null,
  autoplaySuspended: false,
  lastFix: null,
  focusLostAt: null,
  playSeq: 0,
  ...overrides,
});

const line = (name, view) =>
  console.log(`${name}: ${view.markers.map((m) => `${m.stopId}=${m.status}`).join(' ')} poi=${view.pois.map((p) => `${p.placeId}:${p.kind}`).join(',') || '-'}`);

// Fresh base walk: everything pending, the paid-only stop locked.
line('fresh', runMapView(session(), STOPS, FACTS, PLACES, ['be']));
// The accepted physical end of stop-1's own launch: played, for good.
line('after AudioFinished', runMapView(session({ heard: ['story-1'], playSeq: 1 }), STOPS, FACTS, PLACES, ['be']));
// The autoplay at stop-2: the launch is audible — playing.
line('autoplay', runMapView(
  session({ heard: ['story-1'], autoFired: ['stop-2'], playing: { owner: 'guide', stopId: 'stop-2', storyId: 'story-2', playId: 2, paused: false }, playSeq: 2 }),
  STOPS,
  FACTS,
  PLACES,
  ['be'],
));
// The focus loss keeps the launch but the marker follows the audible state.
line('focus loss', runMapView(
  session({ heard: ['story-1'], autoFired: ['stop-2'], playing: { owner: 'guide', stopId: 'stop-2', storyId: 'story-2', playId: 2, paused: true }, playSeq: 2 }),
  STOPS,
  FACTS,
  PLACES,
  ['be'],
));
// The five state words in both display locales (the walk's locale decides).
for (const locale of ['be', 'en']) {
  const words = runMapStrings(locale).status;
  console.log(`${locale}: ${['playing', 'played', 'available', 'pending', 'locked'].map((s) => `${s}=${words[s]}`).join(' ')}`);
}
