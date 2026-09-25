// G05.02.b — the location service: a plain class over an injected OS port
// (the services/db and services/contentRepo pattern). It owns the one OS
// subscription, the ≤ 20-region geofence window and the watchdog; it does not
// own the position and makes no trigger decision (19 §2.3, AR-5): raw fixes
// are forwarded to the controller unchanged and the pipeline runs there
// (19 §5.2). The service imports nothing from core/engine (criterion 6,
// tripwired in the boundary suite); window distances come from the pure
// core/geo helper G05.02.a already provides.
import { haversineMeters } from '../../core/geo/haversine.ts';
import type {
  FixInput,
  GeofenceStop,
  LocationClock,
  LocationMode,
  LocationOsPort,
  LocationPermissionScope,
  LocationPortEvent,
  LocationServiceDeps,
  LocationStatus,
  PermissionState,
} from './types.ts';
import { GEOFENCE_WINDOW_MAX, RESUBSCRIBE_DELAYS_MS, WATCHDOG_GAP_MS } from './types.ts';

// Both modes hold the one foreground subscription (09 §20: without a session
// it belongs to the open city surface and is released when it closes or goes
// to the background); `idle` and `paused` hold none (criterion 1).
function isArmed(mode: LocationMode): boolean {
  return mode === 'city-surface' || mode === 'active-guide';
}

// The permission question each armed transition asks (AC2 of G05.02.c):
// the city surface needs only the foreground answer, the Start path
// (active-guide, 09 §9: the background permission is asked at route start,
// with the explanation) asks background. Only called for armed modes.
function armedPermissionScope(mode: LocationMode): LocationPermissionScope {
  return mode === 'active-guide' ? 'background' : 'foreground';
}

type WatchdogState = 'idle' | 'acquiring' | 'live' | 'recovering' | 'stalled';

export class LocationService {
  private readonly port: LocationOsPort;
  private readonly clock: LocationClock;
  private readonly permissions: { foreground: string; background: string };
  private readonly log: (message: string) => void;

  private mode: LocationMode = 'idle';
  private permission: PermissionState;
  private permissionReason: 'denied' | 'revoked-mid-session' = 'denied';
  // The generation counter (09 §6.3): every subscription gets the next number
  // and the port tags its fixes with it; after a disarm currentSub is null, so
  // a fix of a previous subscription or a previous session matches nothing
  // and is dropped whole (criterion 3, the proof scenario).
  private generation = 0;
  private currentSub: number | null = null;
  private watchdog: WatchdogState = 'idle';
  private recoveryAttempts = 0;
  private tickCancel: (() => void) | null = null;
  // The latest raw fix, kept for one purpose only — the window geometry
  // (09 §6.3: пералік па свежай пазіцыі). It is not exposed: the controller's
  // accepted last_fix (engine state) stays the single position truth for
  // decisions, and nothing outside the watchdog may read this copy.
  private lastFix: FixInput | null = null;
  private lastFixAt: number | null = null;
  private stops: ReadonlyArray<GeofenceStop> = [];
  private fixSink: ((fix: FixInput) => void) | null = null;

  constructor(deps: LocationServiceDeps) {
    this.port = deps.port;
    this.clock = deps.clock;
    this.permissions = deps.permissions;
    this.log = deps.log ?? (() => {});
    this.permission = deps.port.permission();
    this.port.onPortEvent((event) => this.onPortEvent(event));
  }

  // 19 §3.3: arming/disarming the subscription and the geofences. Repeating
  // the current mode is a no-op, and a change between the two armed modes
  // carries the one subscription over — never a second startFixes
  // (criterion 1). Every transition INTO an armed mode asks exactly one
  // permission question (AC2 of G05.02.c): the carry-over Start path
  // (city-surface → active-guide) asks background even though the
  // subscription persists — 09 §9 puts the background question at route
  // start, and a subscription inherited from the city surface has never
  // asked it.
  setMode(mode: LocationMode): void {
    if (mode === this.mode) return;
    const wasArmed = isArmed(this.mode);
    this.mode = mode;
    if (wasArmed && !isArmed(mode)) {
      this.log(`mode → ${mode}: releasing the subscription and the window`);
      this.disarm();
    } else if (!wasArmed && isArmed(mode)) {
      this.log(`mode → ${mode}: arming`);
      this.arm();
    } else if (isArmed(mode)) {
      this.log(`mode → ${mode}: the one subscription carries over`);
      this.requestPermissionFor(mode);
    }
    // disarmed → disarmed (paused ↔ idle): nothing is held, nothing is asked.
  }

