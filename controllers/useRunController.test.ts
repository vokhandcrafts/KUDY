// G05.05.a (issue #216) — acceptance tests of useRunController: the real
// orchestrator, pipeline, reducer, both services (fake OS ports) and the real
// services/db over the node:sqlite adapter of G04.01, against the real
// contentRepo fixture package route-x@1 (paid, be, stop-1 base → story-b,
// stop-2 extended → story-e). The clock and the session-id mint are injected
// ports — the row's started_at and the minted ids prove the controller never
// reads a wall clock or platform crypto itself (criterion 6). One accepted
// fix at a stop confirms its dwell at once (the pipeline runs with
// dwellMs = 0 and every scenario dwells cold).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createRunController,
  type RunControllerState,
  type RunStartResult,
} from './useRunController.ts';
import type { ControllerStore } from './createControllerStore.ts';
import type { RunStop } from './run/runOrchestrator.ts';
import { defaultEngineConfig } from '../core/engine/reducer.ts';
import type { PlayToken, RunSessionState } from '../core/engine/state.ts';
import { LocationService } from '../services/location/service.ts';
import { FakeLocationOsPort } from '../services/location/fake-port.ts';
import { AudioService, type AudioServiceDeps } from '../services/audio/service.ts';
import { FakeAudioPlayerPort } from '../services/audio/fake-port.ts';
import {
  DbError,
  checkpointProgress,
  openDatabase,
  getSession,
  startSession,
  pauseSession,
} from '../services/db/db.ts';
import { nodeSqliteDriver } from '../services/db/test-fixture.ts';
import type { SqlDriver } from '../services/db/types.ts';
import { evaluatePackage } from '../services/contentRepo/contentRepo.ts';
import { tempPackage, storeAt, stubWithUnreadable } from '../services/contentRepo/test-fixture.ts';
import type { PackageStore, Tier } from '../services/contentRepo/types.ts';
import {
  createAccessPort,
  emitAccessReady,
  parseRouteStops,
  type DownloadAccessPort,
} from '../services/download/access.ts';
import type { RunPackageStops, RunReadiness, RunSessionStore } from './useRunController.ts';

// The contentRepo fixture package: route-x@1, be, paid, two stops on one
// meridian (~100 m apart) with the fixture's own story ids.
const STOPS: RunStop[] = [
  { stopId: 'stop-1', lat: 0, lng: 0, radius: 20, storyBaseId: 'story-b' },
  { stopId: 'stop-2', lat: 0.0009, lng: 0, radius: 20, storyExtendedId: 'story-e' },
];
const ROUTE = { routeId: 'route-x', version: '1', locale: 'be', tier: ['base'] as Tier[] };
const EXT_LAYER = { routeId: 'route-x', version: '1', locale: 'be', tier: 'extended' } as const;

// The injected clock (criterion 6): nothing in the controller may read a wall
// clock, so every timestamp in these scenarios is a number this port handed
// out.
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
  clock: ReturnType<typeof manualClock>;
  locationPort: FakeLocationOsPort;
  audioPort: FakeAudioPlayerPort;
  audioService: AudioService;
  driver: SqlDriver;
  access: DownloadAccessPort;
  packageStore: PackageStore;
  granted: Tier[];
  store: ControllerStore<RunControllerState>;
  discardPackage: () => void;
}

interface WorldOptions {
  // A scenario may subclass the audio service (the write-through ordering and
  // crash-between probes do); the default is the real one over the fake port.
  audio?: (port: FakeAudioPlayerPort, driver: SqlDriver) => AudioService;
  // A scenario may serve a different package view (the not-ready refusals).
  packageStore?: PackageStore;
  // A scenario may decorate the real stops port to inject a fault at the
  // boundary the composition root owns (the vanished-after-readiness refusal).
  packageStops?: (base: RunPackageStops) => RunPackageStops;
}

