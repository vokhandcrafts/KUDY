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
  type RunRecovery,
  type RunRecoveryLayer,
  type RunRecoveryPayload,
  type RunStartResult,
  type RunWakelock,
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
  finishSession,
  getLiveSession,
  getSession,
  openDatabase,
  pauseSession,
  resumeSession,
  startSession,
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
  wakelockCalls: string[];
  discardPackage: () => void;
}

interface WorldOptions {
  // A scenario may subclass the audio service (the write-through ordering and
  // crash-between probes do); the default is the real one over the fake port.
  audio?: (port: FakeAudioPlayerPort, driver: SqlDriver) => AudioService;
  // A scenario may serve a different package view (the not-ready refusals and
  // the damaged-pinned-package recovery).
  packageStore?: PackageStore;
  // A scenario may decorate the real stops port to inject a fault at the
  // boundary the composition root owns (the vanished-after-readiness refusal).
  packageStops?: (base: RunPackageStops) => RunPackageStops;
}

const isTierValue = (value: string): value is Tier => value === 'base' || value === 'extended';

// The store port over the real services/db public API — what the composition
// root of the app build implements (issue #209 AC1).
function sessionStoreOver(driver: SqlDriver): RunSessionStore {
  return {
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
    pause: (sessionId, progress) => pauseSession(driver, sessionId, progress),
    resume: (sessionId) => resumeSession(driver, sessionId),
    finish: (sessionId, input) => finishSession(driver, sessionId, input),
    live: () => getLiveSession(driver),
  };
}

// The real-path recovery read (09 §9.1): the live row over the real db plus
// the pinned package's per-layer verdicts — the file-level truth through the
// real evaluatePackage, the stop records through the real route.json parse
// and the world's stop arrangement (story ids and geometry), exactly what
// the composition root assembles from route.json + places.json.
function recoveryPortOver(
  driver: SqlDriver,
  packageStore: PackageStore,
  granted: readonly Tier[],
): RunRecovery {
  return {
    read: async (routeId) => {
      const liveRow = getLiveSession(driver);
      if (!liveRow || liveRow.routeId !== routeId) return null;
      const layers: RunRecoveryLayer[] = [];
      for (const tier of liveRow.tier.filter(isTierValue)) {
        const verdict = await evaluatePackage(packageStore, {
          locale: liveRow.locale,
          tier,
          grantedTiers: granted,
        });
        if (verdict.status !== 'ready') {
          layers.push({ tier, status: verdict.status });
          continue;
        }
        const file = await packageStore.readFile('route.json');
        const parsed =
          file.kind === 'present'
            ? parseRouteStops(file.bytes, {
                routeId: liveRow.routeId,
                version: liveRow.version,
                locale: liveRow.locale,
                tier,
              })
            : undefined;
        const ids = parsed && parsed.diagnostic === undefined ? parsed.stopIds : [];
        layers.push({
          tier,
          status: 'ready',
          stops: STOPS.filter((stop) => ids.includes(stop.stopId)),
        });
      }
      const payload: RunRecoveryPayload = {
        row: liveRow,
        routeId: packageStore.key.routeId,
        version: packageStore.key.version,
        layers,
      };
      return payload;
    },
  };
}

// The full stack of one walk: real db (migrated), real services over fake OS
// ports, real orchestrator, the controller over them. The controller's
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
  const wakelockCalls: string[] = [];
  const wakelock: RunWakelock = {
    acquire: () => wakelockCalls.push('acquire'),
    release: () => wakelockCalls.push('release'),
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
    sessionStore: sessionStoreOver(driver),
    readiness,
    packageStops: effectivePackageStops,
    access,
    newSessionId: (() => {
      let n = 0;
      return () => `walk-${String(++n)}`;
    })(),
    grantedTiers: () => granted,
    wakelock,
    recovery: recoveryPortOver(driver, packageStore, granted),
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
    wakelockCalls,
    discardPackage: pkg.remove,
  };
}