  // 19 §3.3: the controller's selected (eligible) stop set. Recomputes the
  // window immediately when the service can rank it; while disarmed or
  // without a fix it only stores the set — arming and the next fix pick it
  // up. A trigger (re-arm) and an AccessReady widening are re-calls of this
  // method (extension 3 in the types.ts header).
  setGeofenceWindow(stops: ReadonlyArray<GeofenceStop>): void {
    const { kept, dropped } = sanitizeStops(stops);
    if (dropped > 0) {
      this.log(`setGeofenceWindow: dropped ${dropped} stops with invalid or duplicate geometry`);
    }
    this.stops = kept;
    this.recomputeWindow();
  }

  // The single controller sink (19 §3.3 onFix). A second call replaces it,
  // like the audio service's onEvent.
  onFix(handler: (fix: FixInput) => void): void {
    this.fixSink = handler;
  }

  status(): LocationStatus {
    if (this.permission === 'denied') {
      return { state: 'permission-denied', reason: this.permissionReason };
    }
    if (!isArmed(this.mode)) return { state: 'idle' };
    return { state: this.watchdog };
  }

  private arm(): void {
    if (this.permission === 'denied') {
      this.permissionReason = 'denied';
      this.log('arming refused by the OS permission — status() reports it, no exception');
      return;
    }
    // The question goes out on every armed transition — even granted, where
    // the OS answers without a dialog: a foreground grant does not answer
    // the background question, and the port's single PermissionState cannot
    // tell them apart (the adapter's request is what resolves it).
    this.requestPermissionFor(this.mode);
    if (this.permission === 'undetermined') {
      // The permission question belongs to the UI (09 §9: asked at route
      // start, with the explanation); until it is answered the watchdog is
      // honestly 'acquiring' — waiting, not subscribed. The grant event
      // re-enters through onPermission.
      this.watchdog = 'acquiring';
      this.log('arming while the permission is undetermined — waiting for the grant');
      return;
    }
    this.watchdog = 'acquiring';
    this.startSubscription();
    this.scheduleGapWatch();
  }

  // One request per armed transition, carrying the mode's scope and the
  // app-config explanation string (AC2); the answer returns as a permission
  // port event.
  private requestPermissionFor(mode: LocationMode): void {
    const scope = armedPermissionScope(mode);
    const explanation = scope === 'background' ? this.permissions.background : this.permissions.foreground;
    this.log(`requesting ${scope} location permission`);
    this.port.requestPermission(scope, explanation);
  }

  // Pause/End and a mid-session revocation land here: the subscription is
  // released, the window cleared (19 §4.3 ClearGeofences) and the watchdog
  // memory reset, so no stale live state or stale fix survives.
  private disarm(): void {
    this.cancelTick();
    if (this.currentSub !== null) {
      this.port.stopFixes(this.currentSub);
      this.currentSub = null;
    }
    this.lastFix = null;
    this.lastFixAt = null;
    this.recoveryAttempts = 0;
    this.watchdog = 'idle';
    this.pushRegions([]);
  }

  private startSubscription(): void {
    this.generation++;
    this.currentSub = this.generation;
    this.port.startFixes(this.currentSub);
  }

  private onPortEvent(event: LocationPortEvent): void {
    if (event.type === 'permission') {
      this.onPermission(event.state);
      return;
    }
    if (event.sub !== this.currentSub) return;
    const now = this.clock.now();
    this.lastFix = event.fix;
    this.lastFixAt = now;
    if (this.watchdog !== 'live') {
      this.watchdog = 'live';
      this.recoveryAttempts = 0;
      this.log(`fix stream is live (generation ${String(this.currentSub)})`);
    }
    this.scheduleGapWatch();
    this.fixSink?.(event.fix);
    this.recomputeWindow();
  }

  private onPermission(state: 'granted' | 'denied'): void {
    this.permission = state;
    if (state === 'denied') {
      this.permissionReason = this.currentSub !== null ? 'revoked-mid-session' : 'denied';
      this.log(`permission ${this.permissionReason} — releasing the subscription and the window`);
      this.disarm();
      return;
    }
    if (isArmed(this.mode) && this.currentSub === null) {
      this.log('permission granted — arming the subscription');
      this.watchdog = 'acquiring';
      this.startSubscription();
      this.scheduleGapWatch();
    }
  }