// The full stack of one walk: real db (migrated), real services over fake OS
// ports, real orchestrator, the controller over them. The controller's three
// service ports are wired over the real public APIs here — exactly what the
// composition root of the app build will implement (issue #209 AC1).
function world(options: WorldOptions = {}): World {
  const clock = manualClock();
  const locationPort = new FakeLocationOsPort();
  const audioPort = new FakeAudioPlayerPort();
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const access = createAccessPort();
  const pkg = tempPackage();
  const packageStore = options.packageStore ?? storeAt(pkg.root);
  const granted: Tier[] = ['base'];
  const audioService = options.audio
    ? options.audio(audioPort, driver)
    : new AudioService({ createPort: () => audioPort });
  const sessionStore: RunSessionStore = {
    start(input) {
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
    checkpoint: (sessionId, progress) => checkpointProgress(driver, sessionId, progress),
  };
  const readiness: RunReadiness = {
    evaluate: (input) => evaluatePackage(packageStore, input),
  };
  const packageStops: RunPackageStops = {
    stopsOfLayer: async (tier) => {
      const file = await packageStore.readFile('route.json');
      if (file.kind !== 'present') return null;
      const parsed = parseRouteStops(file.bytes, {
        routeId: ROUTE.routeId,
        version: ROUTE.version,
        locale: ROUTE.locale,
        tier,
      });
      return parsed.diagnostic !== undefined ? null : parsed.stopIds;
    },
  };
  const effectivePackageStops = options.packageStops ? options.packageStops(packageStops) : packageStops;
  const store = createRunController({
    location: new LocationService({
      port: locationPort,
      clock,
      permissions: { foreground: 'fg', background: 'bg' },
    }),
    audio: audioService,
    clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    route: ROUTE,
    stops: STOPS,
    sessionStore,
    readiness,
    packageStops: effectivePackageStops,
    access,
    newSessionId: (() => {
      let n = 0;
      return () => `walk-${String(++n)}`;
    })(),
    grantedTiers: () => granted,
  });
  return {
    clock,
    locationPort,
    audioPort,
    audioService,
    driver,
    access,
    packageStore,
    granted,
    store,
    discardPackage: pkg.remove,
  };
}

// The subscription the location service currently holds (every arm mints the
// next generation); delivering on it is the physical fix path.
const subscription = (w: World): number => {
  const starts = w.locationPort.commands.filter((command) => command.startsWith('start '));
  const last = starts[starts.length - 1];
  if (last === undefined) throw new Error('the location service never armed');
  return Number(last.slice('start '.length));
};

const fix = (w: World, lat: number, lng: number): void => {
  w.locationPort.emitFix(subscription(w), { lat, lng, accuracy: 5, at: w.clock.now() });
};

const live = (w: World): RunSessionState => {
  const state = w.store.getState().run;
  if (state.phase === 'Idle') throw new Error('no live session in the store');
  return state;
};

const row = (w: World, sessionId: string) => getSession(w.driver, sessionId);
const sessionCount = (w: World): number =>
  Number(w.driver.prepare('SELECT COUNT(*) AS n FROM session').get()?.n);

const okStart = (result: RunStartResult): string => {
  assert.ok(result.ok, `start refused: ${JSON.stringify(result)}`);
  return result.sessionId;
};

const readPackage = (w: World) => async (rel: string): Promise<Uint8Array | null> => {
  const file = await w.packageStore.readFile(rel);
  return file.kind === 'present' ? file.bytes : null;
};

test('criterion 1: Start on a ready package inserts the row and starts the engine after the commit', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.clock.set(42);
  const sessionId = okStart(await w.store.getState().start());

  const written = row(w, sessionId);
  assert.ok(written, 'the Start transaction left no row');
  assert.equal(written.version, '1');
  assert.equal(written.locale, 'be');
  assert.deepEqual(written.tier, ['base']);
  assert.equal(written.playSeq, 0);
  assert.equal(written.state, 'active');
  assert.equal(written.startedAt, 42); // the injected clock, not a wall clock
  assert.deepEqual(written.heard, []);
  assert.deepEqual(written.autoFired, []);

  const run = live(w);
  assert.equal(run.sessionId, sessionId);
  assert.equal(run.phase, 'Active');
  assert.deepEqual(run.tierAvailable, ['base']);
  assert.deepEqual(run.accessibleStopIds, ['stop-1']);
  // The location effects fired after the commit: the subscription armed, and
  // the Start window seed holds only the accessible stops — the person fixes
  // at stop-2's point, the window still selects stop-1 alone (stop-2 is not
  // in the seed of a base start).
  assert.equal(w.locationPort.activeSubscriptions(), 1);
  fix(w, 0.0009, 0);
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId),
    ['stop-1'],
  );
});