// A second controller over the same world — the process-restart arrangement
// of 09 §9.1: fresh controller state and a fresh session-id mint, the same
// OS ports, driver and package. The new services re-register on the ports,
// so the old process's subscriptions go deaf exactly as a killed app's do.
function restart(
  w: World,
  decorateRecovery?: (base: RunRecovery) => RunRecovery,
): ControllerStore<RunControllerState> {
  const baseRecovery = recoveryPortOver(w.driver, w.packageStore, w.granted);
  return createRunController({
    location: new LocationService({
      port: w.locationPort,
      clock: w.clock,
      permissions: { foreground: 'fg', background: 'bg' },
    }),
    audio: new AudioService({ createPort: () => w.audioPort }),
    clock: w.clock,
    engineConfig: defaultEngineConfig,
    pipelineConfig: { dwellMs: 0 },
    route: ROUTE,
    stops: STOPS,
    sessionStore: sessionStoreOver(w.driver),
    readiness: { evaluate: (input) => evaluatePackage(w.packageStore, input) },
    packageStops: {
      stopsOfLayer: async (tier) => {
        const file = await w.packageStore.readFile('route.json');
        if (file.kind !== 'present') return null;
        const parsed = parseRouteStops(file.bytes, {
          routeId: ROUTE.routeId,
          version: ROUTE.version,
          locale: ROUTE.locale,
          tier,
        });
        return parsed.diagnostic !== undefined ? null : parsed.stopIds;
      },
    },
    access: w.access,
    newSessionId: (() => {
      let n = 1;
      return () => `again-${String(++n)}`;
    })(),
    grantedTiers: () => w.granted,
    // A new process holds no wakelock; the recovery never touches the port,
    // so the calls stay empty and no test reads them through the world.
    wakelock: { acquire: () => {}, release: () => {} },
    recovery: decorateRecovery ? decorateRecovery(baseRecovery) : baseRecovery,
  });
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

const liveFrom = (store: ControllerStore<RunControllerState>): RunSessionState => {
  const state = store.getState().run;
  if (state.phase === 'Idle') throw new Error('no live session in the store');
  return state;
};


// Three consecutive fixes at one point: the smoothing window then averages to
// that point, so the pipeline confirms its dwell (dwellMs = 0 confirms at
// once) — the same idiom the orchestrator suite uses for a second stop.
const dwellAt = (w: World, lat: number, lng: number, startMs: number): void => {
  for (const offset of [0, 1_000, 2_000]) {
    w.clock.set(startMs + offset);
    fix(w, lat, lng);
  }
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
test('criterion 1: Pause persists the row paused, retires the queue in the same write and releases the walk resources', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.granted.push('extended'); // both stops eligible: the queue needs a live trigger
  const sessionId = okStart(await w.store.getState().start({ tier: 'extended' }));
  assert.deepEqual(w.wakelockCalls, ['acquire']); // ADR §3.3 Start effects: wakelock after the commit
  fix(w, 0, 0); // stop-1: the guide plays, the automatic attempt is spent
  dwellAt(w, 0.0009, 0, 60_000); // a minute later at stop-2: the queue takes it

  w.store.getState().pauseSession();

  const written = row(w, sessionId);
  assert.equal(written?.state, 'paused');
  // The queue retired into the SAME transaction that set the row paused
  // (ADR §3.3 Pause): the read after the pause already carries the stop.
  assert.deepEqual(written?.autoFired, ['stop-1', 'stop-2']);
  const paused = live(w);
  assert.equal(paused.phase, 'Paused');
  assert.equal(paused.queued, null);
  assert.equal(paused.playing, null); // the guide launch stopped
  // The physical effects: the guide audio stopped, the subscription and the
  // window are gone, the wakelock released (11 §4.2). The proof of this
  // block is the subscription count — skipping the mode change turns it red.
  assert.deepEqual(w.audioPort.commands, ['play 1:be/base/audio/story-b.m4a', 'stop']);
  assert.equal(w.locationPort.activeSubscriptions(), 0);
  assert.deepEqual(w.locationPort.regions, []);
  assert.deepEqual(w.wakelockCalls, ['acquire', 'release']);
});

test('criterion 1: a session pause keeps a playing Moment sounding and touches only the walk', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  okStart(await w.store.getState().start());
  fix(w, 0, 0); // the guide plays (source 1)
  w.store.getState().playMoment('moment-1', 'story-b'); // the moment takes the player (source 2)
  const commandsAtMoment = w.audioPort.commands.length;

  w.store.getState().pauseSession();

  // ADR G01.02 §3.8 / parity §4.9: the pause touches only the walk — the
  // moment launch is not session property, no stop command goes out.
  assert.equal(w.audioPort.commands.length, commandsAtMoment);
  const paused = live(w);
  assert.equal(paused.phase, 'Paused');
  assert.ok(paused.playing && paused.playing.owner === 'moment');
  assert.equal(paused.playing.paused, false);
  assert.equal(w.locationPort.activeSubscriptions(), 0);
});

