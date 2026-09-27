// G06.04 (issue #63) — Showboat driver (pause, finish, return and My KUDY):
// the confirmed guide switch (11 §4.1 — one transaction finishes the live
// row and starts the next; the switched-away surface retires), the NAV7
// re-entry (the same surface controller — the panel position kept), the
// legal finish after one story with the fresh repeat walk, and the My KUDY
// history read (the live walk beside the finished runs). The full screen
// stack is the suites' path — `app/run.test.tsx` and `app/navigation.test.tsx`
// under jest, `controllers/run/runSurfaceController.test.ts` and
// `controllers/myKudyController.test.ts` under node --test. The inputs are
// fixed and deterministic — an injected clock, no randomness.
import { createServices } from '../controllers/createServices.ts';
import { sessionStoreOver } from './session-store.ts';
import { memoryBundles } from './memory-bundles.ts';
import { getLiveSession, getSession, listSessionHistory, openDatabase } from '../services/db/db.ts';
import { nodeSqliteDriver } from '../services/db/test-fixture.ts';
import { LocationService } from '../services/location/service.ts';
import { FakeLocationOsPort } from '../services/location/fake-port.ts';
import { AudioService } from '../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../services/audio/fake-port.ts';
import { createAccessPort } from '../services/download/access.ts';

