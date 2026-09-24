// G05.02.b — acceptance suite for the location service (issue #211,
// docs/agent-tasks/run/G05.02.b.md) over the fake OS port and a manual clock.
// Criteria:
// 1. One OS subscription at most — repeated setMode and armed-mode changes
//    never start a second one; idle/paused hold none (the fake counts).
// 2. The geofence window holds at most 20 regions: the nearest stops of the
//    whole selected set by the latest fix, never the next ones by route
//    position; recomputed on a fresh fix and on every setGeofenceWindow
//    re-call (a trigger, an AccessReady widening); a 25-stop fixture pins the
//    cap and the choice by construction.
// 3. Watchdog acquiring → live → recovering → stalled: the 15 s gap, the
//    bounded 1/2/4/8 s backoff, and the generation check — a fix of a
//    previous subscription (after a resubscribe) or of a previous session
//    (after a disarm) is dropped whole. Time is an injected manual clock.
// 4. Permission denied at arm and revoked mid-session are status() values
//    with a reason, never exceptions; a revocation releases the subscription
//    and the window, so no stale live state or stale fix survives.
// 5. Raw fixes are forwarded to the controller unchanged (same object); the
//    module imports nothing from core/engine (source tripwire; the zone gate
//    is npm run arch:check).
// 6. No coordinates are logged (the captured diagnostic sink) — while fixes
//    flow, every captured line is coordinate-free.
// Proof: removing the `event.sub !== this.currentSub` check in service.ts
// fails «criterion 3 proof: a fix of a previous generation after a
// resubscribe is dropped whole».
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoEngineImports } from '../engine-zone-guard.ts';
import { FakeLocationOsPort } from './fake-port.ts';
import { LocationService } from './service.ts';
import type { FixInput, GeofenceStop, LocationStatus } from './types.ts';
import { GEOFENCE_WINDOW_MAX, WATCHDOG_GAP_MS } from './types.ts';

// The injected clock of criterion 3: time moves only when a test advances it,
// and every scheduled callback fires exactly once, in due order — the
// watchdog's gap watch and backoff steps become deterministic.
class ManualClock {
  private nowMs = 0;
  private scheduled: { due: number; fn: () => void }[] = [];

  now(): number {
    return this.nowMs;
  }

  schedule(delayMs: number, fn: () => void): () => void {
    const entry = { due: this.nowMs + delayMs, fn };
    this.scheduled.push(entry);
    return () => {
      this.scheduled = this.scheduled.filter((e) => e !== entry);
    };
  }

  advance(ms: number): void {
    const limit = this.nowMs + ms;
    for (;;) {
      const due = this.scheduled.filter((e) => e.due <= limit).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      this.scheduled = this.scheduled.filter((e) => e !== due);
      this.nowMs = Math.max(this.nowMs, due.due);
      due.fn();
    }
    this.nowMs = limit;
  }
}

// Synthetic fixture around one meridian (Gdańsk latitude): stop k sits
// k·0.001° north of the first fix, so distance order is fixed by
// construction. The ids run opposite to the distance order (stop-01 is the
// route-first and the geo-farthest), which is what separates «бліжэйшыя
// прыдатныя stops з усяго набору» from «наступныя па position».
const FIRST_FIX: FixInput = { lat: 54.4, lng: 18.65, accuracy: 5, at: 1_000 };
// 0.024° north of FIRST_FIX: the previously farthest stop-01 becomes a
// neighbour, the previously nearest stop-25 falls out — the window follows
// the fix.
const SECOND_FIX: FixInput = { lat: 54.424, lng: 18.65, accuracy: 5, at: 2_000 };
const makeStops = (count: number): GeofenceStop[] =>
  Array.from({ length: count }, (_, i) => ({
    stopId: `stop-${String(count - i).padStart(2, '0')}`,
    lat: 54.4 + (i + 1) * 0.001,
    lng: 18.65,
    radius: 30,
  }));
const windowIds = (regions: ReadonlyArray<GeofenceStop>): string[] =>
  regions.map((region) => region.stopId).sort();

// The common arrange of the window and watchdog scenarios: armed, the whole
// 25-stop selection handed in, the given fixes delivered on the current
// subscription.
function seedWindow(h: Harness, ...fixes: FixInput[]): void {
  h.arm();
  h.service.setGeofenceWindow(makeStops(25));
  for (const fix of fixes) h.port.emitFix(h.currentSub(), fix);
}

interface Harness {
  service: LocationService;
  port: FakeLocationOsPort;
  clock: ManualClock;
  fixes: FixInput[];
  lines: string[];
  // The subscription number the service minted last (its generation).
  currentSub(): number;
  arm(): void;
  assertClean(): void;
}

