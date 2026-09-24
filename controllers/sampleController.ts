// G06.09.b — the sample controller (issue #209): the reference shape a
// product controller follows. A vanilla store from the store helper whose
// action calls a service handed over by the composition root and copies the
// result into state. Used only by tests and demos — no screen imports it;
// the product controllers belong to G05.05 (useRunController) and
// G06/G07/G15/G16.
import type { Services } from './createServices.ts';
import type { EvaluateInput, Readiness } from '../services/contentRepo/types.ts';
import { createControllerStore, type ControllerStore } from './createControllerStore.ts';

export interface SampleControllerState {
  readonly readiness: Readiness | null;
  readonly loading: boolean;
  readonly error: string | null;
  refresh(input: EvaluateInput): Promise<void>;
}

export function createSampleController(
  contentRepo: NonNullable<Services['contentRepo']>,
): ControllerStore<SampleControllerState> {
  // Monotonic run counter: a superseded refresh never overwrites the newer
  // result — the pattern product controllers must copy (the canon is built on
  // generation tokens, 09 §6.1).
  let seq = 0;
  return createControllerStore<SampleControllerState>((set) => ({
    readiness: null,
    loading: false,
    error: null,
    refresh: async (input) => {
      const run = ++seq;
      set({ loading: true, error: null });
      try {
        const readiness = await contentRepo.evaluatePackage(input);
        if (run !== seq) return;
        set({ readiness, loading: false });
      } catch (error) {
        if (run !== seq) return;
        set({ error: error instanceof Error ? error.message : String(error), loading: false });
      }
    },
  }));
}
