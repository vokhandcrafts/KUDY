// G06.02 (issue #278) — acceptance tests of the run surface controller over
// the real composition root (createServices): the pinned-package read (the
// live row's pin wins, the single on-disk version otherwise), the
// stops×places join, the walk's open (recover, else start) and the five
// marker states the map view derives from the engine's stopStatus. Real
// orchestrator, pipeline, reducer and both services over fake OS ports, the
// real services/db over the node:sqlite adapter — the AC4 path: everything
// the screen sees enters through the root's run member, nothing through a
// second owner.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createServices } from '../createServices.ts';
import type { BundlesStore, Tier } from '../../services/contentRepo/types.ts';
import type { RunSessionPorts, RunSurfaceState } from './runSurfaceController.ts';
import type { RunControllerState } from '../useRunController.ts';
import type {
  RunPackageStops,
  RunReadiness,
  RunRecovery,
  RunRecoveryLayer,
  RunRecoveryPayload,
  RunWakelock,
} from '../useRunController.ts';
import { sessionStoreOver } from '../../test/session-store.ts';
import type { ControllerStore } from '../createControllerStore.ts';
import { defaultEngineConfig } from '../../core/engine/reducer.ts';
import { runMapView, runMapStrings } from './runMap.ts';
import { LocationService } from '../../services/location/service.ts';
import { FakeLocationOsPort } from '../../services/location/fake-port.ts';
import { AudioService } from '../../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../../services/audio/fake-port.ts';
import { createAccessPort } from '../../services/download/access.ts';
import {
  finishSession,
  getLiveSession,
  getSession,
  openDatabase,
  pauseSession,
  resumeSession,
  startSession,
} from '../../services/db/db.ts';
import { nodeSqliteDriver } from '../../services/db/test-fixture.ts';
import { memoryBundles } from '../../test/memory-bundles.ts';
import { readMomentFacts } from '../../services/contentRepo/momentFacts.ts';
import type { SqlDriver } from '../../services/db/types.ts';

// The synthetic pinned package: route-map@1, be, paid. Four stops — stop-1
// and stop-2 base, stop-3 paid-only extended (locked for a base walk), stop-4
// base far away (stays pending) — and one place no stop references (the cafe
// POI).
const ROUTE_JSON = JSON.stringify({
  route_id: 'route-map',
  version: '1',
  city_id: 'gdansk',
  access: 'paid',
  stops: [
    {
      id: 'stop-1',
      position: 0,
      place_id: 'place-1',
      access_tier: 'base',
      story_base_id: 'story-1',
      preview: { name: { be: 'Мытня', en: 'Customs' } },
    },
    {
      id: 'stop-2',
      position: 1,
      place_id: 'place-2',
      access_tier: 'base',
      story_base_id: 'story-2',
      preview: { name: { be: 'Порт', en: 'Port' } },
    },
    {
      id: 'stop-3',
      position: 2,
      place_id: 'place-3',
      access_tier: 'extended',
      story_extended_id: 'story-3',
      preview: { name: { be: 'Вежа', en: 'Tower' } },
    },
    {
      id: 'stop-4',
      position: 3,
      place_id: 'place-4',
      access_tier: 'base',
      story_base_id: 'story-4',
      preview: { name: { be: 'Плошча', en: 'Square' } },
    },
  ],
});
const PLACES_JSON = JSON.stringify([
  { id: 'place-1', content_version: 'cv-1', lat: 54.352, lng: 18.648, trigger_radius_m: 30, kind: 'historic' },
  { id: 'place-2', content_version: 'cv-1', lat: 54.3535, lng: 18.651, trigger_radius_m: 30, kind: 'historic' },
  { id: 'place-3', content_version: 'cv-1', lat: 54.3548, lng: 18.654, trigger_radius_m: 30, kind: 'viewpoint' },
  { id: 'place-4', content_version: 'cv-1', lat: 54.35, lng: 18.6475, trigger_radius_m: 25, kind: 'square' },
  { id: 'place-9', content_version: 'cv-1', lat: 54.3512, lng: 18.6498, trigger_radius_m: 10, kind: 'cafe' },
]);
const LAYER = 'bundles/route-map/1/be/base';
const DEFAULT_FILES: Record<string, string> = {
  [`${LAYER}/route.json`]: ROUTE_JSON,
  [`${LAYER}/places.json`]: PLACES_JSON,
};
const BASE_STOP_IDS = ['stop-1', 'stop-2', 'stop-4'];