function makeService(permission: 'granted' | 'denied' | 'undetermined' = 'granted'): Harness {
  const port = new FakeLocationOsPort();
  port.permissionState = permission;
  const clock = new ManualClock();
  const fixes: FixInput[] = [];
  const lines: string[] = [];
  const service = new LocationService({ port, clock, log: (message) => lines.push(message) });
  service.onFix((fix) => fixes.push(fix));
  const currentSub = (): number => {
    const starts = port.commands.filter((command) => command.startsWith('start '));
    assert.ok(starts.length > 0, 'no subscription was ever started');
    return Number(starts[starts.length - 1].slice('start '.length));
  };
  return {
    service,
    port,
    clock,
    fixes,
    lines,
    currentSub,
    arm: () => service.setMode('active-guide'),
    assertClean: () => assert.deepEqual(port.violations, []),
  };
}

const statusState = (status: LocationStatus): string => status.state;

// --- criterion 1: one OS subscription at most --------------------------------

test('criterion 1: repeated setMode calls hold exactly one subscription', () => {
  const h = makeService();
  h.service.setMode('active-guide');
  h.service.setMode('active-guide');
  h.service.setMode('active-guide');
  assert.deepEqual(h.port.commands, ['start 1']);
  assert.equal(h.port.activeSubscriptions(), 1);
  h.assertClean();
});

test('criterion 1: a change between armed modes carries the one subscription over', () => {
  const h = makeService();
  h.service.setMode('active-guide');
  h.service.setMode('city-surface');
  h.service.setMode('active-guide');
  assert.deepEqual(h.port.commands, ['start 1']);
  assert.equal(h.port.activeSubscriptions(), 1);
  h.assertClean();
});

test('criterion 1: idle and paused hold none; re-arming starts a fresh generation', () => {
  const h = makeService();
  assert.equal(h.port.activeSubscriptions(), 0);
  h.arm();
  h.service.setMode('paused');
  assert.equal(h.port.activeSubscriptions(), 0);
  // ClearGeofences on pause (19 §4.3): the window is released with the fix.
  assert.deepEqual(h.port.regions, []);
  h.service.setMode('idle');
  assert.equal(h.port.activeSubscriptions(), 0);
  h.service.setMode('active-guide');
  assert.deepEqual(h.port.commands, ['start 1', 'stop 1', 'regions 0', 'start 2']);
  assert.equal(h.port.activeSubscriptions(), 1);
  h.assertClean();
});

// --- criterion 2: the geofence window ----------------------------------------

test('criterion 2: no fix yet — the window stays empty, the cap is not guessable', () => {
  const h = makeService();
  h.arm();
  h.service.setGeofenceWindow(makeStops(25));
  assert.deepEqual(h.port.regions, []);
  assert.equal(h.port.regionPushes, 0);
  h.assertClean();
});

test('criterion 2: 25 selected stops push the 20 nearest by the fix, never the route-next ones', () => {
  const h = makeService();
  seedWindow(h, FIRST_FIX);
  assert.equal(h.port.regions.length, GEOFENCE_WINDOW_MAX);
  // k = 1..20 (stop-25 … stop-06) are the twenty nearest; the route-first
  // stop-01 sits farthest and must not make the window by route position.
  assert.deepEqual(windowIds(h.port.regions), makeStops(25).slice(0, 20).map((s) => s.stopId).sort());
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-01'), false);
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-25'), true);
  h.assertClean();
});

test('criterion 2: a fresh fix recomputes the window around the new position', () => {
  const h = makeService();
  seedWindow(h, FIRST_FIX, SECOND_FIX);
  assert.equal(h.port.regions.length, GEOFENCE_WINDOW_MAX);
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-01'), true);
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-25'), false);
  h.assertClean();
});

test('criterion 2: a setGeofenceWindow re-call (trigger, AccessReady) re-ranks with the widened set', () => {
  const h = makeService();
  seedWindow(h, FIRST_FIX);
  const widened = [
    ...makeStops(25),
    { stopId: 'stop-access', lat: 54.4001, lng: 18.65, radius: 30 }, // ≈ 11 m from the fix
  ];
  h.service.setGeofenceWindow(widened);
  assert.equal(h.port.regions.length, GEOFENCE_WINDOW_MAX);
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-access'), true);
  // The window stays a window: the farthest previous member made room.
  assert.equal(h.port.regions.some((region) => region.stopId === 'stop-06'), false);
  h.assertClean();
});

test('criterion 2: a set of up to 20 pushes all of it; an empty set clears the window', () => {
  const h = makeService();
  h.arm();
  h.service.setGeofenceWindow(makeStops(3));
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.equal(h.port.regions.length, 3);
  h.service.setGeofenceWindow([]);
  assert.deepEqual(h.port.regions, []);
  h.assertClean();
});

