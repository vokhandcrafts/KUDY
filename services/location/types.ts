// G05.02.b — services/location contract types. Canon anchors, copied not
// paraphrased (implementation-rules 2): `19` §3.3 (the LocationService sketch,
// the FixInput shape, the LocationMode proposal), `09` §6.3 `location` row
// (the ≤ 20-region window of the nearest eligible stops of the whole selected
// set, recomputed on a fresh position / after a trigger / when access widens;
// the watchdog `acquiring → live → recovering → stalled` with the 15 s
// threshold, bounded backoff and a generation counter), `19` §2.3 (the service
// owns the subscription, not the position), `19` §6.8 (a missing permission is
// a status() value, never a throw).
//
// Deliberate extensions of the 19 §3.3 sketch, recorded here once
// (implementation-rules 2/6):
// 1. setGeofenceWindow carries the selected stops with coordinates and a
//    trigger radius — a bare stopIds array cannot compute «бліжэйшыя прыдатныя
//    stops» nor hand the port its regions. This is the controller's selection
//    data, not a second candidate channel: the pipeline keeps its own
//    candidates (09 §6.2) and the service still knows nothing about
//    heard/auto_fired (AR-5).
// 2. status() extends the four watchdog states with 'idle' (the disarmed
//    service holds no subscription — criterion 1) and 'permission-denied'
//    carrying a reason (19 §3.3: «дазволу няма — асобны стан status(), не
//    выкітак»; criterion 4).
// 3. The recompute channel: the pipeline runs in the controller (19 §5.2) and
//    the sketch defines no accepted-fix channel back to the service, so the
//    window recomputes on the latest raw fix the service forwarded; «пасля
//    спрацоўкі» (a trigger) and the AccessReady widening are the controller
//    re-calling setGeofenceWindow — the sketch's controller → service channel.
//
// The port echoes the subscription number the service mints per startFixes;
// that number is the generation counter of 09 §6.3. A fix whose sub is not
// the current one belongs to a previous subscription or a previous session
// and is dropped whole (criterion 3, the proof scenario).

import type { FixInput } from '../../core/pipeline/types.ts';

export type { FixInput };

// Engine spelling (core/engine/state.ts: `export type StopId = string`),
// restated locally because criterion 5 forbids core/engine imports in this
// module.
export type StopId = string;

// 19 §3.3 LocationMode — the class map's proposal, used as-is per the brief's
// canon note; results/G05.02.b.md records which transitions the tests cover.
export type LocationMode = 'idle' | 'city-surface' | 'active-guide' | 'paused';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

// One eligible stop of the controller's selection: identity plus the geometry
// an OS geofence region needs (center and trigger radius in meters).
export interface GeofenceStop {
  stopId: StopId;
  lat: number;
  lng: number;
  radius: number;
}

// The injected OS boundary (the expo-location adapter is G05.02.c; tests use
// the fake in fake-port.ts). One process-level port; the service arms and
// disarms the single subscription through it and never touches an OS API.
export interface LocationOsPort {
  permission(): PermissionState;
  // One OS subscription per call; `sub` is the service-minted generation
  // number and every fix the port delivers later must carry it.
  startFixes(sub: number): void;
  stopFixes(sub: number): void;
  // The ≤ 20-region geofence window (09 §6.3); an empty array is
  // ClearGeofences (19 §4.3: Pause releases GPS and the queue).
  setRegions(regions: ReadonlyArray<GeofenceStop>): void;
  onPortEvent(handler: (event: LocationPortEvent) => void): void;
}

export type LocationPortEvent =
  | { type: 'fix'; sub: number; fix: FixInput }
  | { type: 'permission'; state: 'granted' | 'denied' };

// The watchdog clock (09 §6.3: the 15 s threshold and the bounded backoff run
// on it). Injected so tests drive time deterministically; the composition
// root passes systemLocationClock from service.ts.
export interface LocationClock {
  now(): number;
  schedule(delayMs: number, fn: () => void): () => void;
}

// Everything the service needs from outside — the port, the clock and an
// optional diagnostic sink that must never receive fix values (criterion 6 is
// test-guarded).
export interface LocationServiceDeps {
  port: LocationOsPort;
  clock: LocationClock;
  log?: (message: string) => void;
}

export type LocationStatus =
  | { state: 'idle' }
  | { state: 'acquiring' }
  | { state: 'live' }
  | { state: 'recovering' }
  | { state: 'stalled' }
  | { state: 'permission-denied'; reason: 'denied' | 'revoked-mid-session' };

// 09 §6.3 canon numbers.
export const GEOFENCE_WINDOW_MAX = 20; // the hard iOS limit behind the sliding window
export const WATCHDOG_GAP_MS = 15_000; // «фіксы перасталі прыходзіць» — an other failure than «фіксы дрэнныя»

// Bounded resubscribe backoff (09 §6.3: «перазапуск падпіскі з абмежаваным
// backoff»). The first attempt fires the moment the gap is detected, the
// next ones after these delays; when the list runs out the watchdog stalls
// and stops trying (a fresh fix of the still-live subscription returns it to
// live). The numbers are this implementation's, not canon — recorded in
// results/G05.02.b.md.
export const RESUBSCRIBE_DELAYS_MS: ReadonlyArray<number> = [1_000, 2_000, 4_000, 8_000];