test('criterion 1: the R07 carry-over moves the carried hints into session scope inside Start', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const insert = w.driver.prepare(
    "INSERT INTO guide_hint_state (scope, guide_id, shown_at, dismissed_at) VALUES ('foreground', ?, ?, ?)",
  );
  insert.run('g1', 1, null);
  insert.run('g2', 2, 3);
  insert.run('g3', 4, null);

  const sessionId = okStart(await w.store.getState().start({ carryGuideHints: ['g1', 'g2'] }));

  const hints = w.driver
    .prepare('SELECT guide_id, scope, session_id FROM guide_hint_state ORDER BY guide_id')
    .all()
    .map((hint) => [hint.guide_id, hint.scope, hint.session_id]);
  assert.deepEqual(hints, [
    ['g1', 'session', sessionId],
    ['g2', 'session', sessionId],
    ['g3', 'foreground', null],
  ]);
});

test('criterion 1: an injected failure mid-transaction leaves no row and no half carry-over', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  // The injection of the G04.01 suite: two foreground rows for one guide
  // violate the session-scope uniqueness after the INSERT leg ran — the
  // transfer fails inside the transaction.
  const insert = w.driver.prepare(
    "INSERT INTO guide_hint_state (scope, guide_id, shown_at) VALUES ('foreground', 'g1', ?)",
  );
  insert.run(1);
  insert.run(2);

  await assert.rejects(
    w.store.getState().start({ carryGuideHints: ['g1'] }),
    (error: unknown) => error instanceof DbError && error.rule === 'guide-hint-transfer-failed',
  );
  assert.equal(sessionCount(w), 0);
  const hints = w.driver
    .prepare('SELECT scope, session_id FROM guide_hint_state')
    .all()
    .map((hint) => [hint.scope, hint.session_id]);
  assert.deepEqual(hints, [
    ['foreground', null],
    ['foreground', null],
  ]);
});

test('criterion 1: a not-ready package refuses Start with a named reason and writes nothing', async (t) => {
  // incomplete: the package root holds no files
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g0505a-empty-'));
  t.after(() => fs.rmSync(emptyRoot, { recursive: true, force: true }));
  const incomplete = world({ packageStore: storeAt(emptyRoot) });
  t.after(incomplete.discardPackage);
  assert.deepEqual(await incomplete.store.getState().start(), {
    ok: false,
    reason: 'package-incomplete',
  });
  assert.equal(incomplete.store.getState().run.phase, 'Idle');
  assert.equal(sessionCount(incomplete), 0);

  // access-locked: the paid fixture's extended layer with no grants (base
  // stays a disk fact per G04.03 — the locked tier is the refused one)
  const locked = world();
  t.after(locked.discardPackage);
  locked.granted.length = 0;
  assert.deepEqual(await locked.store.getState().start({ tier: 'extended' }), {
    ok: false,
    reason: 'package-access-locked',
  });
  assert.equal(sessionCount(locked), 0);

  // needs-recovery: the base media reads as unreadable
  const brokenRoot = tempPackage();
  t.after(brokenRoot.remove);
  const broken = world({
    packageStore: stubWithUnreadable(storeAt(brokenRoot.root), 'be/base/audio/story-b.m4a'),
  });
  t.after(broken.discardPackage);
  assert.deepEqual(await broken.store.getState().start(), {
    ok: false,
    reason: 'package-needs-recovery',
  });
  assert.equal(sessionCount(broken), 0);
});