test('criterion 2: Resume re-arms the row, GPS and the window from a fresh fix without starting audio itself', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  w.store.getState().pauseSession(); // paused before anything triggered
  const playsBefore = w.audioPort.commands.filter((command) => command.startsWith('play')).length;

  w.store.getState().resumeSession();

  assert.equal(row(w, sessionId)?.state, 'active');
  assert.equal(live(w).phase, 'Active');
  assert.deepEqual(w.wakelockCalls, ['acquire', 'release', 'acquire']);
  assert.equal(w.locationPort.activeSubscriptions(), 1); // the GPS mode re-armed
  assert.equal(w.locationPort.regions.length, 0); // the window set waits for a fresh fix
  assert.equal(w.audioPort.commands.filter((command) => command.startsWith('play')).length, playsBefore);
  // 09 invariant 7 / 11 §5.2: the Resume tap IS the explicit human action
  // that lifts the suspension — nothing sounded as a mechanical effect of
  // the dispatch itself, and the automation now runs the general conditions
  // again. (The issue criterion's «autoplay_suspended = true» parenthetical
  // restates ADR §3.3's pre-G01.02 wording; the canon sources agree here.)
  assert.equal(live(w).autoplaySuspended, false);

  fix(w, 0, 0); // the fresh fix ranks the re-armed window and drives the trigger
  assert.deepEqual(
    w.locationPort.regions.map((stop) => stop.stopId),
    ['stop-1'],
  );
  assert.equal(live(w).playing?.owner, 'guide'); // the trigger played after the explicit resume
  assert.deepEqual(row(w, sessionId)?.autoFired, ['stop-1']);
});

test('criterion 3: End mid-audio finishes the row with the final checkpoint and releases everything', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.granted.push('extended'); // both stops eligible: the queue needs a live trigger
  const sessionId = okStart(await w.store.getState().start({ tier: 'extended' }));
  w.clock.set(1000);
  fix(w, 0, 0); // the guide sounds
  dwellAt(w, 0.0009, 0, 61_000); // a minute of walking, then stop-2 queues
  w.clock.set(64_000);

  w.store.getState().end();

  const written = row(w, sessionId);
  assert.equal(written?.state, 'finished');
  assert.equal(written?.finishedAt, 64_000); // the injected clock, not a wall clock
  assert.deepEqual(written?.autoFired, ['stop-1', 'stop-2']); // the final checkpoint retired the queue
  assert.equal(live(w).phase, 'Ended');
  assert.deepEqual(w.audioPort.commands, ['play 1:be/base/audio/story-b.m4a', 'stop']);
  assert.equal(w.locationPort.activeSubscriptions(), 0);
  assert.deepEqual(w.locationPort.regions, []);
  assert.deepEqual(w.wakelockCalls, ['acquire', 'release']);

  // A repeat End is a stray tap: nothing writes, nothing releases twice.
  const before = w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId);
  w.store.getState().end();
  assert.deepEqual(w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId), before);
  assert.deepEqual(w.wakelockCalls, ['acquire', 'release']);
});

test('criterion 3: End from Paused and after one story finish the same row', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.clock.set(10);
  const pausedId = okStart(await w.store.getState().start());
  w.store.getState().pauseSession();
  w.store.getState().end();
  assert.equal(row(w, pausedId)?.state, 'finished');
  assert.equal(row(w, pausedId)?.finishedAt, 10);

  const toldId = okStart(await w.store.getState().start());
  fix(w, 0, 0);
  w.audioPort.finish(1); // one full story, then the person ends the walk
  w.store.getState().end();
  assert.equal(row(w, toldId)?.state, 'finished');
  assert.deepEqual(row(w, toldId)?.heard, ['story-b']);
  assert.equal(live(w).phase, 'Ended');
});

