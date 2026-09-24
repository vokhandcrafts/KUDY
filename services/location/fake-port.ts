// G05.02.b — test fake over the location OS port contract (the allowed fake
// port of the task). It counts live subscriptions (criterion 1), flags a
// second concurrent start and an over-cap region push, and exposes test
// controls for the physical facts the service must absorb: a late fix of a
// stopped subscription (the generation check, criterion 3) and a mid-session
// permission flip (criterion 4). Reverting the service's generation check,
// its single-subscription discipline or the window cap turns these tests red
// (implementation-rules 1).
import type {
  FixInput,
  GeofenceStop,
  LocationOsPort,
  LocationPortEvent,
  PermissionState,
} from './types.ts';
import { GEOFENCE_WINDOW_MAX } from './types.ts';

export class FakeLocationOsPort implements LocationOsPort {
  readonly commands: string[] = [];
  readonly violations: string[] = [];
  permissionState: PermissionState = 'granted';
  // The last pushed window, for the cap-and-choice assertions of criterion 2.
  regions: ReadonlyArray<GeofenceStop> = [];
  regionPushes = 0;

  private active = new Set<number>();
  private everStarted = new Set<number>();
  private handler: ((event: LocationPortEvent) => void) | null = null;

  permission(): PermissionState {
    return this.permissionState;
  }

  startFixes(sub: number): void {
    this.commands.push(`start ${String(sub)}`);
    if (this.active.size > 0) {
      this.violations.push(
        `start ${String(sub)} while subscriptions ${[...this.active].join(',')} still active`,
      );
    }
    this.active.add(sub);
    this.everStarted.add(sub);
  }

  stopFixes(sub: number): void {
    this.commands.push(`stop ${String(sub)}`);
    this.active.delete(sub);
  }

  setRegions(regions: ReadonlyArray<GeofenceStop>): void {
    this.commands.push(`regions ${String(regions.length)}`);
    this.regionPushes++;
    if (regions.length > GEOFENCE_WINDOW_MAX) {
      this.violations.push(
        `regions ${String(regions.length)} exceed the window cap ${String(GEOFENCE_WINDOW_MAX)}`,
      );
    }
    this.regions = [...regions];
  }

  onPortEvent(handler: (event: LocationPortEvent) => void): void {
    this.handler = handler;
  }

  // --- test controls: the OS reports its physical facts ---

  activeSubscriptions(): number {
    return this.active.size;
  }

  // A position update of the given subscription. A sub that was never started
  // is a fake misuse; a stopped one is the physical late-callback race the
  // service must drop (criterion 3), so it is delivered, not flagged.
  emitFix(sub: number, fix: FixInput): void {
    if (!this.everStarted.has(sub)) {
      this.violations.push(`fix for subscription ${String(sub)} that never started`);
      return;
    }
    this.handler?.({ type: 'fix', sub, fix });
  }

  // The OS permission flips under the service: revoked mid-session or granted
  // after an undetermined arm.
  reportPermission(state: 'granted' | 'denied'): void {
    this.permissionState = state;
    this.handler?.({ type: 'permission', state });
  }
}
