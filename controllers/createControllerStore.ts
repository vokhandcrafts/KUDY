// G06.09.b — the store helper over the pinned store library (issue #209,
// ADR G00.04 §6: zustand 5.0.15). The single import point of zustand for
// controllers: a controller is a vanilla store built here (drivable in Node
// tests without React) plus the `useController` hook binding for screens
// (hooks as controllers, 19 §2.2).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StateCreator, StoreApi } from 'zustand/vanilla';

export type ControllerStore<TState> = StoreApi<TState>;

export function createControllerStore<TState>(
  initializer: StateCreator<TState, [], []>,
): ControllerStore<TState> {
  return createStore<TState>()(initializer);
}

export function useController<TState>(store: ControllerStore<TState>): TState {
  return useStore(store);
}
