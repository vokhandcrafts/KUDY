// G06.04 (issue #63) — the My KUDY history controller: the app's session
// history as the screen's state — the live walk beside the finished previous
// runs (11 §16.2, 03: «My KUDY захоўвае лакальную гісторыю сесій»). One
// writer rule (ADR G01.03 §3.1): sessions are written by the run controller
// alone, this store only reads services/db through the composition root's
// port — the rows the durable zone keeps, never recomputed or filtered here.
// G22.06 (spec E6): the completed history arrives in bounded pages of 50 via
// the port's keyset cursor; the live walk rides every page read separately.
// Without the port the root constructs no member and the screen shows its
// honest unavailable state (the root's rule since issue #209).
import { createControllerStore, type ControllerStore } from './createControllerStore.ts';
import { useStoreState } from './useControllerStore.ts';
import type {
  SessionHistoryCursor,
  SessionHistoryPage,
  SessionHistorySummary,
  SessionRow,
} from '../services/db/types.ts';

// The history read seam: services/db.listSessionHistoryPage over the device
// driver; the root implements it when the TR-10 adapter lands, tests pass
// fakes. A null cursor opens the first page; the page's nextCursor opens the
// next one.
export interface SessionHistoryPort {
  listPage(cursor: SessionHistoryCursor | null): Promise<SessionHistoryPage>;
}

export type MyKudyState = (
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'ready';
      // The app's one live walk at the last full refresh; paging never
      // rewrites it, so a walk stays visible while the completed pages load
      // and the next refresh (the screen re-runs one on focus) reports the
      // finish honestly.
      readonly live: SessionRow | null;
      // Completed summaries accumulated so far, page order kept.
      readonly rows: ReadonlyArray<SessionHistorySummary>;
      // Key of the next completed page; null when the history is exhausted.
      readonly nextCursor: SessionHistoryCursor | null;
      readonly loadingMore: boolean;
      // The named failure of the last load-more; the rows stay on the screen
      // and the cursor stays open — the retry re-reads the same page.
      readonly moreError: string | null;
    }
) & {
  // The boot read starts at creation; the screen re-runs it on focus, so a
  // walk started elsewhere is on the list when the surface returns. A refresh
  // is a full reset to page one and supersedes any in-flight page read.
  readonly refresh: () => Promise<void>;
  // The next completed page; appends to the ready rows. A no-op while a
  // refresh or another page read is in flight.
  readonly loadMore: () => Promise<void>;
};

export function createMyKudyController(port: SessionHistoryPort): ControllerStore<MyKudyState> {
  // One refresh at a time: a slower earlier read never overwrites a newer
  // one, and any refresh bumps the epoch an in-flight load-more is measured
  // against — a late page lands into a history that moved on, so it is
  // discarded whole instead of appended (spec E6 criterion 4).
  let seq = 0;
  let refreshing = false;
  let loadingMore = false;
  const store = createControllerStore<MyKudyState>((set, get) => ({
    status: 'loading',
    refresh: async () => {
      const run = ++seq;
      // The epoch bump already discards any in-flight page read (its run
      // check rejects it), so the load-more flag is released here — waiting
      // for the superseded attempt would deadlock every further load-more.
      loadingMore = false;
      refreshing = true;
      try {
        let page: SessionHistoryPage;
        try {
          page = await port.listPage(null);
        } catch (error) {
          if (run !== seq) return;
          set({
            status: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        if (run !== seq) return;
        set({
          status: 'ready',
          live: page.live,
          rows: page.rows,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreError: null,
        });
      } finally {
        refreshing = false;
      }
    },
    loadMore: async () => {
      const current = get();
      if (current.status !== 'ready' || current.nextCursor === null || refreshing || loadingMore) return;
      const run = seq;
      const cursor = current.nextCursor;
      loadingMore = true;
      set({ loadingMore: true, moreError: null });
      try {
        const page = await port.listPage(cursor);
        if (run !== seq) return;
        const ready = get();
        if (ready.status !== 'ready') return;
        set({
          rows: [...ready.rows, ...page.rows],
          nextCursor: page.nextCursor,
          loadingMore: false,
        });
      } catch (error) {
        if (run !== seq) return;
        set({
          loadingMore: false,
          moreError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Only the epoch's own attempt clears the flag; a superseded late
        // page must not unlock a concurrent one (two appends would duplicate
        // rows, spec E6 criterion 4).
        if (run === seq) loadingMore = false;
      }
    },
  }));
  void store.getState().refresh();
  return store;
}

// The screen binding (19 §2.2, hooks as controllers): the shared
// null-tolerant subscription (useControllerStore.ts, G07.01) — the root
// constructs the history member only with its port, and the screen renders
// its honest unavailable state without one.
export function useMyKudy(store: ControllerStore<MyKudyState> | null | undefined): MyKudyState | null {
  return useStoreState(store);
}