  // 09 §6.3: fixes stopping to arrive is its own failure; the gap watch is
  // one pending timer, replaced on every fix and re-armed by every step
  // below.
  private scheduleGapWatch(): void {
    this.cancelTick();
    this.tickCancel = this.clock.schedule(WATCHDOG_GAP_MS, () => this.onGapWatch());
  }

  private onGapWatch(): void {
    this.tickCancel = null;
    const sinceFix = this.lastFixAt === null ? Number.POSITIVE_INFINITY : this.clock.now() - this.lastFixAt;
    if (sinceFix < WATCHDOG_GAP_MS) return;
    this.watchdog = 'recovering';
    this.recoveryAttempts = 0;
    this.recoveryStep();
  }

  // Bounded backoff (09 §6.3): each step resubscribes with a fresh
  // generation, the next step follows RESUBSCRIBE_DELAYS_MS; when the list
  // runs out the watchdog stalls and stops scheduling. The last subscription
  // stays live on purpose — if the OS revives it, the next fix returns the
  // service to live (onPortEvent).
  private recoveryStep(): void {
    if (this.recoveryAttempts >= RESUBSCRIBE_DELAYS_MS.length) {
      this.watchdog = 'stalled';
      this.log(`watchdog stalled after ${String(this.recoveryAttempts)} resubscribe attempts`);
      return;
    }
    this.recoveryAttempts++;
    this.log(
      `watchdog recovering: resubscribe attempt ${String(this.recoveryAttempts)}` +
        `/${String(RESUBSCRIBE_DELAYS_MS.length)}`,
    );
    if (this.currentSub !== null) this.port.stopFixes(this.currentSub);
    this.startSubscription();
    const delay = RESUBSCRIBE_DELAYS_MS[this.recoveryAttempts - 1];
    this.cancelTick();
    this.tickCancel = this.clock.schedule(delay, () => this.recoveryStep());
  }

  // The window (09 §6.3): the nearest GEOFENCE_WINDOW_MAX stops of the whole
  // selected set by the latest fix — never the next stops by route position —
  // ordered by distance, then stable stop_id (the 09 §6.2 stage 5 idiom).
  // Without a position nothing is pushed: no fix means nothing to rank by.
  private recomputeWindow(): void {
    if (this.currentSub === null || this.lastFix === null) return;
    const fix = this.lastFix;
    const ranked = this.stops
      .map((stop) => ({ stop, distance: haversineMeters(fix.lat, fix.lng, stop.lat, stop.lng) }))
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          (a.stop.stopId < b.stop.stopId ? -1 : a.stop.stopId > b.stop.stopId ? 1 : 0),
      )
      .slice(0, GEOFENCE_WINDOW_MAX)
      .map((entry) => entry.stop);
    this.pushRegions(ranked);
  }

  private pushRegions(regions: ReadonlyArray<GeofenceStop>): void {
    this.port.setRegions(regions);
    this.log(`geofence window: ${String(regions.length)} of ${String(this.stops.length)} selected stops`);
  }

  private cancelTick(): void {
    this.tickCancel?.();
    this.tickCancel = null;
  }
}

// Boundary validation of the controller's selection (implementation-rules 3/14):
// a stop with non-finite geometry or a non-positive radius would poison the
// window sort and the OS region; it is dropped with a diagnostic count, never
// crashed on. Duplicated stop ids would push one region twice.
function sanitizeStops(stops: ReadonlyArray<GeofenceStop>): { kept: GeofenceStop[]; dropped: number } {
  const byId = new Map<string, GeofenceStop>();
  let dropped = 0;
  for (const stop of stops) {
    const geometryValid =
      Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && Number.isFinite(stop.radius) && stop.radius > 0;
    if (!geometryValid || byId.has(stop.stopId)) {
      dropped++;
      continue;
    }
    byId.set(stop.stopId, stop);
  }
  return { kept: [...byId.values()], dropped };
}

// The composition-root clock (G05.02.c wires the real port next to it).
export const systemLocationClock: LocationClock = {
  now: () => Date.now(),
  schedule: (delayMs, fn) => {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
  },
};