test('criterion 1: a layer document that vanishes after readiness refuses Start', async (t) => {
  // The fault lives at the port boundary the composition root owns: the
  // readiness pass went through the real contentRepo path, then the stops
  // port reports the document gone — the guard between the two must refuse
  // the walk instead of starting it on whatever it could read.
  const w = world({ packageStops: () => ({ stopsOfLayer: async () => null }) });
  t.after(w.discardPackage);

  assert.deepEqual(await w.store.getState().start(), { ok: false, reason: 'package-incomplete' });
  assert.equal(sessionCount(w), 0);
  assert.equal(w.store.getState().run.phase, 'Idle');
  assert.deepEqual(w.locationPort.commands, []); // no effect armed, no subscription
});

test('criterion 1: the verified layers of an extended start land in the row and the engine', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.granted.push('extended');
  const sessionId = okStart(await w.store.getState().start({ tier: 'extended' }));

  assert.deepEqual(row(w, sessionId)?.tier, ['base', 'extended']);
  const run = live(w);
  assert.deepEqual(run.tierAvailable, ['base', 'extended']);
  assert.deepEqual(run.accessibleStopIds, ['stop-1', 'stop-2']);
  // The window seed carries both stops: after the person fixes at stop-1,
  // the nearest-≤20 selection lists both layers' stops.
  fix(w, 0, 0);
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId),
    ['stop-1', 'stop-2'],
  );
});

test('criterion 2: a second Start while the session is active is refused with a named reason', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());

  const second = await w.store.getState().start();
  assert.deepEqual(second, { ok: false, reason: 'live-session-exists' });
  assert.equal(sessionCount(w), 1);
  assert.equal(live(w).sessionId, sessionId);
});

test('criterion 2: a second Start while a paused session exists is refused the same way', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  // Yesterday's walk, arranged through the db's own public API: an active
  // row paused, exactly the state the one-unfinished-session rule protects.
  startSession(w.driver, {
    sessionId: 'yesterday',
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    tier: ['base'],
    startedAt: 0,
  });
  pauseSession(w.driver, 'yesterday');

  assert.deepEqual(await w.store.getState().start(), { ok: false, reason: 'live-session-exists' });
  assert.equal(sessionCount(w), 1);
  assert.equal(w.store.getState().run.phase, 'Idle');
});

// Reads the durable row at the moment the play command arrives — the
// ordering probe of criterion 3.
class RowAwareAudio extends AudioService {
  private readonly driver: SqlDriver;
  playSeqAtPlay: number | null = null;

  constructor(deps: AudioServiceDeps, driver: SqlDriver) {
    super(deps);
    this.driver = driver;
  }

  async play(command: { token: PlayToken; path: string }): Promise<void> {
    if (command.token.kind === 'guide') {
      this.playSeqAtPlay = getSession(this.driver, command.token.ref)?.playSeq ?? null;
    }
    return super.play(command);
  }
}

test('criterion 3: play_seq is written through before the play command reaches the audio service', async (t) => {
  const w = world({
    audio: (port, driver) => new RowAwareAudio({ createPort: () => port }, driver),
  });
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0, 0); // the GPS trigger: DwellCompleted → PlayStory

  const playing = live(w);
  assert.ok(playing.playing && playing.playing.owner === 'guide');
  assert.equal(playing.playSeq, 1);
  // At the moment audio.play ran, the durable row already carried the launch
  // identity this command is about to use.
  assert.equal((w.audioService as RowAwareAudio).playSeqAtPlay, 1);
  assert.equal(row(w, sessionId)?.playSeq, 1);
  assert.deepEqual(w.audioPort.commands, ['play 1:be/base/audio/story-b.m4a']);
});

// The crash point between the durable write and the physical command: the
// play call dies before the port is even created, synchronously — the throw
// surfaces to the fix source instead of being swallowed.
class CrashBetweenAudio extends AudioService {
  play(): Promise<void> {
    throw new Error('crash between the write-through and the physical play');
  }
}

