// G07.05 (issue #284) — the R07 hint controller suite over the real stack:
// the real LocationService (the fake OS port idiom), the real AudioService
// (the fake player port), the real services/db over node:sqlite and the
// canonical values document the contract ships — the accepted numbers drive
// every threshold here, none is restated. The catalog is a plain service
// port object (not an OS seam). The named tests are the issue's criteria;
// the PROOF test is the revert guard (implementation-rules 1).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeAudioPlayerPort } from '../services/audio/fake-port.ts';
import { AudioService } from '../services/audio/service.ts';
import { FakeLocationOsPort } from '../services/location/fake-port.ts';
import { LocationService } from '../services/location/service.ts';
import {
  DbError,
  listGuidesInHintCooldown,
  listSessionGuideHints,
  openDatabase,
  recordGuideHintDismissed,
  recordGuideHintShown,
} from '../services/db/db.ts';
import { nodeSqliteDriver } from '../services/db/test-fixture.ts';
import type { SqlDriver } from '../services/db/types.ts';
import { loadGuideHintValues } from '../services/config.ts';
import {
  createNearbyHintController,
  type GuideHintEventRecord,
  type GuideHintPoint,
  type GuideHintStore,
  type NearbyHintRunSource,
  type NearbyHintState,
} from './useNearbyController.ts';
import type { RunState } from '../core/engine/state.ts';

// The values the app actually ships — the loader reads the canonical file
// and validates it through the contract checker before any test sees a number.
const VALUES = loadGuideHintValues();

// The geography: a base point on the Gdańsk coast; 0.001° of latitude is
// ~111 m. The fix lands at NEAR (base+0.002, ~222 m from the guide point);
// FAR (base+0.006) is ~444 m from that fix — outside the 300 m radius. All
// distances read from the fix, the point the proximity runs over.
const BASE = { lat: 54.4, lng: 18.6 };
const NEAR = { lat: BASE.lat + 0.002, lng: BASE.lng };
const FAR = { lat: BASE.lat + 0.006, lng: BASE.lng };

const offer = (routeId: string, access: 'free' | 'paid' | 'mixed' = 'free') => ({
  offer_id: `offer-${routeId}`,
  kind: 'guide' as const,
  route_id: routeId,
  place_id: null,
  editorial_order: 0,
  title: `Гід ${routeId}`,
  summary: null,
  distance_m: null,
  text_locales: ['be'],
  audio_locales: ['be'],
  access,
  estimated_duration: null,
});

// The show ladder every presentation scenario walks: one qualifying fix
// anchors the dwell, twenty-one seconds of continuous presence complete it
// and the card is ready. Returns the narrowed ready state.
function dwellToReady(world: World): Extract<NearbyHintState, { kind: 'ready' }> {
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 21_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  const state = world.storeState();
  assert.equal(state.kind, 'ready');
  if (state.kind !== 'ready') throw new Error('unreachable');
  return state;
}

interface World {
  driver: SqlDriver;
  locationPort: FakeLocationOsPort;
  location: LocationService;
  audioPort: FakeAudioPlayerPort;
  audio: AudioService;
  events: GuideHintEventRecord[];
  runRef: { current: RunState };
  runListeners: Array<() => void>;
  foregroundRef: { current: boolean };
  clock: { nowMs: number };
  emitFix: (lat: number, lng: number) => void;
  notifyRun: () => void;
  storeState: () => NearbyHintState;
  binding: ReturnType<typeof createNearbyHintController>;
  points: GuideHintPoint[];
}