test('criterion 3: the next Start after End opens a new row and the ended one never reactivates', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const first = okStart(await w.store.getState().start());
  fix(w, 0, 0);
  w.audioPort.finish(1);
  w.store.getState().end();

  const second = okStart(await w.store.getState().start());
  assert.notEqual(second, first);
  assert.equal(sessionCount(w), 2);
  assert.equal(row(w, first)?.state, 'finished');
  assert.equal(row(w, second)?.state, 'active');
  assert.deepEqual(row(w, second)?.heard, []); // a repeat walk is a fresh session
  assert.equal(live(w).sessionId, second);

  w.store.getState().resumeSession(); // no Paused addressee — a no-op, not a revival
  assert.equal(row(w, first)?.state, 'finished');
  assert.equal(live(w).sessionId, second);
});

test('criterion 4: a process restart restores the live row as a state and starts nothing', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  w.granted.push('extended');
  const sessionId = okStart(await w.store.getState().start({ tier: 'extended' }));
  fix(w, 0, 0); // stop-1 plays and keeps sounding (play_seq 1)
  dwellAt(w, 0.0009, 0, 60_000); // stop-2 queues behind the sounding guide
  const commandsBefore = w.audioPort.commands.length;
  assert.equal(live(w).queued?.stopId, 'stop-2'); // the queue is really held

  const second = restart(w);
  assert.equal(second.getState().run.phase, 'Idle'); // the state comes from recover(), not from the constructor
  await second.getState().recover();

  const restored = liveFrom(second);
  assert.equal(restored.sessionId, sessionId);
  assert.equal(restored.phase, 'Active');
  assert.equal(restored.version, '1'); // the pinned version, not the catalog's current one
  assert.equal(restored.locale, 'be');
  assert.deepEqual(restored.heard, []); // the launch never finished — no heard credit
  assert.deepEqual(restored.autoFired, ['stop-1']);
  assert.equal(restored.playSeq, 1);
  assert.deepEqual(restored.tierAvailable, ['base', 'extended']);
  assert.deepEqual(restored.accessibleStopIds, ['stop-1', 'stop-2']);
  assert.equal(restored.playing, null); // §3.2: the player mirror is transient
  assert.equal(restored.queued, null); // §3.2: the queue never survives a restart
  assert.equal(restored.autoplaySuspended, true); // §3.2: nothing sounds by itself
  assert.deepEqual(second.getState().recovery, { status: 'restored', sessionId, unavailableTiers: [] });
  assert.equal(w.audioPort.commands.length, commandsBefore); // no audio starts

  // 09 §9.1: the return re-armed the window of the live active session; the
  // restored flag suspends the trigger, so the attempt retires into
  // auto_fired and checkpoints into the restored row — the next sound waits
  // for an explicit action (11 §5.1.1 outcome 2).
  fix(w, 0.0009, 0);
  assert.deepEqual(getSession(w.driver, sessionId)?.autoFired, ['stop-1', 'stop-2']);
  assert.equal(w.audioPort.commands.length, commandsBefore);
  assert.equal(liveFrom(second).playing, null);
});

test('criterion 4: a paused row restores without arming the location, and resumes explicitly', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0, 0);
  w.audioPort.finish(1);
  w.store.getState().pauseSession();
  assert.equal(w.locationPort.activeSubscriptions(), 0);

  const second = restart(w);
  const commandsBefore = w.audioPort.commands.length;
  await second.getState().recover();

  assert.equal(liveFrom(second).phase, 'Paused');
  assert.equal(liveFrom(second).sessionId, sessionId);
  assert.deepEqual(second.getState().recovery, { status: 'restored', sessionId, unavailableTiers: [] });
  // 11 §4.2: a paused row holds no subscription — the window re-arms only
  // through the explicit «Працягнуць».
  assert.equal(w.locationPort.activeSubscriptions(), 0);
  assert.equal(w.audioPort.commands.length, commandsBefore);

  second.getState().resumeSession();
  assert.equal(liveFrom(second).phase, 'Active');
  assert.equal(row(w, sessionId)?.state, 'active');
  assert.equal(w.locationPort.activeSubscriptions(), 1);
});

test('criterion 4: no live row or an owned session — recover changes nothing', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  await w.store.getState().recover();
  assert.equal(w.store.getState().run.phase, 'Idle');
  assert.deepEqual(w.store.getState().recovery, { status: 'none' });

  const sessionId = okStart(await w.store.getState().start());
  await w.store.getState().recover(); // the controller owns a live session already
  assert.equal(live(w).sessionId, sessionId);
  assert.equal(sessionCount(w), 1);
});