test('criterion 3: a crash between the write-through and the play leaves a play_seq no callback can match', async (t) => {
  const w = world({ audio: (port) => new CrashBetweenAudio({ createPort: () => port }) });
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());

  assert.throws(() => fix(w, 0, 0), /crash between the write-through/);
  // The write-through landed; the command never reached a physical player.
  assert.equal(row(w, sessionId)?.playSeq, 1);
  assert.deepEqual(w.audioPort.commands, []);
  // A later tagged callback finds no launch to pair with — the service never
  // created a player, so the physical finished is dropped whole and nothing
  // is credited anywhere.
  w.audioPort.finish(1);
  assert.deepEqual(row(w, sessionId)?.heard, []);
  assert.equal(row(w, sessionId)?.playSeq, 1);
  assert.deepEqual(live(w).heard, []);
});

test('criterion 4: an accepted AudioFinished checkpoints heard and auto_fired', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0, 0); // stop-1 plays (the automatic attempt spends auto_fired)
  w.audioPort.finish(1); // the physical end → AudioFinished → accepted

  const written = row(w, sessionId);
  assert.deepEqual(written?.heard, ['story-b']);
  assert.deepEqual(written?.autoFired, ['stop-1']);
  assert.deepEqual(live(w).heard, ['story-b']);
});

test('criterion 4: a callback rejected by step() writes nothing', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0, 0);
  // Focus lost, and regained only past the 10-minute threshold: the engine
  // closes the launch while the audio service still holds the (paused)
  // source — its later finished reaches step() and is rejected there.
  w.audioPort.focusLoss();
  w.clock.set(601_000);
  w.audioPort.focusRegain();
  assert.equal(live(w).playing, null);

  const before = w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId);
  w.audioPort.finish(1);
  const after = w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId);
  assert.deepEqual(after, before); // not a single durable byte moved
  assert.deepEqual(row(w, sessionId)?.heard, []);
});

test('criterion 4: an accepted DwellCompleted while suspended checkpoints auto_fired', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.granted.push('extended'); // the extended walk: both stops eligible from Start
  const sessionId = okStart(await w.store.getState().start({ tier: 'extended' }));

  w.store.getState().pauseAudio(); // automation suspends; nothing durable changes
  fix(w, 0.0009, 0); // stop-2 triggers → the attempt is spent into auto_fired

  assert.deepEqual(row(w, sessionId)?.autoFired, ['stop-2']);
  assert.deepEqual(row(w, sessionId)?.heard, []);
  assert.deepEqual(live(w).autoFired, ['stop-2']);
});

test('criterion 5: AccessReady reaches the engine through the download capability channel', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0.0009, 0); // the person stands at stop-2's point; the seed holds stop-1 only
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId),
    ['stop-1'],
  );

  const diagnostics = await emitAccessReady(w.access, EXT_LAYER, readPackage(w));
  assert.deepEqual(diagnostics, []);
  const run = live(w);
  assert.deepEqual(run.tierAvailable, ['base', 'extended']);
  assert.deepEqual(run.accessibleStopIds, ['stop-1', 'stop-2']);
  // The unlock rebuilt the geofence window — stop-2 joined it — and touched
  // no durable fact (same-version unlock keeps progress, ADR §3.5).
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId).sort(),
    ['stop-1', 'stop-2'],
  );
  assert.deepEqual(row(w, sessionId)?.heard, []);
  assert.deepEqual(row(w, sessionId)?.autoFired, []);
  assert.equal(row(w, sessionId)?.playSeq, 0);
});

test('criterion 5: a look-alike emission on a foreign port never reaches the engine', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  okStart(await w.store.getState().start());
  fix(w, 0.0009, 0);

  // A second capability port of the same run: real emitter, real payload,
  // but no handler of this controller is registered on it — the delivery
  // path itself is the trust boundary, so the event dies in the void.
  const foreign = createAccessPort();
  assert.deepEqual(await emitAccessReady(foreign, EXT_LAYER, readPackage(w)), []);
  const run = live(w);
  assert.deepEqual(run.tierAvailable, ['base']);
  assert.deepEqual(run.accessibleStopIds, ['stop-1']);
  // The window and the row stayed exactly as the Start seed left them.
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId),
    ['stop-1'],
  );
  assert.deepEqual(row(w, 'walk-1')?.tier, ['base']);
});