test('criterion 2: stops with invalid or duplicate geometry are dropped with a diagnostic', () => {
  const h = makeService();
  h.arm();
  const stops = makeStops(3);
  h.service.setGeofenceWindow([
    ...stops,
    { stopId: 'stop-nan', lat: Number.NaN, lng: 18.65, radius: 30 },
    { stopId: 'stop-zero', lat: 54.41, lng: 18.65, radius: 0 },
    { stopId: 'stop-01', lat: 54.42, lng: 18.65, radius: 30 }, // duplicate id
  ]);
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(windowIds(h.port.regions), stops.map((s) => s.stopId).sort());
  assert.ok(h.lines.some((line) => line.includes('dropped 3 stops')));
  h.assertClean();
});

// --- criterion 3: the watchdog ------------------------------------------------

test('criterion 3: no fix within 15 s of arming enters recovering with a resubscribe', () => {
  const h = makeService();
  h.arm();
  assert.deepEqual(h.service.status(), { state: 'acquiring' });
  h.clock.advance(WATCHDOG_GAP_MS - 1);
  assert.deepEqual(h.service.status(), { state: 'acquiring' });
  h.clock.advance(1);
  assert.deepEqual(h.service.status(), { state: 'recovering' });
  assert.deepEqual(h.port.commands, ['start 1', 'stop 1', 'start 2']);
  assert.equal(h.port.activeSubscriptions(), 1);
  h.assertClean();
});

test('criterion 3: a first fix turns acquiring into live; the gap re-arms the watchdog', () => {
  const h = makeService();
  h.arm();
  h.clock.advance(5_000);
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(h.service.status(), { state: 'live' });
  h.clock.advance(WATCHDOG_GAP_MS - 1);
  assert.deepEqual(h.service.status(), { state: 'live' });
  h.clock.advance(1);
  assert.deepEqual(h.service.status(), { state: 'recovering' });
  h.assertClean();
});

test('criterion 3: the backoff is bounded 1/2/4/8 s and then the watchdog stalls', () => {
  const h = makeService();
  h.arm();
  h.clock.advance(WATCHDOG_GAP_MS); // gap → attempt 1
  assert.deepEqual(h.port.commands.slice(-2), ['stop 1', 'start 2']);
  h.clock.advance(999);
  assert.deepEqual(h.port.commands.slice(-2), ['stop 1', 'start 2']);
  h.clock.advance(1); // attempt 2
  assert.deepEqual(h.port.commands.slice(-2), ['stop 2', 'start 3']);
  h.clock.advance(2_000); // attempt 3
  assert.deepEqual(h.port.commands.slice(-2), ['stop 3', 'start 4']);
  h.clock.advance(4_000); // attempt 4
  assert.deepEqual(h.port.commands.slice(-2), ['stop 4', 'start 5']);
  h.clock.advance(8_000); // the list ran out
  assert.deepEqual(h.service.status(), { state: 'stalled' });
  assert.deepEqual(h.port.commands.slice(-1), ['start 5']);
  assert.equal(h.port.activeSubscriptions(), 1); // the last subscription stays live
  h.assertClean();
});

test('criterion 3 proof: a fix of a previous generation after a resubscribe is dropped whole', () => {
  const h = makeService();
  h.arm();
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  h.clock.advance(WATCHDOG_GAP_MS); // resubscribe → generation 2
  const stale = h.currentSub() - 1;
  h.port.emitFix(stale, { lat: 54.41, lng: 18.66, accuracy: 5, at: 2_000 });
  assert.deepEqual(h.fixes, [FIRST_FIX]);
  // The stale fix also must not re-rank the window.
  const windowBefore = h.port.regionPushes;
  h.port.emitFix(h.currentSub(), { lat: 54.402, lng: 18.65, accuracy: 5, at: 2_500 });
  assert.equal(h.port.regionPushes, windowBefore + 1);
  h.assertClean();
});

test('criterion 3: a fix of a previous session after a disarm is dropped whole', () => {
  const h = makeService();
  h.arm();
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  const oldSub = h.currentSub();
  h.service.setMode('idle');
  h.port.emitFix(oldSub, { lat: 54.41, lng: 18.66, accuracy: 5, at: 2_000 });
  assert.deepEqual(h.fixes, [FIRST_FIX]);
  h.assertClean();
});

