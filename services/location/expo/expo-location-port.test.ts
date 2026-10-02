// G20.07 — behavioral tests of the production expo adapter over the real
// LocationService (the G20.02 pattern: the only mock is the expo modules,
// replaced with node:test module mocks before the adapter import; the npm
// test node invocation passes --experimental-test-module-mocks). The merged
// single permissionState is the defect under test (expo-location-port.ts:
// one permission answer per scope, runtime.md R4): reverting the scoped
// tracking or the ask-generation guard turns foreground_granted_background_
// denied and stale_permission_reply red — the background denial then
// disarms a live foreground session (implementation-rules 1). Android/iOS
// dialog behavior and physical background work stay explicitly unverified
// until device acceptance (criterion 4) — no mock test here claims them.
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

import type { FixInput } from '../types.ts';
import type { OsLocationObject } from './fix-mapping.ts';
import type { LocationExtras } from './location-config.ts';
import { LocationService } from '../service.ts';

// --- the expo module stand-ins ----------------------------------------------

type StatusSpelling = 'granted' | 'denied' | 'undetermined';
interface PermissionResponseLike {
  status: StatusSpelling;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Every ask hands out its own deferred: the tests hold replies pending and
// deliver them in whichever order the race under test needs. An already
// settled promise ignores a second resolve, so a retry needs a fresh ask.
let foregroundRead: Deferred<PermissionResponseLike>;
let foregroundAsks: Array<Deferred<PermissionResponseLike>>;
let backgroundAsks: Array<Deferred<PermissionResponseLike>>;
let watchStart: Deferred<{ remove(): void }>;
let backgroundStarted: boolean;

interface RecordingWatch {
  callback(location: OsLocationObject): void;
  onError(error: unknown): void;
  removeCalls: number;
}
const watches: RecordingWatch[] = [];
// Every background task executor keyed by the registered task name.
const definedTasks = new Map<string, (event: { data?: { locations: OsLocationObject[] }; error?: unknown }) => void>();
const locationCalls: string[] = [];

function resetStandIns(): void {
  foregroundRead = deferred();
  foregroundAsks = [];
  backgroundAsks = [];
  watchStart = deferred();
  backgroundStarted = false;
  watches.length = 0;
  definedTasks.clear();
  locationCalls.length = 0;
}

mock.module('expo-location', {
  namedExports: {
    Accuracy: { High: 3 },
    getForegroundPermissionsAsync: () => {
      locationCalls.push('readForeground');
      return foregroundRead.promise;
    },
    requestForegroundPermissionsAsync: () => {
      locationCalls.push('askForeground');
      const ask = deferred<PermissionResponseLike>();
      foregroundAsks.push(ask);
      return ask.promise;
    },
    requestBackgroundPermissionsAsync: () => {
      locationCalls.push('askBackground');
      const ask = deferred<PermissionResponseLike>();
      backgroundAsks.push(ask);
      return ask.promise;
    },
    watchPositionAsync: (
      _options: unknown,
      callback: (location: OsLocationObject) => void,
      onError: (error: unknown) => void,
    ) => {
      locationCalls.push('watch');
      const watch: RecordingWatch = { callback, onError, removeCalls: 0 };
      watches.push(watch);
      return watchStart.promise.then((handle) => ({
        remove: () => {
          watch.removeCalls += 1;
          handle.remove();
        },
      }));
    },
    startLocationUpdatesAsync: (taskName: string) => {
      locationCalls.push(`startUpdates:${taskName}`);
      backgroundStarted = true;
      return Promise.resolve();
    },
    hasStartedLocationUpdatesAsync: () => Promise.resolve(backgroundStarted),
    stopLocationUpdatesAsync: () => {
      locationCalls.push('stopUpdates');
      backgroundStarted = false;
      return Promise.resolve();
    },
  },
});
mock.module('expo-task-manager', {
  namedExports: {
    defineTask: (
      name: string,
      executor: (event: { data?: { locations: OsLocationObject[] }; error?: unknown }) => void,
    ) => {
      definedTasks.set(name, executor);
    },
  },
});
mock.module('expo-constants', {
  defaultExport: { expoConfig: null },
});

const { ExpoLocationOsPort } = await import('./expo-location-port.ts');

// --- the harness -------------------------------------------------------------

const extras: LocationExtras = {
  locationExplanations: { foreground: 'fg-why', background: 'bg-why' },
  locationForegroundService: { notificationTitle: 't', notificationBody: 'b' },
};

// The watchdog clock never fires — the criteria under test are the
// permission and scope paths, not the gap watch.
function setup(): {
  port: InstanceType<typeof ExpoLocationOsPort>;
  service: LocationService;
  fixes: FixInput[];
} {
  resetStandIns();
  const port = new ExpoLocationOsPort(extras);
  const fixes: FixInput[] = [];
  const service = new LocationService({
    port,
    clock: { now: () => 1000, schedule: () => () => {} },
    permissions: { foreground: 'fg-why', background: 'bg-why' },
  });
  service.onFix((fix) => fixes.push(fix));
  return { port, service, fixes };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function osFix(at: number): OsLocationObject {
  return { coords: { latitude: 53.9, longitude: 27.56, accuracy: 5 }, timestamp: 1000 + at };
}

const TASK = 'KUDY/location-updates';
const updatesAsked = () => locationCalls.some((call) => call.startsWith('startUpdates'));

test('foreground_granted_background_denied: a background denial keeps the granted foreground session running', async () => {
  const { port, service, fixes } = setup();
  service.setMode('city-surface');
  foregroundAsks[0].resolve({ status: 'granted' });
  await flush();
  watchStart.resolve({ remove() {} });
  await flush();
  assert.equal(watches.length, 1, 'the foreground watch is running');
  watches[0].callback(osFix(1));
  assert.equal(fixes.length, 1, 'the fix reaches the controller through the watch');
  assert.deepEqual(service.status(), { state: 'live' });

  // The Start path carries the subscription over and asks the background
  // scope; the answer is a denial.
  service.setMode('active-guide');
  backgroundAsks[0].resolve({ status: 'denied' });
  await flush();

  assert.ok(locationCalls.includes('askBackground'), 'the background question was asked');
  assert.ok(!updatesAsked(), 'no background updates are requested');
  assert.equal(watches[0].removeCalls, 0, 'the foreground watch is not stopped by the background denial');
  assert.equal(port.permission(), 'granted', 'the background denial is not passed off as a foreground denial');

  // Reverting the scoped tracking disarms the session here: the denial
  // reaches the service as a revocation, the watch is removed and this fix
  // never lands (implementation-rules 1).
  watches[0].callback(osFix(2));
  assert.equal(fixes.length, 2, 'foreground fixes keep flowing after the background denial');
  assert.deepEqual(service.status(), { state: 'live' });
});

test('background_denied_limited_path: a background-intent start with the scope denied runs the foreground watch', async () => {
  const { port } = setup();
  port.requestPermission('foreground', 'fg-why');
  foregroundAsks[0].resolve({ status: 'granted' });
  await flush();
  port.requestPermission('background', 'bg-why');
  backgroundAsks[0].resolve({ status: 'denied' });
  await flush();
  assert.equal(port.permission(), 'granted');

  // The limited path (runtime.md R4): the background start happens only
  // with the needed permission; otherwise the foreground watch carries the
  // session — and with neither scope granted no watcher starts at all.
  port.startFixes(1);
  watchStart.resolve({ remove() {} });
  await flush();
  assert.equal(watches.length, 1, 'the foreground watch carries the session');
  assert.ok(!updatesAsked(), 'no background task without the background grant');

  port.stopFixes(1);
  await flush();
  assert.equal(watches[0].removeCalls, 1, 'the limited-path watch is stopped cleanly');
  assert.ok(!updatesAsked());
});

test('all_permissions_denied: neither watcher starts and the visible permission state stays accurate', async () => {
  const { port, service } = setup();
  service.setMode('city-surface');
  foregroundAsks[0].resolve({ status: 'denied' });
  await flush();

  assert.equal(port.permission(), 'denied');
  assert.deepEqual(service.status(), { state: 'permission-denied', reason: 'denied' });
  assert.equal(watches.length, 0, 'no foreground watch without the foreground grant');
  assert.ok(!updatesAsked(), 'no background task without the background grant');

  // The Start path asks the background scope on top; both denied — the
  // visible state holds, nothing starts.
  service.setMode('active-guide');
  backgroundAsks[0].resolve({ status: 'denied' });
  await flush();

  assert.equal(port.permission(), 'denied');
  assert.deepEqual(service.status(), { state: 'permission-denied', reason: 'denied' });
  assert.equal(watches.length, 0);
  assert.ok(!updatesAsked());
});

test('stale_permission_reply: a superseded ask cannot overwrite a newer capability decision', async () => {
  const { port, service, fixes } = setup();
  // Out-of-order asks: the foreground ask goes out with the city surface,
  // the background ask supersedes it at the Start path, and the replies
  // arrive in reverse order.
  service.setMode('city-surface');
  service.setMode('active-guide');
  backgroundAsks[0].resolve({ status: 'granted' });
  await flush();

  // The background grant implies the foreground capability — the session
  // starts on the background task.
  assert.ok(updatesAsked(), 'the background task runs under the granted background scope');

  // The stale foreground reply arrives last. It is a superseded decision:
  // dropping it keeps the session alive; applying it would merge a denial
  // over a newer grant and disarm the session (criterion 3).
  foregroundAsks[0].resolve({ status: 'denied' });
  await flush();
  assert.equal(port.permission(), 'granted');
  assert.deepEqual(service.status(), { state: 'acquiring' });

  definedTasks.get(TASK)?.({ data: { locations: [osFix(1)] } });
  assert.equal(fixes.length, 1, 'fixes flow through the background task');
  assert.deepEqual(service.status(), { state: 'live' });

  // Re-arm after the pause: the standing foreground grant carries the fresh
  // subscription, and the never-answered old ask of the same scope is
  // simply gone — it cannot win when a newer decision exists.
  const updatesBeforeReArm = locationCalls.filter((call) => call.startsWith('startUpdates')).length;
  service.setMode('paused');
  await flush();
  service.setMode('city-surface');
  watchStart.resolve({ remove() {} });
  await flush();
  assert.equal(watches.length, 1, 'the re-armed surface runs on the foreground watch');
  assert.equal(
    locationCalls.filter((call) => call.startsWith('startUpdates')).length,
    updatesBeforeReArm,
    'the re-armed surface does not restart the background task',
  );
  watches[0].callback(osFix(2));
  assert.equal(fixes.length, 2);
  assert.deepEqual(service.status(), { state: 'live' });
});

test('initial_permission_read_superseded: the constructor read cannot overwrite a newer ask', async () => {
  const { port, service, fixes } = setup();
  service.setMode('city-surface');
  foregroundAsks[0].resolve({ status: 'granted' });
  await flush();
  watchStart.resolve({ remove() {} });
  await flush();
  watches[0].callback(osFix(1));
  assert.equal(fixes.length, 1);

  // The constructor's initial read lands late: ask generation 0 is
  // superseded, the live session ignores it. Without the guard the denial
  // would overwrite the newer grant and disarm the session.
  foregroundRead.resolve({ status: 'denied' });
  await flush();
  assert.equal(port.permission(), 'granted');
  assert.deepEqual(service.status(), { state: 'live' });
  watches[0].callback(osFix(2));
  assert.equal(fixes.length, 2, 'the session keeps flowing past the late read');
});

test('background_granted_starts_updates: the granted background scope still starts and stops the background task', async () => {
  const { service } = setup();
  // Fresh install Start path: the background ask is the first question.
  service.setMode('active-guide');
  backgroundAsks[0].resolve({ status: 'granted' });
  await flush();

  // The task executor is registered once per process (the first background
  // start of the suite owns it — stale_permission_reply proves the batch
  // delivery through it); this test pins the start/stop mechanics.
  assert.ok(updatesAsked(), 'the background task starts under the granted background scope');

  service.setMode('paused');
  await flush();
  assert.ok(locationCalls.includes('stopUpdates'), 'the background task is stopped with the subscription');
});