// G06.04 (issue #63) — the second guide's package: the confirmed switch's
// destination, one base stop of its own.
const ROUTE_OTHER_JSON = JSON.stringify({
  route_id: 'route-other',
  version: '1',
  city_id: 'gdansk',
  access: 'paid',
  stops: [
    {
      id: 'ostop-1',
      position: 0,
      place_id: 'oplace-1',
      access_tier: 'base',
      story_base_id: 'ostory-1',
      preview: { name: { be: 'Іншая', en: 'Other' } },
    },
  ],
});
const PLACES_OTHER_JSON = JSON.stringify([
  { id: 'oplace-1', content_version: 'cv-1', lat: 54.36, lng: 18.66, trigger_radius_m: 30, kind: 'historic' },
]);
const OTHER_LAYER = 'bundles/route-other/1/be/base';

// The injected clock — the controller must not read a wall clock (G05.05
// criterion 6); every timestamp in these scenarios is a handed-out number.
const manualClock = () => {
  let ms = 0;
  return {
    now: () => ms,
    set: (value: number) => {
      ms = value;
    },
    schedule: () => () => {},
  };
};

interface World {
  services: ReturnType<typeof createServices>;
  locationPort: FakeLocationOsPort;
  audioPort: FakeAudioPlayerPort;
  clock: ReturnType<typeof manualClock>;
  driver: SqlDriver;
  granted: Tier[];
  files: Record<string, string>;
  wakelockCalls: string[];
  // The world's session ports, kept for restart scenarios: a new
  // composition root over the same ports models the app restart — the
  // durable row survives, the in-memory surface cache does not.
  session: RunSessionPorts;
}

// The store port over the real services/db public API — the shared
// controllers/test-session-store.ts (the composition root's wiring).

// The read-only restart-recovery view over the real db: the live row plus the
// recorded layers' stop records from the same pinned facts the map reads —
// the shape the composition root assembles from route.json + places.json.
function recoveryPortOver(driver: SqlDriver): RunRecovery {
  const places = JSON.parse(PLACES_JSON) as Array<{
    id: string;
    lat: number;
    lng: number;
    trigger_radius_m: number;
  }>;
  const route = JSON.parse(ROUTE_JSON) as {
    stops: Array<{ id: string; place_id: string; access_tier: string; story_base_id?: string; story_extended_id?: string }>;
  };
  const geometry = new Map(places.map((place) => [place.id, place]));
  const stopsOfTier = (tier: Tier) =>
    route.stops
      .filter((stop) => stop.access_tier === tier && (tier === 'base' ? BASE_STOP_IDS.includes(stop.id) : true))
      .map((stop) => {
        const place = geometry.get(stop.place_id);
        if (!place) throw new Error(`fixture: stop ${stop.id} has no place`);
        return {
          stopId: stop.id,
          lat: place.lat,
          lng: place.lng,
          radius: place.trigger_radius_m,
          storyBaseId: stop.story_base_id,
          storyExtendedId: stop.story_extended_id,
        };
      });
  return {
    read: async (routeId) => {
      const row = getLiveSession(driver);
      if (!row || row.routeId !== routeId) return null;
      const layers: RunRecoveryLayer[] = row.tier
        .filter((value): value is Tier => value === 'base' || value === 'extended')
        .map((tier) => ({ tier, status: 'ready' as const, stops: stopsOfTier(tier) }));
      const payload: RunRecoveryPayload = { row, routeId, version: row.version, layers };
      return payload;
    },
  };
}

function mapWorld(files: Record<string, string> = DEFAULT_FILES): World {
  // An owned copy: a scenario mutating the disk truth must not leak into the
  // module-level default fixture of the later worlds.
  const owned = { ...files };
  const clock = manualClock();
  const locationPort = new FakeLocationOsPort();
  const audioPort = new FakeAudioPlayerPort();
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const granted: Tier[] = ['base'];
  const readiness: RunReadiness = {
    evaluate: async () =>
      granted.includes('base')
        ? { status: 'ready', routeId: 'route-map', version: '1', tier: 'base', tierAvailable: [...granted] }
        : { status: 'access-locked', tier: 'base' },
  };
  const packageStops: RunPackageStops = {
    stopsOfLayer: async (routeId, tier) =>
      routeId === 'route-other'
        ? tier === 'base'
          ? ['ostop-1']
          : []
        : tier === 'base'
          ? [...BASE_STOP_IDS]
          : tier === 'extended'
            ? ['stop-3']
            : [],
  };
  const wakelockCalls: string[] = [];
  const session: RunSessionPorts = {
    location: new LocationService({ port: locationPort, clock, permissions: { foreground: 'fg', background: 'bg' } }),
    audio: new AudioService({ createPort: () => audioPort }),
    clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    sessionStore: sessionStoreOver(driver),
    readiness,
    packageStops,
    access: createAccessPort(),
    wakelock: {
      acquire: () => wakelockCalls.push('acquire'),
      release: () => wakelockCalls.push('release'),
    },
    recovery: recoveryPortOver(driver),
    newSessionId: (() => {
      let n = 0;
      return () => `walk-${String(++n)}`;
    })(),
    grantedTiers: () => granted,
  };
  // G07.03 — the ONE audio instance the root owns (ADR G01.02 §3: the same
  // instance the run sessions hold) and the manual clock the moment
  // controller's FocusRegain threshold reads; without them the root
  // constructs no moment controller and the place card has no Play.
  const services = createServices({
    bundlesStore: memoryBundles(owned),
    run: { session },
    audio: session.audio,
    now: () => clock.now(),
  });
  return { services, locationPort, audioPort, clock, driver, granted, files: owned, wakelockCalls, session };
}