test('criterion 3: a fresh fix during recovering returns to live and resets the backoff', () => {
  const h = makeService();
  h.arm();
  h.clock.advance(WATCHDOG_GAP_MS); // attempt 1, generation 2
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(h.service.status(), { state: 'live' });
  h.clock.advance(WATCHDOG_GAP_MS); // the gap opened again → a fresh recovery
  assert.deepEqual(h.service.status(), { state: 'recovering' });
  h.assertClean();
});

// --- criterion 4: permission is a status, never an exception ------------------

test('criterion 4: a denied permission at arm is a status value with a reason', () => {
  const h = makeService('denied');
  h.service.setMode('active-guide');
  assert.deepEqual(h.service.status(), { state: 'permission-denied', reason: 'denied' });
  assert.equal(h.port.activeSubscriptions(), 0);
  h.assertClean();
});

test('criterion 4: an undetermined permission waits as acquiring; the grant arms the subscription', () => {
  const h = makeService('undetermined');
  h.service.setMode('active-guide');
  assert.deepEqual(h.service.status(), { state: 'acquiring' });
  assert.equal(h.port.activeSubscriptions(), 0);
  h.port.reportPermission('granted');
  assert.deepEqual(h.port.commands, ['start 1']);
  assert.deepEqual(h.service.status(), { state: 'acquiring' });
  h.assertClean();
});

test('criterion 4: a mid-session revocation releases everything — no stale live, no stale window', () => {
  const h = makeService();
  h.arm();
  h.service.setGeofenceWindow(makeStops(25));
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(statusState(h.service.status()), 'live');
  h.port.reportPermission('denied');
  assert.deepEqual(h.service.status(), { state: 'permission-denied', reason: 'revoked-mid-session' });
  assert.equal(h.port.activeSubscriptions(), 0);
  assert.deepEqual(h.port.regions, []);
  const oldSub = h.currentSub();
  h.port.emitFix(oldSub, { lat: 54.41, lng: 18.66, accuracy: 5, at: 2_000 });
  assert.deepEqual(h.fixes, [FIRST_FIX]);
  // A later grant re-arms from zero: the revoked fix memory must be gone, or
  // the old window would come back before any fresh fix arrives.
  h.port.reportPermission('granted');
  assert.deepEqual(h.service.status(), { state: 'acquiring' });
  assert.deepEqual(h.port.regions, []);
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(statusState(h.service.status()), 'live');
  h.assertClean();
});

test('criterion 4: a revocation while disarmed is a status value, not a crash', () => {
  const h = makeService();
  h.service.setMode('idle');
  h.port.reportPermission('denied');
  assert.deepEqual(h.service.status(), { state: 'permission-denied', reason: 'denied' });
  h.assertClean();
});

// --- criterion 5: raw fixes unchanged; no engine import -----------------------

test('criterion 5: the controller sink receives the port fix object unchanged', () => {
  const h = makeService();
  h.arm();
  const raw: FixInput = { lat: 54.41, lng: 18.66, accuracy: 8, at: 1_500 };
  h.port.emitFix(h.currentSub(), raw);
  assert.equal(h.fixes.length, 1);
  assert.strictEqual(h.fixes[0], raw);
  // The window recompute around the same fix never mutates it.
  assert.deepEqual(raw, { lat: 54.41, lng: 18.66, accuracy: 8, at: 1_500 });
  h.assertClean();
});

test('criterion 5: a second onFix call replaces the controller sink', () => {
  const h = makeService();
  h.arm();
  const lateFixes: FixInput[] = [];
  h.service.onFix((fix) => lateFixes.push(fix));
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  assert.deepEqual(h.fixes, []);
  assert.deepEqual(lateFixes, [FIRST_FIX]);
  h.assertClean();
});

test('criterion 5: the services/location sources import nothing from core/engine', async () => {
  await assertNoEngineImports(new URL('./', import.meta.url), [
    'types.ts',
    'service.ts',
    'fake-port.ts',
    'service.test.ts',
  ]);
});

// --- criterion 6: no coordinates in the diagnostic log ------------------------

test('criterion 6: while fixes flow, the captured log carries no coordinate value', () => {
  const h = makeService();
  seedWindow(h, FIRST_FIX, SECOND_FIX);
  h.clock.advance(WATCHDOG_GAP_MS); // into recovering and back
  h.port.emitFix(h.currentSub(), FIRST_FIX);
  h.port.reportPermission('denied');
  h.port.reportPermission('granted');
  assert.ok(h.lines.length >= 8, `the log was not exercised: ${JSON.stringify(h.lines)}`);
  for (const line of h.lines) {
    assert.equal(line.includes('54.4'), false, `latitude leaked into the log: ${line}`);
    assert.equal(line.includes('18.65'), false, `longitude leaked into the log: ${line}`);
  }
  h.assertClean();
});