test('criterion 5: a newer catalog package never enters the restored session', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  const commandsBefore = w.audioPort.commands.length;

  // The composition root of a moved-on catalog bound the version-2 view:
  // complete, granted — but not the row's pinned version. The controller
  // must refuse the whole payload instead of swapping the content (ADR §3.4).
  const newerCatalog: RunRecovery = {
    read: async (routeId: string): Promise<RunRecoveryPayload | null> => {
      const payload = await recoveryPortOver(w.driver, w.packageStore, w.granted).read(routeId);
      if (!payload) return null;
      return {
        ...payload,
        routeId: 'route-x',
        version: '2',
        layers: [
          {
            tier: 'base' as const,
            status: 'ready' as const,
            stops: [{ stopId: 'stop-9', lat: 9, lng: 9, radius: 20, storyBaseId: 'story-new' }],
          },
        ],
      };
    },
  };
  const second = restart(w, () => newerCatalog);
  await second.getState().recover();

  const restored = liveFrom(second);
  assert.equal(restored.version, '1'); // the pin survives
  assert.equal(restored.locale, 'be');
  assert.deepEqual(restored.tierAvailable, []); // no foreign layer entered
  assert.deepEqual(restored.accessibleStopIds, []);
  assert.deepEqual(second.getState().recovery, { status: 'restored', sessionId, unavailableTiers: ['base'] });
  // The restored-active row re-arms the location, but the window holds
  // nothing: a fix at the version-2 stop's point can not even rank it.
  fix(w, 9, 9);
  assert.deepEqual(w.locationPort.regions, []);
  assert.equal(w.audioPort.commands.length, commandsBefore);
});

test('criterion 5: the pinned package files are still required — a damaged layer restores honestly unavailable', async (t) => {
  const brokenRoot = tempPackage();
  t.after(brokenRoot.remove);
  const w = world({
    packageStore: stubWithUnreadable(storeAt(brokenRoot.root), 'be/base/audio/story-b.m4a'),
  });
  t.after(w.discardPackage);
  // Yesterday's row, arranged through the db's own public API: the files
  // verified at Start, the media reads as unreadable today.
  startSession(w.driver, {
    sessionId: 'pinned',
    routeId: 'route-x',
    version: '1',
    locale: 'be',
    tier: ['base'],
    startedAt: 5,
  });
  checkpointProgress(w.driver, 'pinned', { heard: ['story-b'], playSeq: 2 });

  const second = restart(w);
  await second.getState().recover();

  // §3.7: the session restores AS STATE, the content is honestly
  // unavailable — no play, no swap, the layer reported on the recovery view.
  const restored = liveFrom(second);
  assert.equal(restored.phase, 'Active');
  assert.equal(restored.version, '1');
  assert.deepEqual(restored.heard, ['story-b']);
  assert.deepEqual(restored.tierAvailable, []);
  assert.deepEqual(restored.accessibleStopIds, []);
  assert.equal(restored.playing, null);
  assert.equal(restored.autoplaySuspended, true);
  assert.deepEqual(second.getState().recovery, {
    status: 'restored',
    sessionId: 'pinned',
    unavailableTiers: ['base'],
  });
  assert.deepEqual(w.audioPort.commands, []);
});

test('criterion 6: a callback, a fix and an AccessReady after End change nothing in the session', async (t) => {
  const w = world();
  t.after(w.discardPackage);
  const sessionId = okStart(await w.store.getState().start());
  fix(w, 0, 0); // the guide plays (source 1)
  w.store.getState().playMoment('moment-1', 'story-b'); // the moment takes the player (source 2)
  w.store.getState().end(); // End mid-moment: the moment keeps sounding (ADR G01.02 §3.8)
  const snapshot = w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId);

  w.audioPort.finish(2); // the late moment callback
  fix(w, 0, 0); // a fix wanders in
  const diagnostics = await emitAccessReady(w.access, EXT_LAYER, readPackage(w)); // the download lands after End
  assert.deepEqual(diagnostics, []);

  // Not a single durable byte moved; the finished row stays history and the
  // downloads stay disk-only (ADR §3.5: no live session of that version).
  assert.deepEqual(w.driver.prepare('SELECT * FROM session WHERE session_id = ?').get(sessionId), snapshot);
  assert.equal(sessionCount(w), 1);
  assert.equal(live(w).phase, 'Ended');
});
