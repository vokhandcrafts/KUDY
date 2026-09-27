// G06.04 (issue #63) — the My KUDY history controller: the app's session
// history as the screen's state — the live walk beside the finished previous
// runs (11 §16.2, 03: «My KUDY захоўвае лакальную гісторыю сесій»). One
// writer rule (ADR G01.03 §3.1): sessions are written by the run controller
// alone, this store only reads services/db's listSessionHistory through the
// composition root's port — the rows the durable zone keeps, never
// recomputed or filtered here. Without the port the root constructs no
// member and the screen shows its honest unavailable state (the root's rule
// since issue #209).
import { createControllerStore, useControllerState, type ControllerStore } from './createControllerStore.ts';
import type { SessionRow } from '../services/db/types.ts';

// The history read seam: services/db.listSessionHistory over the device
// driver; the root implements it when the TR-10 adapter lands, tests pass
// fakes.
export interface SessionHistoryPort {
  list(): Promise<SessionRow[]>;
}

export type MyKudyState = (
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'ready';
      // The store's own order (newest first): the one live walk
      // (active/paused) beside the finished runs.
      readonly rows: ReadonlyArray<SessionRow>;
    }
) & {
  // The boot read starts at creation; the screen re-runs it on focus, so a
  // walk started elsewhere is on the list when the surface returns.
  readonly refresh: () => Promise<void>;
};

export function createMyKudyController(port: SessionHistoryPort): ControllerStore<MyKudyState> {
  // One load at a time: a slower earlier read never overwrites a newer one.
  let seq = 0;
  const store = createControllerStore<MyKudyState>((set) => ({
    status: 'loading',
    refresh: async () => {
      const run = ++seq;
      let rows: SessionRow[];
      try {
        rows = await port.list();
      } catch (error) {
        if (run !== seq) return;
        set({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (run !== seq) return;
      set({ status: 'ready', rows });
    },
  }));
  void store.getState().refresh();
  return store;
}

// The screen binding (19 §2.2, hooks as controllers): the shared
// null-tolerant subscription — the root constructs the history member only
// with its port, and the screen renders its honest unavailable state
// without one.
export function useMyKudy(store: ControllerStore<MyKudyState> | null | undefined): MyKudyState | null {
  return useControllerState(store);
}