// The world: one armed subscription (the open city surface's, driven by the
// test as the G07.01 surface would), one db, one audio service, the run
// source and the foreground fact as mutable refs.
function makeWorld(options?: {
  offers?: ReturnType<typeof offer>[];
  points?: GuideHintPoint[];
  run?: RunState;
  foreground?: boolean;
  store?: GuideHintStore;
}): World {
  const clock = { nowMs: 10_000 };
  const locationPort = new FakeLocationOsPort();
  locationPort.permissionState = 'granted';
  const location = new LocationService({
    port: locationPort,
    clock: { now: () => clock.nowMs, schedule: () => () => {} },
    permissions: { foreground: 'fg', background: 'bg' },
  });
  location.setMode('city-surface');
  const audioPort = new FakeAudioPlayerPort();
  const audio = new AudioService({ createPort: () => audioPort });
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  const events: GuideHintEventRecord[] = [];
  const runRef = { current: options?.run ?? { phase: 'Idle' as const } };
  const runListeners: Array<() => void> = [];
  const runSource: NearbyHintRunSource = {
    get run() {
      return runRef.current;
    },
    subscribe: (listener) => {
      runListeners.push(listener);
      return () => {
        const index = runListeners.indexOf(listener);
        if (index >= 0) runListeners.splice(index, 1);
      };
    },
  };
  const foregroundRef = { current: options?.foreground ?? true };
  const points = options?.points ?? [
    { guideId: 'route-near', lat: NEAR.lat, lng: NEAR.lng },
    { guideId: 'route-far', lat: FAR.lat, lng: FAR.lng },
  ];
  const offers = options?.offers ?? [offer('route-near'), offer('route-far')];
  const catalog = {
    loadNearby: async () => ({ kind: 'ready' as const, offers, degraded: null }),
  };
  const binding = createNearbyHintController({
    location,
    audio,
    catalog,
    store: options?.store ?? dbHintStore(driver),
    points: () => points,
    values: VALUES,
    liveRun: () => runSource,
    foreground: () => foregroundRef.current,
    telemetry: { record: (event) => events.push(event) },
    now: () => clock.nowMs,
    nextSuggestionSeq: (() => {
      let n = 0;
      return () => ++n;
    })(),
  });
  const subscription = Number(
    locationPort.commands.find((command) => command.startsWith('start '))?.slice('start '.length) ?? '0',
  );
  return {
    driver,
    locationPort,
    location,
    audioPort,
    audio,
    events,
    runRef,
    runListeners,
    foregroundRef,
    clock,
    emitFix: (lat, lng) => locationPort.emitFix(subscription, { lat, lng, accuracy: 10, at: clock.nowMs }),
    notifyRun: () => {
      for (const listener of [...runListeners]) listener();
    },
    storeState: () => binding.store.getState(),
    binding,
    points,
  };
}

// The db-backed GuideHintStore over the public API — the same wiring the
// app build's composition implements (test/session-store.ts owns the shared
// copy; this suite keeps its own thin one to stay self-contained).
function dbHintStore(driver: SqlDriver): GuideHintStore {
  return {
    recordShown: (input) =>
      recordGuideHintShown(driver, {
        guideIds: input.guideIds,
        scope: input.context === 'active' ? 'session' : 'foreground',
        sessionId: input.sessionId ?? undefined,
        at: input.at,
      }),
    recordDismissed: (input) =>
      recordGuideHintDismissed(driver, {
        guideIds: input.guideIds,
        scope: input.context === 'active' ? 'session' : 'foreground',
        sessionId: input.sessionId ?? undefined,
        at: input.at,
      }),
    sessionShown: (sessionId) => listSessionGuideHints(driver, sessionId).map((row) => row.guideId),
    cooldownBlocked: (nowMs, cooldownMs) => listGuidesInHintCooldown(driver, nowMs, cooldownMs),
  };
}

test('AC1: hints propose only public guide previews — no audio, no Start, no second GPS owner', async () => {
  // route-near has a public offer and a point inside the radius; route-blank
  // has a point inside the radius but no public preview — no card for it.
  // route-far's point is outside the 300 m radius even with its offer.
  const world = makeWorld({
    offers: [offer('route-near'), offer('route-far', 'paid')],
    points: [
      { guideId: 'route-near', lat: NEAR.lat, lng: NEAR.lng },
      { guideId: 'route-blank', lat: NEAR.lat, lng: BASE.lng + 0.001 },
      { guideId: 'route-far', lat: FAR.lat, lng: FAR.lng },
    ],
  });
  // The controller's first decide runs on the catalog load; wait for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The arming the test did is the only location work — the controller adds
  // none (no setMode, no geofence window, no second subscription). The
  // service's own per-fix window recompute ('regions …') is not a command.
  world.emitFix(NEAR.lat, NEAR.lng);
  const commandsAfterArming = nonWindowCommands(world);
  const state = dwellToReady(world);
  assert.deepEqual(
    state.guides.map((guide) => [guide.routeId, guide.title, guide.paid]),
    [['route-near', 'Гід route-near', false]],
  );
  assert.deepEqual(nonWindowCommands(world), commandsAfterArming);
  assert.deepEqual(world.audioPort.commands, []);
  // The shown fact: one foreground row and one event, payload identifiers only.
  const rows = world.driver.prepare(`SELECT guide_id FROM guide_hint_state WHERE scope = 'foreground'`).all();
  assert.deepEqual(rows.map((row) => row.guide_id), ['route-near']);
  assert.deepEqual(world.events, [
    {
      type: 'guide_nearby_shown',
      suggestion_id: 'hint-1',
      shown_guide_ids: ['route-near'],
      context: 'idle',
    },
  ]);
});

