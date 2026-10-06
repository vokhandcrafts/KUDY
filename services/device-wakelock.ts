// G20.20 — the walk's screen wakelock (09 §9, 11 §6) as pure wiring over the
// injected keep-awake facility (the expo binding lives in the app root).
// The RunWakelock shape (controllers/useRunController.ts) is matched
// structurally at the composition root — services cannot import controllers,
// and the interface is two methods, not a restatement worth a definition.
export interface DeviceWakelock {
  acquire(): void;
  release(): void;
}

export interface KeepAwakeFacility {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): void;
}

// One tag for the app's one live walk: overlapping acquires of the same tag
// are idempotent in expo-keep-awake, and release drops exactly this lease.
const TAG = 'kudy-run';

export function createDeviceWakelock(keepAwake: KeepAwakeFacility): DeviceWakelock {
  return {
    acquire: () => {
      // A refused lease degrades to screen-off, never to a dead walk: the
      // OS refusal is not a walk fault and the walk has no error surface
      // for it. Every other fault keeps its throw.
      void keepAwake.activate(TAG).catch(() => undefined);
    },
    release: () => keepAwake.deactivate(TAG),
  };
}
