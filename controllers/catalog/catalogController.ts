// G06.01.a (issue #313) — the city catalog controller: a vanilla store (the
// G06.09.b helper) whose refresh runs the catalog service the composition
// root handed over and copies the outcome into the surface state. The
// catalog refreshes at every start and a failure is fatal only with no
// previous result (09 §4), so the controller boots into its first load and
// keeps the cached surface visible while a revalidation runs. Monotonic run
// counter: a superseded refresh never overwrites the newer result (the
// sample controller's pattern). The service arrives as a type — only the
// root constructs services (issue #209 AC1).
import { createControllerStore, type ControllerStore } from '../createControllerStore.ts';
import type { CatalogGuideCard, CatalogService } from '../../services/catalog/types.ts';

// The surface state the screens render, named after the state coverage table
// in docs/design/screens-and-transitions.md: loading (first load), ready
// (guides possibly empty — the NAV3 empty city), offline (last valid cache +
// banner) and error (no cache — the normal city page without discovery).
export type CatalogSurfaceState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly guides: readonly CatalogGuideCard[];
      readonly degraded: 'index-unavailable' | null;
    }
  | { readonly kind: 'offline'; readonly guides: readonly CatalogGuideCard[]; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

export interface CatalogControllerState {
  readonly surface: CatalogSurfaceState;
  readonly refreshing: boolean;
  refresh(): Promise<void>;
}

export function createCatalogController(
  service: CatalogService,
): ControllerStore<CatalogControllerState> {
  let seq = 0;
  let previous: readonly CatalogGuideCard[] | null = null;
  const store = createControllerStore<CatalogControllerState>((set, get) => ({
    surface: { kind: 'loading' },
    refreshing: false,
    refresh: async () => {
      const run = ++seq;
      if (get().surface.kind !== 'loading') set({ refreshing: true });
      const next = await service.load(previous);
      if (run !== seq) return;
      if (next.kind === 'ready' || next.kind === 'offline') previous = next.guides;
      set({ surface: next, refreshing: false });
    },
  }));
  // 09 §4: the catalog refreshes at every start — the boot load starts here,
  // not on the first render.
  void store.getState().refresh();
  return store;
}

export type { CatalogGuideCard };