test('AC2: no second GPS owner — the controller never arms or re-arms anything, Paused included', async () => {
  const world = makeWorld({ run: pausedRun() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // A throwaway fix settles the service's own window recompute ('regions 0')
  // — the baseline holds every command the hint flow could have added.
  world.emitFix(NEAR.lat, NEAR.lng);
  const commandsAfterArming = nonWindowCommands(world);
  world.emitFix(NEAR.lat, NEAR.lng);
  world.notifyRun();
  assert.deepEqual(nonWindowCommands(world), commandsAfterArming);
});

test('PROOF AC3: a hint in background, Paused, FocusLoss, manual block or audio renders nothing', async () => {
  // The revert guard: dropping any gate below turns this test red with a
  // ready card in the same scenario (implementation-rules 1).
  const scenarios: Array<[string, (w: World) => Promise<void> | void, string]> = [
    ['background', (w) => { w.foregroundRef.current = false; }, 'background'],
    ['Paused walk', (w) => { w.runRef.current = pausedRun(); }, 'paused'],
    ['FocusLoss', (w) => { w.runRef.current = { ...activeRun(), focusLostAt: 1 }; }, 'quiet'],
    ['manual block', (w) => { w.runRef.current = { ...activeRun(), autoplaySuspended: true }; }, 'quiet'],
    [
      'audio playing',
      async (w) => {
        await w.audio.play({ token: { kind: 'moment', ref: 'm1', seq: 1 }, path: 'bundles/x/audio/story.m4a' });
        w.audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 1000 };
      },
      'quiet',
    ],
  ];
  for (const [name, arrange, reason] of scenarios) {
    const world = makeWorld();
    await new Promise((resolve) => setTimeout(resolve, 0));
    world.emitFix(NEAR.lat, NEAR.lng);
    world.clock.nowMs += 21_000;
    world.emitFix(NEAR.lat, NEAR.lng);
    await arrange(world);
    world.notifyRun();
    const state = world.storeState();
    assert.equal(state.kind, 'hidden', `${name} must hide the card`);
    if (state.kind !== 'hidden') return;
    assert.equal(state.reason, reason, name);
  }
});

// The location port's command log without the service's own per-fix window
// recomputes — the arming/subscription commands a second GPS owner would add.
function nonWindowCommands(world: World): string[] {
  return world.locationPort.commands.filter((command) => !command.startsWith('regions'));
}

function pausedRun(): RunState {
  return { ...activeRun(), phase: 'Paused' };
}

function activeRun(): RunState & { phase: 'Active' } {
  return {
    phase: 'Active',
    sessionId: 'walk-1',
    routeId: 'route-selected',
    version: '1',
    locale: 'be',
    tier: ['base'],
    stops: [],
    accessibleStopIds: [],
    tierAvailable: ['base'],
    heard: [],
    autoFired: [],
    playing: null,
    queued: null,
    autoplaySuspended: false,
    lastFix: null,
    focusLostAt: null,
    playSeq: 0,
  };
}

test('AC4: after audio the card returns only on a new qualifying fix — the stale one never shows', async () => {
  const world = makeWorld();
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The dwell is in progress when the audio starts: the anchor survives the
  // short quiet episode (presence continued), so the post-audio show needs
  // no second dwell — the deferred card re-checks proximity only.
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 12_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  await world.audio.play({ token: { kind: 'moment', ref: 'm1', seq: 1 }, path: 'bundles/x/audio/story.m4a' });
  world.audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 1000 };
  world.emitFix(NEAR.lat, NEAR.lng);
  assert.equal(world.storeState().kind, 'hidden');
  // The audio ends 8 s later; a fresh fix arrives; the dwell totals 20 s.
  world.audio.stop();
  world.audioPort.snapshotValue = { state: 'idle', positionMs: 0, durationMs: 0 };
  world.clock.nowMs += 8_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  const state = world.storeState();
  assert.equal(state.kind, 'ready');
  if (state.kind !== 'ready') return;
  assert.deepEqual(state.guides.map((guide) => guide.routeId), ['route-near']);

  // The stale variant: the audio outlasts the fix stream — the pre-audio
  // fix is the old callback, the card waits for a NEW fix and shows nothing
  // from the old one.
  const stale = makeWorld({ run: { phase: 'Idle' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  stale.emitFix(NEAR.lat, NEAR.lng);
  stale.audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 1000 };
  stale.clock.nowMs += 60_000;
  stale.audioPort.snapshotValue = { state: 'idle', positionMs: 0, durationMs: 0 };
  stale.emitFix(NEAR.lat, NEAR.lng);
  // A fresh fix arrived after the audio — still inside the dwell: the card
  // waits for the presence it can confirm, never shows from the old fix.
  const staleState = stale.storeState();
  assert.equal(staleState.kind, 'hidden');
  if (staleState.kind !== 'hidden') return;
  assert.equal(staleState.reason, 'dwell');
});

test('AC4: no fix newer than the quiet episode — the pre-audio position shows nothing', async () => {
  const world = makeWorld();
  await new Promise((resolve) => setTimeout(resolve, 0));
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 5_000;
  await world.audio.play({ token: { kind: 'moment', ref: 'm1', seq: 1 }, path: 'bundles/x/audio/story.m4a' });
  world.audioPort.snapshotValue = { state: 'playing', positionMs: 0, durationMs: 1000 };
  world.notifyRun();
  assert.equal(world.storeState().kind, 'hidden');
  // The audio ends without any new fix arriving: the last one predates the
  // quiet episode — the decision waits, nothing is shown.
  world.audio.stop();
  world.audioPort.snapshotValue = { state: 'idle', positionMs: 0, durationMs: 0 };
  world.notifyRun();
  const state = world.storeState();
  if (state.kind === 'hidden') assert.equal(state.reason, 'stale-fix');
  assert.notEqual(state.kind, 'ready');
});

test('AC2: durable limits — a shown guide never repeats in the window, dismissed keeps re-entry quiet', async () => {
  const world = makeWorld();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dwellToReady(world);
  world.binding.dismiss();
  assert.equal(world.storeState().kind, 'hidden');
  // The dismissal is durable: dismissed_at on the shown row and the cooldown
  // carrier both hold the fact.
  const rows = world.driver
    .prepare(`SELECT dismissed_at FROM guide_hint_state WHERE scope = 'foreground' AND guide_id = 'route-near'`)
    .all();
  assert.ok(rows.length === 1 && rows[0].dismissed_at !== null);
  const last = world.driver.prepare(`SELECT last_dismissed_at FROM guide_hint_last WHERE guide_id = 'route-near'`).all()[0];
  assert.equal(Number(last?.last_dismissed_at), 31_000);
  // Re-entry after departure: the cooldown (one hour) keeps the card quiet.
  world.clock.nowMs += 60_000;
  world.emitFix(FAR.lat, FAR.lng);
  world.clock.nowMs += 30_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 21_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  const state = world.storeState();
  if (state.kind === 'hidden') assert.equal(state.reason, 'limited');
  assert.notEqual(state.kind, 'ready');
  // The carry source holds this window's shown∪dismissed ids.
  assert.deepEqual(world.binding.foregroundCarry(), ['route-near']);
});

test('AC2: session scope — one show per session, the active guide never advertises itself', async () => {
  const world = makeWorld({
    run: activeRun(),
    offers: [offer('route-near'), offer('route-selected')],
    points: [
      { guideId: 'route-near', lat: NEAR.lat, lng: NEAR.lng },
      { guideId: 'route-selected', lat: NEAR.lat, lng: BASE.lng + 0.001 },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const state = dwellToReady(world);
  // The selected guide (route-selected) is not on the card; context active.
  assert.deepEqual(state.guides.map((guide) => guide.routeId), ['route-near']);
  assert.equal(state.context, 'active');
  assert.equal(world.events[0].type, 'guide_nearby_shown');
  if (world.events[0].type !== 'guide_nearby_shown') return;
  assert.equal(world.events[0].session_id, 'walk-1');
  // The session row exists; a second pass of the same fix shows nothing new.
  const shownRows = () =>
    world.driver.prepare(`SELECT guide_id FROM guide_hint_state WHERE scope = 'session'`).all().length;
  assert.equal(shownRows(), 1);
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 5_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  assert.equal(shownRows(), 1);
  assert.equal(world.events.length, 1);
});

test('AC5: openPreview touches no run state — the session survives the tap', async () => {
  const runState = activeRun();
  const world = makeWorld({ run: runState });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dwellToReady(world);
  const runBefore = JSON.stringify(world.runRef.current);
  world.binding.openPreview();
  assert.equal(JSON.stringify(world.runRef.current), runBefore);
  assert.deepEqual(
    world.events.filter((event) => event.type === 'guide_nearby_opened').map((event) => event.session_id),
    ['walk-1'],
  );
  // The run source exposes no mutators the controller could have called —
  // the binding's only outputs are the store, the events and the carry.
  assert.deepEqual(Object.keys(world.runRef), ['current']);
});

test('the telemetry payload carries identifiers only — no coordinates, no distances', async () => {
  const world = makeWorld();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dwellToReady(world);
  world.binding.openPreview();
  world.binding.dismiss();
  for (const event of world.events) {
    assert.deepEqual(Object.keys(event).sort(), ['context', 'session_id', 'shown_guide_ids', 'suggestion_id', 'type'].filter((key) => key !== 'session_id' || event.session_id !== undefined));
    const flat = JSON.stringify(event);
    assert.ok(!flat.includes(String(NEAR.lat)) && !flat.includes(String(NEAR.lng)), 'no coordinates in the payload');
  }
});

test('the root wires no hint controller without the full seam set', async () => {
  const { createServices } = await import('./createServices.ts');
  const locationPort = new FakeLocationOsPort();
  const location = new LocationService({
    port: locationPort,
    clock: { now: () => 0, schedule: () => () => {} },
    permissions: { foreground: 'fg', background: 'bg' },
  });
  const services = createServices({
    location,
    audio: new AudioService({ createPort: () => new FakeAudioPlayerPort() }),
    guideHints: {
      store: dbHintStore(nodeSqliteDriver()),
      values: VALUES,
      points: () => [],
    },
  });
  // No catalog service → no public previews → the honest absence.
  assert.equal(services.hints, undefined);
  assert.equal(services.catalog, undefined);
});

test('a hint-store failure degrades fail-closed — the fix pipeline never sees the DbError', async () => {
  const boom = (): never => {
    throw new DbError('guide-hint-write-failed', 'disk gone');
  };
  const world = makeWorld({
    store: { recordShown: boom, recordDismissed: boom, sessionShown: boom, cooldownBlocked: boom },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The fix dispatch survives a throwing store: no exception leaves the
  // controller, the card hides fail-closed and the failure is sticky — no
  // later fix can present either.
  world.emitFix(NEAR.lat, NEAR.lng);
  world.clock.nowMs += 21_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  const state = world.storeState();
  assert.equal(state.kind, 'hidden');
  if (state.kind !== 'hidden') return;
  assert.equal(state.reason, 'limited');
  world.clock.nowMs += 60_000;
  world.emitFix(NEAR.lat, NEAR.lng);
  assert.equal(world.storeState().kind, 'hidden');
});

test('a failed durable dismissal hides the card and sends no dismissed event', async () => {
  const events: GuideHintEventRecord[] = [];
  const world = makeWorld({
    store: {
      recordShown: () => {},
      recordDismissed: () => {
        throw new DbError('guide-hint-write-failed', 'disk gone');
      },
      sessionShown: () => [],
      cooldownBlocked: () => [],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dwellToReady(world);
  world.binding.dismiss();
  const state = world.storeState();
  assert.equal(state.kind, 'hidden');
  if (state.kind !== 'hidden') return;
  assert.equal(state.reason, 'limited');
  // The shown event of the presentation stands; no dismissed event was sent.
  assert.deepEqual(world.events.map((event) => event.type), ['guide_nearby_shown']);
});
