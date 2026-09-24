// G05.02.c — the expo-location adapter over the G05.02.b port (the audio
// adapter pattern of G05.03.b): the only module of services/location/expo/
// that imports expo modules at runtime; node --test never imports it — the
// pure mappings (fix-mapping, permission-mapping) and the config extraction
// (location-config) it delegates to are tested on synthetic inputs instead.
// The composition root receives the port factory as the location port
// parameter — the one sanctioned construction path (G06.09.b); no other
// module imports this file (AC4; verified by arch:check and the import grep
// in results/G05.02.c.md).
//
// Mapping decisions recorded in results/G05.02.c.md:
// - the update mechanism follows the last requested scope: foreground →
//   watchPositionAsync (no foreground-service notification on the city
//   surface), background → startLocationUpdatesAsync with the notification
//   text from the app config (09 §9: the phone-in-pocket pose). A background
//   start whose OS grant did not answer the background question falls back
//   to the foreground watch — the OS error is surfaced, never swallowed;
// - setRegions holds the window the service computed. On Android the
//   continuous update stream is the delivery mechanism and every trigger
//   decision is fix-driven (AR-5), so no second OS geofencing task is
//   started; an iOS adapter would register the regions as OS regions (out
//   of scope here);
// - every fix event carries the subscription the stream runs under (the
//   service-minted generation, criterion 3 of G05.02.b); the adapter emits
//   only while that subscription is current, so a late OS callback after
//   stopFixes dies here as well as in the service;
// - the foreground service (09 §9.1) cannot save a killed process — that is
//   the device matrix, not this file's business.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';

import type {
  GeofenceStop,
  LocationOsPort,
  LocationPermissionScope,
  LocationPortEvent,
  PermissionState,
} from '../types.ts';
import { mapOsLocationToFix, type OsLocationObject } from './fix-mapping.ts';
import { mapOsPermission } from './permission-mapping.ts';
import { locationExtrasFromConfig, type LocationExtras } from './location-config.ts';

// The task name is this adapter's, not a canon constant; registered once per
// process (TaskManager requires the definition before the first start).
const LOCATION_UPDATES_TASK = 'KUDY/location-updates';
// The OS accuracy request. Not a canon number — the 40 m gate and the 15 s
// watchdog are pipeline/service canon; this one is an implementation choice
// recorded in results/G05.02.c.md and calibrated on devices (G11.02).
const OS_ACCURACY = Location.Accuracy.High;

let updatesTaskDefined = false;
function defineUpdatesTaskOnce(emitFix: (location: OsLocationObject) => void): void {
  if (updatesTaskDefined) return;
  TaskManager.defineTask<{ locations: OsLocationObject[] }>(LOCATION_UPDATES_TASK, async ({ data, error }) => {
    if (error !== null && error !== undefined) {
      console.warn(`location adapter: background task error ${String(error)}`);
      return;
    }
    for (const location of data?.locations ?? []) emitFix(location);
  });
  updatesTaskDefined = true;
}

export function createExpoLocationOsPort(config: unknown = Constants.expoConfig): LocationOsPort {
  const extras = locationExtrasFromConfig(config);
  return new ExpoLocationOsPort(extras);
}

export class ExpoLocationOsPort implements LocationOsPort {
  private readonly extras: LocationExtras;
  private handler: ((event: LocationPortEvent) => void) | null = null;
  private currentSub: number | null = null;
  private backgroundIntent = false;
  private removeWatch: (() => void) | null = null;
  private regions: ReadonlyArray<GeofenceStop> = [];
  private permissionState: PermissionState = 'undetermined';

  constructor(extras: LocationExtras) {
    this.extras = extras;
    // The sync permission() answer starts honest: the OS state resolves
    // asynchronously and arrives as a permission event like any other.
    void Location.getForegroundPermissionsAsync()
      .then((response) => this.applyPermission(mapOsPermission(response)))
      .catch((error: unknown) => console.warn(`location adapter: permission check failed: ${String(error)}`));
  }

  permission(): PermissionState {
    return this.permissionState;
  }

  requestPermission(scope: LocationPermissionScope, explanation: string): void {
    this.backgroundIntent = scope === 'background';
    // The explanation rides the request for the UI flow that shows it before
    // the ask (09 §9; the G06.03 Start screen) — the OS dialogs take their
    // text from the manifest strings the expo-location plugin writes.
    void explanation;
    void (scope === 'background'
      ? Location.requestBackgroundPermissionsAsync()
      : Location.requestForegroundPermissionsAsync()
    )
      .then((response) => this.applyPermission(mapOsPermission(response)))
      .catch((error: unknown) => console.warn(`location adapter: permission request failed: ${String(error)}`));
  }

  startFixes(sub: number): void {
    this.currentSub = sub;
    if (this.backgroundIntent && this.permissionState === 'granted') {
      defineUpdatesTaskOnce((location) => this.emitFix(location));
      Location.startLocationUpdatesAsync(LOCATION_UPDATES_TASK, {
        accuracy: OS_ACCURACY,
        foregroundService: {
          notificationTitle: this.extras.locationForegroundService.notificationTitle,
          notificationBody: this.extras.locationForegroundService.notificationBody,
        },
      }).catch((error: unknown) => {
        console.warn(`location adapter: background updates refused (${String(error)}) — falling back to the foreground watch`);
        void this.startForegroundWatch(sub);
      });
      return;
    }
    void this.startForegroundWatch(sub);
  }

  stopFixes(sub: number): void {
    if (this.currentSub !== sub) return;
    this.currentSub = null;
    this.removeWatch?.();
    this.removeWatch = null;
    // The stop tail is asynchronous while the service's next startFixes is
    // synchronous (the watchdog's recoveryStep stops the old subscription and
    // starts a fresh one back to back): without the generation check the
    // trailing stop would land after the new start and kill the fresh
    // background stream — the same task name, one process. A subscription
    // that took over owns the task; only a genuinely stopped one stops it.
    void Location.hasStartedLocationUpdatesAsync(LOCATION_UPDATES_TASK)
      .then(async (started) => {
        if (started && this.currentSub === null) await Location.stopLocationUpdatesAsync(LOCATION_UPDATES_TASK);
      })
      .catch((error: unknown) => console.warn(`location adapter: stopping background updates failed: ${String(error)}`));
  }

  setRegions(regions: ReadonlyArray<GeofenceStop>): void {
    this.regions = [...regions];
  }

  onPortEvent(handler: (event: LocationPortEvent) => void): void {
    this.handler = handler;
  }

  private applyPermission(state: PermissionState): void {
    this.permissionState = state;
    if (state !== 'undetermined') this.handler?.({ type: 'permission', state });
  }

  private async startForegroundWatch(sub: number): Promise<void> {
    try {
      const watch = await Location.watchPositionAsync(
        { accuracy: OS_ACCURACY },
        (location) => this.emitFix(location),
        (error: unknown) => console.warn(`location adapter: watch error ${String(error)}`),
      );
      if (this.currentSub !== sub) {
        watch.remove(); // stopped before the watch resolved — no orphan stream
        return;
      }
      this.removeWatch = () => watch.remove();
    } catch (error) {
      console.warn(`location adapter: the foreground watch failed to start: ${String(error)}`);
    }
  }

  private emitFix(location: OsLocationObject): void {
    const sub = this.currentSub;
    if (sub === null) return;
    const mapped = mapOsLocationToFix(location);
    if (!mapped.ok) {
      console.warn(`location adapter: OS fix rejected (${mapped.reason})`);
      return;
    }
    this.handler?.({ type: 'fix', sub, fix: mapped.fix });
  }
}
