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
  RunSessionStore,
  RunWakelock,
} from '../useRunController.ts';
import type { ControllerStore } from '../createControllerStore.ts';
import { defaultEngineConfig } from '../../core/engine/reducer.ts';
import { runMapView, runMapStrings } from './runMap.ts';
import { LocationService } from '../../services/location/service.ts';
import { FakeLocationOsPort } from '../../services/location/fake-port.ts';
import { AudioService } from '../../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../../services/audio/fake-port.ts';
import { createAccessPort } from '../../services/download/access.ts';
import {
  DbError,
  checkpointProgress,
  finishSession,
  getLiveSession,
  openDatabase,
  pauseSession,
  resumeSession,
  startSession,
} from '../../services/db/db.ts';
import { nodeSqliteDriver } from '../../services/db/test-fixture.ts';
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

// The store over an in-memory file map: the same BundlesStore seam the device
// adapter implements; listDir answers null for "nothing here" (09 §7).
function memoryBundles(files: Record<string, string>): BundlesStore {
  return {
    listDir: async (rel) => {
      const prefix = rel.endsWith('/') ? rel : `${rel}/`;
      const names = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
      }
      return names.size > 0 ? [...names] : null;
    },
    readFile: async (rel) => {
      const data = files[rel];
      return data === undefined
        ? { kind: 'absent' }
        : { kind: 'present', bytes: new TextEncoder().encode(data) };
    },
    statSize: async () => null,
  };
}

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
}

// The store port over the real services/db public API — the wiring the
// composition root of the app build implements; the methods list in the
// row's lifecycle order (pause, resume, finish, checkpoint, start).
function sessionStoreOver(driver: SqlDriver): RunSessionStore {
  return {
    pause: (sessionId, progress) => pauseSession(driver, sessionId, progress),
    resume: (sessionId) => resumeSession(driver, sessionId),
    finish: (sessionId, input) => finishSession(driver, sessionId, input),
    checkpoint: (sessionId, progress) => checkpointProgress(driver, sessionId, progress),
    start: (input) => {
      try {
        startSession(driver, input);
        return { ok: true };
      } catch (error) {
        if (error instanceof DbError && error.rule === 'live-session-exists') {
          return { ok: false, reason: 'live-session-exists' };
        }
        throw error;
      }
    },
  };
}

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
    stopsOfLayer: async (tier) => (tier === 'base' ? [...BASE_STOP_IDS] : tier === 'extended' ? ['stop-3'] : []),
  };
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
    wakelock: { acquire: () => {}, release: () => {} },
    recovery: recoveryPortOver(driver),
    newSessionId: (() => {
      let n = 0;
      return () => `walk-${String(++n)}`;
    })(),
    grantedTiers: () => granted,
  };
  const services = createServices({ bundlesStore: memoryBundles(owned), run: { session } });
  return { services, locationPort, audioPort, clock, driver, granted, files: owned };
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

  // The reopening surface: the row's pin wins even with two versions on disk.
  world.files['bundles/route-map/2/be/base/route.json'] = ROUTE_JSON;
  world.files['bundles/route-map/2/be/base/places.json'] = PLACES_JSON;
  const reopened = await openSurface(world);
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