const settled = (store: ControllerStore<RunSurfaceState>): Promise<Exclude<RunSurfaceState, { status: 'loading' }>> =>
  new Promise((resolve, reject) => {
    let tries = 0;
    const poll = () => {
      const state = store.getState();
      if (state.status !== 'loading') {
        resolve(state);
        return;
      }
      if (++tries > 200) {
        reject(new Error('the surface never left loading'));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });

const openSurface = async (world: World, routeId = 'route-map') => {
  const store = world.services.run?.create(routeId);
  if (!store) throw new Error('the root constructed no run member');
  return { store, state: await settled(store) };
};

const fixAt = (world: World, lat: number, lng: number, startMs: number): void => {
  const starts = world.locationPort.commands.filter((command) => command.startsWith('start '));
  const subscription = Number(starts[starts.length - 1].slice('start '.length));
  for (const offset of [0, 1_000, 2_000]) {
    world.clock.set(startMs + offset);
    world.locationPort.emitFix(subscription, { lat, lng, accuracy: 5, at: world.clock.now() });
  }
};

test('AC1: a fresh walk renders all five marker states from the engine', async () => {
  const world = mapWorld();
  const { state } = await openSurface(world);
  assert.equal(state.status, 'ready');
  const controller = state.controller;
  const run = controller.getState().run;
  assert.equal(run.phase, 'Active');
  // The session holds the whole package's stop list; the seed is the base set.
  assert.deepEqual(
    run.stops.map((stop) => stop.stopId),
    ['stop-1', 'stop-2', 'stop-3', 'stop-4'],
  );

  const view = () => runMapView(controller.getState().run, state.stops, state.facts, state.places, ['be']);
  // pending … pending, the paid-only stop locked (a base walk, no grant).
  assert.deepEqual(
    view().markers.map((marker) => [marker.stopId, marker.status]),
    [
      ['stop-1', 'pending'],
      ['stop-2', 'pending'],
      ['stop-3', 'locked'],
      ['stop-4', 'pending'],
    ],
  );
  // The POI: the place no route stop references, visually its own kind.
  assert.deepEqual(view().pois.map((poi) => [poi.placeId, poi.kind]), [['place-9', 'cafe']]);
  // The names come from the package's preview in the walk's locale.
  assert.deepEqual(
    view().markers.map((marker) => marker.name),
    ['Мытня', 'Порт', 'Вежа', 'Плошча'],
  );

  // playing: the manual pick.
  controller.getState().selectStop('stop-1');
  assert.equal(view().markers.find((marker) => marker.stopId === 'stop-1')?.status, 'playing');
  // played: only the accepted physical end of the walk's own launch.
  world.audioPort.finish(1);
  assert.equal(view().markers.find((marker) => marker.stopId === 'stop-1')?.status, 'played');
  // available: the autoplay at stop-2 fires (auto_fired), then the manual
  // stop keeps manual access without heard credit.
  fixAt(world, 54.3535, 18.651, 10_000);
  assert.equal(view().markers.find((marker) => marker.stopId === 'stop-2')?.status, 'playing');
  controller.getState().stopAudio();
  assert.equal(view().markers.find((marker) => marker.stopId === 'stop-2')?.status, 'available');
  assert.deepEqual(
    view().markers.map((marker) => [marker.stopId, marker.status]),
    [
      ['stop-1', 'played'],
      ['stop-2', 'available'],
      ['stop-3', 'locked'],
      ['stop-4', 'pending'],
    ],
  );
  // The five state words exist in both display locales (the map's own guard).
  for (const locale of ['be', 'en'] as const) {
    assert.deepEqual(Object.keys(runMapStrings(locale).status).sort(), [
      'available',
      'locked',
      'pending',
      'played',
      'playing',
    ]);
  }
});

test('AC1: the walk restores from the live row — paused, nothing sounds, no second Start', async () => {
  const world = mapWorld();
  const first = await openSurface(world);
  if (first.state.status !== 'ready') throw new Error('the first surface never opened');
  const controller = first.state.controller;
  controller.getState().selectStop('stop-1');
  world.audioPort.finish(1);
  fixAt(world, 54.3535, 18.651, 10_000);
  controller.getState().stopAudio();
  controller.getState().pauseSession();
  assert.equal(getLiveSession(world.driver)?.state, 'paused');
  const commandsBefore = world.audioPort.commands.length;

  // The restart: a NEW composition root over the same ports — the durable
  // row survives the process, the surface cache does not. (G06.04 split the
  // two re-openings: the same root's re-entry is the NAV7 cache, a restart
  // is the recovery read.)
  world.files['bundles/route-map/2/be/base/route.json'] = ROUTE_JSON;
  world.files['bundles/route-map/2/be/base/places.json'] = PLACES_JSON;
  const restarted = createServices({ bundlesStore: memoryBundles(world.files), run: { session: world.session } });
  const reopenedStore = restarted.run?.create('route-map');
  if (!reopenedStore) throw new Error('the restarted root constructed no run member');
  const reopened = { store: reopenedStore, state: await settled(reopenedStore) };
  assert.equal(reopened.state.status, 'ready');
  assert.equal(reopened.state.controller.getState().run.phase, 'Paused');
  assert.equal(reopened.state.locale, 'be');
  const view = runMapView(
    reopened.state.controller.getState().run,
    reopened.state.stops,
    reopened.state.facts,
    reopened.state.places,
    ['be'],
  );
  assert.deepEqual(
    view.markers.map((marker) => [marker.stopId, marker.status]),
    [
      ['stop-1', 'played'],
      ['stop-2', 'available'],
      ['stop-4', 'pending'],
    ],
  );
  // The restore invariants: nothing sounds and no session row was added.
  assert.equal(world.audioPort.commands.length, commandsBefore);
  const reopenedRun = reopened.state.controller.getState().run;
  const firstRun = controller.getState().run;
  if (reopenedRun.phase === 'Idle' || firstRun.phase === 'Idle') throw new Error('the walk vanished');
  assert.equal(reopenedRun.sessionId, firstRun.sessionId);
});

test('refusals are named, never guesses', async () => {
  // Nothing downloaded.
  const empty = mapWorld({});
  const refused = await openSurface(empty, 'route-map');
  assert.deepEqual(refused.state, { status: 'unavailable', reason: 'run#package-not-downloaded' });

  // Two versions, no live row — ambiguous, never a guess.
  const ambiguous = mapWorld({
    ...DEFAULT_FILES,
    'bundles/route-map/2/be/base/route.json': ROUTE_JSON,
    'bundles/route-map/2/be/base/places.json': PLACES_JSON,
  });
  const refusedAmbiguous = await openSurface(ambiguous, 'route-map');
  assert.deepEqual(refusedAmbiguous.state, { status: 'unavailable', reason: 'run#package-ambiguous' });

  // A foreign route document (the JSON has no spaces after colons).
  const foreign = mapWorld({
    ...DEFAULT_FILES,
    [`${LAYER}/route.json`]: ROUTE_JSON.replace('"route_id":"route-map"', '"route_id":"route-other"'),
  });
  const refusedForeign = await openSurface(foreign, 'route-map');
  assert.deepEqual(refusedForeign.state, { status: 'unavailable', reason: 'run-map#route-json-identity' });

  // A stop whose place carries no geometry — the join refuses as a whole.
  const unplaced = mapWorld({
    [`${LAYER}/route.json`]: ROUTE_JSON,
    [`${LAYER}/places.json`]: PLACES_JSON.replace('place-2', 'place-x'),
  });
  const refusedUnplaced = await openSurface(unplaced, 'route-map');
  assert.deepEqual(refusedUnplaced.state, { status: 'unavailable', reason: 'run-map#stop-unplaced:stop-2' });

  // Corrupt-input diagnostics (implementation-rules 14), each through the
  // production path: torn JSON, a non-array places document, a null place
  // element, and a malformed stop record.
  const torn = mapWorld({
    ...DEFAULT_FILES,
    [`${LAYER}/route.json`]: '{"route_id":"route-map","version":"1"',
  });
  const refusedTorn = await openSurface(torn, 'route-map');
  assert.deepEqual(refusedTorn.state, { status: 'unavailable', reason: 'run-map#route-json-invalid' });

  const notArrayPlaces = mapWorld({
    ...DEFAULT_FILES,
    [`${LAYER}/places.json`]: '{"id": "place-1"}',
  });
  const refusedPlaces = await openSurface(notArrayPlaces, 'route-map');
  assert.deepEqual(refusedPlaces.state, { status: 'unavailable', reason: 'run-map#places-json-invalid' });

  const nullPlace = mapWorld({
    ...DEFAULT_FILES,
    [`${LAYER}/places.json`]: '[null]',
  });
  const refusedNullPlace = await openSurface(nullPlace, 'route-map');
  assert.deepEqual(refusedNullPlace.state, { status: 'unavailable', reason: 'run-map#places-json-invalid' });

  const badStop = mapWorld({
    ...DEFAULT_FILES,
    [`${LAYER}/route.json`]: ROUTE_JSON.replace('"place_id":"place-2"', '"place_x":"place-2"'),
  });
  const refusedBadStop = await openSurface(badStop, 'route-map');
  assert.deepEqual(refusedBadStop.state, { status: 'unavailable', reason: 'run-map#route-json-stop-invalid' });

  // An unsafe route id never reaches the file system.
  const unsafe = mapWorld();
  const refusedUnsafe = await openSurface(unsafe, '../elsewhere');
  assert.deepEqual(refusedUnsafe.state, { status: 'unavailable', reason: 'run#unsafe-route-id' });

  // The Start gate's refusal surfaces verbatim (no grant → access-locked).
  const notReady = mapWorld();
  notReady.granted.length = 0;
  const refusedStart = await openSurface(notReady);
  assert.deepEqual(refusedStart.state, { status: 'unavailable', reason: 'package-access-locked' });
});

test('BE/EN: the surface locale is the walk pin, the words follow it', async () => {
  const world = mapWorld();
  const { state } = await openSurface(world);
  assert.equal(state.status, 'ready');
  assert.equal(state.locale, 'be');
  assert.equal(runMapStrings('be').status.played, 'праслухана');
  assert.equal(runMapStrings('en').status.played, 'played');
  assert.equal(runMapStrings('fr').status.played, 'праслухана'); // allowlist fallback
  assert.equal(runMapStrings('en').reasonText['package-incomplete'], 'Package incomplete');
  assert.equal(runMapStrings('be').reasonText['package-incomplete'], 'Пакет не поўны');
});

// G06.04 (issue #63) — the run surface cache (NAV7): «Прагулка» returns to
// the same controller, so the panel position and the inspected card are the
// ones the person left behind.
test('G06.04 NAV7: the re-entry reuses the surface — the panel position is the one left behind', async () => {
  const world = mapWorld();
  const first = await openSurface(world);
  assert.equal(first.state.status, 'ready');
  first.state.controller.getState().openCard('stop-1');
  assert.equal(first.state.controller.getState().panel, 'half');
  assert.equal(first.state.controller.getState().inspected, 'stop-1');

  const again = world.services.run?.create('route-map');
  assert.equal(again, first.store); // the same controller, not a rebuild
  const state = again?.getState();
  assert.ok(state && state.status === 'ready');
  assert.equal(state.controller.getState().panel, 'half');
});

// The confirmed switch through the composition root (11 §4.1, ADR G01.03
// §3.3 switch-guide): the live walk of route-map is finished by route-other's
// Start transaction, the switched-away surface is retired (Ended mirror,
// resources released) and evicted — a stale surface never renders.
test('G06.04 criterion 1: the confirmed switch retires the switched-away surface and evicts the cache', async () => {
  const world = mapWorld({
    ...DEFAULT_FILES,
    [`${OTHER_LAYER}/route.json`]: ROUTE_OTHER_JSON,
    [`${OTHER_LAYER}/places.json`]: PLACES_OTHER_JSON,
  });
  const surfaceA = await openSurface(world); // walk-1 live on route-map
  const controllerA = surfaceA.state.status === 'ready' ? surfaceA.state.controller : null;
  assert.ok(controllerA);
  controllerA.getState().openCard('stop-1'); // the position the person left

  const surfaceB = world.services.run?.create('route-other', { confirmedSwitch: true });
  if (!surfaceB) throw new Error('the root constructed no run member');
  const stateB = await settled(surfaceB);
  assert.equal(stateB.status, 'ready');
  const runB = stateB.controller.getState().run;
  assert.ok(runB.phase !== 'Idle');
  // The old walk is history; the new one is the app's live row.
  assert.equal(getLiveSession(world.driver)?.routeId, 'route-other');
  assert.equal(getSession(world.driver, 'walk-1')?.state, 'finished');
  // The switched-away surface: the mirror is Ended, the wakelock released,
  // the next open of route-map is a fresh surface, not the stale one.
  assert.equal(controllerA.getState().run.phase, 'Ended');
  assert.ok(world.wakelockCalls.includes('release'));
  const reopenedA = world.services.run?.create('route-map');
  assert.ok(reopenedA !== undefined && reopenedA !== surfaceA.store);
});

// The repeat walk (11 §4.3): after End the finished walk's surface is
// evicted — the next open starts a NEW session (new session_id, clean sets),
// the finished row stays history.
test('G06.04 criterion 2: after End the cache evicts — the repeat walk opens a fresh session', async () => {
  const world = mapWorld();
  const first = await openSurface(world);
  const controllerA = first.state.status === 'ready' ? first.state.controller : null;
  assert.ok(controllerA);
  const runFirst = controllerA.getState().run;
  assert.ok(runFirst.phase !== 'Idle');
  const firstSessionId = runFirst.sessionId;

  controllerA.getState().end();
  assert.equal(getSession(world.driver, firstSessionId)?.state, 'finished');

  const second = world.services.run?.create('route-map');
  assert.ok(second !== undefined && second !== first.store); // evicted, not reused
  const stateSecond = await settled(second);
  assert.equal(stateSecond.status, 'ready');
  const runSecond = stateSecond.controller.getState().run;
  assert.ok(runSecond.phase !== 'Idle');
  assert.notEqual(runSecond.sessionId, firstSessionId);
  assert.deepEqual(runSecond.heard, []); // clean sets
});

// The refused surface does not stick in the cache (the review's High): a
// Start refusal is not the walk's anchor — when the blocker clears, the
// next open re-resolves instead of serving the cached 'unavailable' forever.
test('G06.04: a refused surface is evicted — the next open re-resolves', async () => {
  const world = mapWorld();
  // The live walk of the other route refuses this route's fresh surface.
  startSession(world.driver, {
    sessionId: 'walk-live',
    routeId: 'route-other',
    version: '1',
    locale: 'be',
    startedAt: 1,
  });
  const refused = await openSurface(world);
  assert.deepEqual(refused.state, { status: 'unavailable', reason: 'live-session-exists' });

  // The blocker clears (the other walk finishes); the same route opens fresh.
  finishSession(world.driver, 'walk-live', { finishedAt: 2 });
  const reopened = await openSurface(world);
  assert.equal(reopened.state.status, 'ready');
  const run = reopened.state.controller.getState().run;
  assert.ok(run.phase !== 'Idle'); // the walk started on the re-open
});

// --- G07.03 (issue #283): Moments during an active Run -----------------------
//
// The place card's explicit Play Moment over a live walk routes through the
// root's session resolver into the live surface's engine — the session and
// its progress survive, one player, one GPS owner (ADR G01.02 §3.4–§3.8, 11
// C38–C45). The world passes the ONE audio instance to the root — the shape
// the device build wires once the G05.03.b adapter lands.

// The place-9 teaser in the pinned package: the manifest sits at the package
// root (09 §3, G03.04 — optional per package), the audio resolves in the
// base layer with the same idiom the engine's PlayStory path uses.
const MOMENT_AUDIO_PATH = `${LAYER}/audio/story-m9.m4a`;
const MOMENT_FILES: Record<string, string> = {
  'bundles/route-map/1/moments.json': JSON.stringify([
    { id: 'moment-9', place_id: 'place-9', story_id: 'story-m9', kind: 'teaser', cooldown_min: 0 },
  ]),
  [MOMENT_AUDIO_PATH]: 'm4a',
  [`${LAYER}/stops.json`]: JSON.stringify([
    {
      story_id: 'story-m9',
      place_id: 'place-9',
      voice_id: 'voice-1',
      tier: 'base',
      duration_s: 30,
      text: 'Тэйзер порта',
      sources: ['с'],
    },
  ]),
};

// The live-walk arrangement the moment scenarios share: the walk started,
// the stop-1 guide launch sounding (the manual pick — deterministic, no
// dwell), the place-9 teaser fact resolved by the production reader.
async function momentWorld(): Promise<{
  world: World;
  surface: ControllerStore<RunSurfaceState>;
  controller: ControllerStore<RunControllerState>;
  teaser: { momentId: string; storyId: string; audioPath: string };
}> {
  const world = mapWorld({ ...DEFAULT_FILES, ...MOMENT_FILES });
  const opened = await openSurface(world);
  if (opened.state.status !== 'ready') throw new Error('the walk surface never opened');
  const controller = opened.state.controller;
  controller.getState().selectStop('stop-1');
  // The physical fact of the sounding guide launch (the fake's scripted
  // snapshot — the port's documented test contract).
  world.audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 60_000 };
  const facts = await readMomentFacts(memoryBundles(world.files), { locales: ['be', 'en'] });
  if (!facts.ok || facts.moments.length !== 1) throw new Error('the fixture offered no teaser');
  const teaser = facts.moments[0];
  if (teaser.audioPath === null) throw new Error('the fixture teaser has no audio path');
  return {
    world,
    surface: opened.store,
    controller,
    teaser: { momentId: teaser.momentId, storyId: teaser.storyId, audioPath: teaser.audioPath },
  };
}

const momentBinding = (world: World): NonNullable<ReturnType<typeof createServices>['moment']> => {
  const binding = world.services.moment;
  if (!binding) throw new Error('the root constructed no moment controller');
  return binding;
};

// The moment-launching scenarios' shared arrangement: the place card's
// explicit Play Moment routed through the root resolver — the production
// path. The caller owns the physical facts and the assertions that follow.
async function routedMomentWorld(): Promise<{
  world: World;
  surface: ControllerStore<RunSurfaceState>;
  controller: ControllerStore<RunControllerState>;
}> {
  const ctx = await momentWorld();
  assert.deepEqual(
    momentBinding(ctx.world).play({ momentId: ctx.teaser.momentId, storyId: ctx.teaser.storyId, path: ctx.teaser.audioPath }),
    { outcome: 'routed' },
  );
  return ctx;
}

test('G07.03 PROOF (AC1): a Play Moment mid-Run keeps the session and its progress; the teaser sounds with its real path', async () => {
  const { world, controller, teaser } = await momentWorld();
  const before = controller.getState().run;
  assert.ok(before.phase === 'Active');
  assert.deepEqual(before.playing, {
    owner: 'guide',
    stopId: 'stop-1',
    storyId: 'story-1',
    playId: 1,
    paused: false,
  });

  // The place card's explicit Play: routed through the root's resolver into
  // the live engine — one transition, the resolved teaser path carried.
  const outcome = momentBinding(world).play({
    momentId: teaser.momentId,
    storyId: teaser.storyId,
    path: teaser.audioPath,
  });
  assert.deepEqual(outcome, { outcome: 'routed' });

  // ONE player: the guide stopped by command, the moment launched with the
  // resolved teaser path. The revert guards: dropping the root resolver
  // replays this play as `moment#session-unroutable`; dropping the path
  // carry replays it as the empty `play 2:`.
  assert.deepEqual(world.audioPort.commands, [
    'play 1:be/base/audio/story-1.m4a',
    'stop',
    `play 2:${MOMENT_AUDIO_PATH}`,
  ]);
  assert.deepEqual(world.audioPort.violations, []);

  // The engine mirror: the moment variant; the interrupted guide story is
  // NOT heard (a command stop is never finished, §3.4); the automation is
  // suspended until «Працягнуць гід»; the session row is the same one.
  const after = controller.getState().run;
  assert.ok(after.phase === 'Active');
  assert.equal(after.sessionId, before.sessionId);
  assert.deepEqual(after.playing, {
    owner: 'moment',
    momentId: 'moment-9',
    storyId: 'story-m9',
    seq: 1,
    paused: false,
  });
  assert.deepEqual(after.heard, before.heard);
  assert.deepEqual(after.autoFired, before.autoFired);
  assert.equal(after.autoplaySuspended, true);
  assert.equal(after.queued, null);
});

test('G07.03 (AC2): a dwell during the moment sounds nothing — no second audio owner, no GPS touch', async () => {
  const { world, controller, teaser } = await momentWorld();
  // The moment routing touches no GPS owner: the resolver holds no location
  // port and dispatches no location mode or window change (the walk's own
  // region churn on later fixes is the walk's, not the moment's).
  const locationCommandsBefore = world.locationPort.commands.length;
  assert.deepEqual(
    momentBinding(world).play({ momentId: teaser.momentId, storyId: teaser.storyId, path: teaser.audioPath }),
    { outcome: 'routed' },
  );
  assert.equal(world.locationPort.commands.length, locationCommandsBefore);

  // A fresh fix into stop-4's zone completes its dwell: the automation is
  // suspended and the player occupied — the attempt is over, no sound.
  fixAt(world, 54.35, 18.6475, 20_000);
  assert.deepEqual(world.audioPort.commands, [
    'play 1:be/base/audio/story-1.m4a',
    'stop',
    `play 2:${MOMENT_AUDIO_PATH}`,
  ]);
  assert.deepEqual(world.audioPort.violations, []);
  const run = controller.getState().run;
  assert.ok(run.phase === 'Active');
  assert.ok(run.playing !== null && run.playing.owner === 'moment');
  assert.deepEqual(run.autoFired, ['stop-4']); // the attempt retired, manual access remains
});

test('G07.03 (AC3): the moment ends — automation stays suspended, «Працягнуць гід» is the only way back', async () => {
  const { world, controller } = await routedMomentWorld();
  const commandsAfterPlay = world.audioPort.commands.length;

  // The teaser's physical end: the player frees, nothing sounds by itself,
  // the teaser never enters heard, the suspension holds.
  world.audioPort.finish(2);
  let run = controller.getState().run;
  assert.ok(run.phase === 'Active');
  assert.equal(run.playing, null);
  assert.deepEqual(run.heard, []);
  assert.equal(run.autoplaySuspended, true);
  assert.deepEqual(world.audioPort.commands.slice(commandsAfterPlay), []);

  // A dwell after the moment: still suspended — the attempt is over (the
  // displaced stop keeps manual access), no sound.
  fixAt(world, 54.3535, 18.651, 20_000);
  assert.deepEqual(world.audioPort.commands.slice(commandsAfterPlay), []);

  // «Працягнуць гід» sounds nothing by itself; the suspension lifts and the
  // next trigger runs the general conditions: stop-4's zone entry plays.
  controller.getState().guideResume();
  assert.equal(controller.getState().run.autoplaySuspended, false);
  assert.deepEqual(world.audioPort.commands.slice(commandsAfterPlay), []);
  fixAt(world, 54.35, 18.6475, 200_000); // 180 s from stop-2 — under the 12 km/h spike gate
  assert.deepEqual(world.audioPort.commands.slice(commandsAfterPlay), [
    'play 3:be/base/audio/story-4.m4a',
  ]);
  run = controller.getState().run;
  assert.ok(run.playing !== null && run.playing.owner === 'guide');
  assert.deepEqual(run.heard, []); // stop-4's story sounds, not yet finished
});

test('G07.03 (AC4): the re-entered Run shows the own audio state — no auto-Start, no auto-resume', async () => {
  const { world, surface, controller } = await routedMomentWorld();
  // The physical interruption (a call): the moment becomes a live pause.
  world.audioPort.focusLoss();
  world.audioPort.snapshotValue = { state: 'paused', positionMs: 4_000, durationMs: 60_000 };
  const before = controller.getState().run;
  assert.ok(before.phase === 'Active');
  const commandsAtPause = world.audioPort.commands.length;

  // The re-entry through «Прагулка»: the NAV7 cache serves the same store —
  // the engine's audio state is the one left behind, nothing starts itself.
  const reopened = world.services.run?.create('route-map');
  assert.ok(reopened !== undefined);
  assert.equal(reopened, surface);
  const run = controller.getState().run;
  assert.ok(run.phase === 'Active');
  assert.equal(run.sessionId, before.sessionId);
  assert.deepEqual(run.playing, {
    owner: 'moment',
    momentId: 'moment-9',
    storyId: 'story-m9',
    seq: 1,
    paused: true,
  });
  assert.equal(world.audioPort.commands.length, commandsAtPause);

  // The panel's resume is the person's tap — the same token continues, the
  // session flag stays (only «Працягнуць гід» lifts it after Play Moment).
  controller.getState().resumeAudio({ kind: 'moment', ref: 'moment-9', seq: 1 });
  assert.deepEqual(world.audioPort.commands.slice(commandsAtPause), ['resume']);
  const resumed = controller.getState().run;
  assert.ok(resumed.playing !== null && resumed.playing.owner === 'moment' && !resumed.playing.paused);
  assert.equal(resumed.autoplaySuspended, true);
});

test('G07.03: the place-card Stop on a session-owned moment routes to the engine (§3.4)', async () => {
  const { world, controller } = await routedMomentWorld();
  // The card's live fact: the physical player reports the moment launch the
  // idle controller did not mint (its store stays idle).
  assert.deepEqual(momentBinding(world).playback().token, { kind: 'moment', ref: 'moment-9', seq: 1 });
  assert.deepEqual(momentBinding(world).store.getState(), { kind: 'idle' });
  const commandsAtPlay = world.audioPort.commands.length;

  // The revert guard: without the stop routing this tap is a silent no-op
  // and the launch keeps sounding past its Stop button.
  momentBinding(world).stop();
  assert.deepEqual(world.audioPort.commands.slice(commandsAtPlay), ['stop']);
  const run = controller.getState().run;
  assert.ok(run.phase === 'Active');
  assert.equal(run.playing, null);
  assert.equal(run.autoplaySuspended, true);
  assert.deepEqual(run.heard, []);
});

test('G07.03: the place-card Resume on a session-owned paused moment routes to the engine (§3.5)', async () => {
  const { world, controller } = await routedMomentWorld();
  world.audioPort.focusLoss();
  world.audioPort.snapshotValue = { state: 'paused', positionMs: 4_000, durationMs: 60_000 };
  const commandsAtPause = world.audioPort.commands.length;

  // The revert guard: without the resume routing this tap is a silent no-op.
  momentBinding(world).resume();
  assert.deepEqual(world.audioPort.commands.slice(commandsAtPause), ['resume']);
  const run = controller.getState().run;
  assert.ok(run.playing !== null && run.playing.owner === 'moment' && !run.playing.paused);
  assert.equal(run.autoplaySuspended, true); // the moment resume never lifts the session flag
});

test('G07.03: the no-session Moment over the same root still launches on the idle controller', async () => {
  const world = mapWorld({ ...DEFAULT_FILES, ...MOMENT_FILES });
  // No surface open — no live session, the resolver has no target and the
  // idle controller owns the launch (ADR G01.02 §3.8).
  const outcome = momentBinding(world).play({
    momentId: 'moment-9',
    storyId: 'story-m9',
    path: MOMENT_AUDIO_PATH,
  });
  assert.deepEqual(outcome, { outcome: 'started' });
  assert.deepEqual(world.audioPort.commands, [`play 1:${MOMENT_AUDIO_PATH}`]);
  assert.deepEqual(world.audioPort.violations, []);
});