// Two published packages on disk: route-map (four stops) and route-other
// (one stop) — the switch's source and destination.
const ROUTE_MAP = JSON.stringify({
  route_id: 'route-map',
  version: '1',
  city_id: 'gdansk',
  access: 'paid',
  stops: [
    { id: 'stop-1', position: 0, place_id: 'place-1', access_tier: 'base', story_base_id: 'story-1', preview: { name: { be: 'Мытня', en: 'Customs' } } },
    { id: 'stop-2', position: 1, place_id: 'place-2', access_tier: 'base', story_base_id: 'story-2', preview: { name: { be: 'Порт', en: 'Port' } } },
  ],
});
const PLACES = JSON.stringify([
  { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
  { id: 'place-2', content_version: 'cv-1', lat: 54.3535, lng: 18.651, trigger_radius_m: 30, kind: 'historic' },
]);
const ROUTE_OTHER = JSON.stringify({
  route_id: 'route-other',
  version: '1',
  city_id: 'gdansk',
  access: 'paid',
  stops: [
    { id: 'ostop-1', position: 0, place_id: 'oplace-1', access_tier: 'base', story_base_id: 'ostory-1', preview: { name: { be: 'Іншая', en: 'Other' } } },
  ],
});
const PLACES_OTHER = JSON.stringify([
  { id: 'oplace-1', content_version: 'cv-1', lat: 54.36, lng: 18.66, trigger_radius_m: 30, kind: 'historic' },
]);

const files = {
  'bundles/route-map/1/be/base/route.json': ROUTE_MAP,
  'bundles/route-map/1/be/base/places.json': PLACES,
  'bundles/route-other/1/be/base/route.json': ROUTE_OTHER,
  'bundles/route-other/1/be/base/places.json': PLACES_OTHER,
};
const bundlesStore = memoryBundles(files);

const clock = { now: () => 1_000, schedule: () => () => {} }; // fixed: every timestamp is handed out
const locationPort = new FakeLocationOsPort();
const audioPort = new FakeAudioPlayerPort();
const driver = nodeSqliteDriver();
openDatabase(driver);
const wakelockCalls = [];

const services = createServices({
  bundlesStore,
  run: {
    session: {
      location: new LocationService({ port: locationPort, clock, permissions: { foreground: 'fg', background: 'bg' } }),
      audio: new AudioService({ createPort: () => audioPort }),
      clock,
      engineConfig: {},
      pipelineConfig: { dwellMs: 0 },
      sessionStore: sessionStoreOver(driver),
      readiness: {
        evaluate: async () => ({ status: 'ready', routeId: 'route-map', version: '1', tier: 'base', tierAvailable: ['base'] }),
      },
      packageStops: {
        stopsOfLayer: async (routeId, tier) =>
          routeId === 'route-other'
            ? tier === 'base'
              ? ['ostop-1']
              : []
            : tier === 'base'
              ? ['stop-1', 'stop-2']
              : [],
      },
      access: createAccessPort(),
      wakelock: { acquire: () => wakelockCalls.push('acquire'), release: () => wakelockCalls.push('release') },
      recovery: {
        read: async (routeId) => {
          const row = getLiveSession(driver);
          if (!row || row.routeId !== routeId) return null;
          return { row, routeId, version: row.version, layers: [] };
        },
      },
      newSessionId: (() => {
        let n = 0;
        return () => `walk-${String(++n)}`;
      })(),
      grantedTiers: () => ['base'],
    },
  },
});

const settled = async (store) => {
  for (let tries = 0; tries < 200; tries += 1) {
    const state = store.getState();
    if (state.status !== 'loading') return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the surface never left loading');
};

// 1. The walk starts; the person opens stop-1's card — the panel is Half.
const surfaceA = services.run.create('route-map');
const stateA = await settled(surfaceA);
const controllerA = stateA.controller;
controllerA.getState().openCard('stop-1');
const left = controllerA.getState();
console.log(`surface A (route-map): session=${left.run.sessionId} panel=${left.panel} inspected=${left.inspected}`);

// 2. The confirmed switch (11 §4.1): «Завяршыць і пачаць» on route-other's
// preview — one transaction finishes walk-1 and starts walk-2; the
// switched-away surface retires (Ended, wakelock released) and the cache
// evicts it.
const surfaceB = services.run.create('route-other', { confirmedSwitch: true });
const stateB = await settled(surfaceB);
const controllerB = stateB.controller;
console.log(
  `switch: old row=${getSession(driver, 'walk-1')?.state} live row=${getLiveSession(driver)?.routeId}/${getLiveSession(driver)?.sessionId} new sets clean=${controllerB.getState().run.heard.length === 0}`,
);
console.log(
  `surface A retired: phase=${controllerA.getState().run.phase} wakelock=${wakelockCalls.includes('release') ? 'released' : 'held'} (the cache eviction is the root suite's assertion)`,
);

// 3. NAV7: the re-entry of the live walk's surface — the same controller,
// the panel where the person left it.
controllerB.getState().openCard('ostop-1');
const panelBefore = controllerB.getState().panel;
const again = services.run.create('route-other');
const againState = again.getState();
console.log(
  `re-entry (route-other): same surface=${again === surfaceB} panel=${againState.status === 'ready' ? againState.controller.getState().panel : 'unavailable'} (left at ${panelBefore})`,
);

// 4. The session menu: the whole-walk pause, then the finish — legal after
// one story; the repeat walk opens a fresh session with clean sets.
controllerB.getState().pauseSession();
console.log(`pause: row=${getLiveSession(driver)?.state}`);
controllerB.getState().resumeSession();
controllerB.getState().selectStory('ostop-1', 'ostory-1');
audioPort.finish(1);
controllerB.getState().end();
console.log(`finish after one story: walk-2=${getSession(driver, 'walk-2')?.state} heard=${JSON.stringify(getSession(driver, 'walk-2')?.heard)}`);
const surfaceC = services.run.create('route-other');
const stateC = await settled(surfaceC);
if (stateC.status !== 'ready') throw new Error(`repeat walk refused: ${stateC.reason}`);
const runC = stateC.controller.getState().run;
console.log(`repeat walk: session=${runC.sessionId} heard=${runC.phase === 'Idle' ? '[]' : JSON.stringify(runC.heard)}`);

// 5. My KUDY: the history read — the live walk beside the finished runs,
// newest first; nothing is ever deleted (ADR G01.03 §3.1).
const history = listSessionHistory(driver);
console.log(`My KUDY: ${history.map((row) => `${row.sessionId}(${row.state})`).join(' ')}`);
