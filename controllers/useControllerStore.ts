// G07.01 (issue #281) — the React binding for any controller store: a
// null-tolerant subscription (the run surface's pattern, G06.02), extracted
// so controllers share one hook instead of sibling copies
// (implementation-rules 3/8). Hooks as controllers, 19 §2.2.
import { useEffect, useState } from 'react';

import type { ControllerStore } from './createControllerStore.ts';

export function useStoreState<T>(store: ControllerStore<T> | null | undefined): T | null {
  const [state, setState] = useState<T | null>(store ? store.getState() : null);
  useEffect(() => {
    if (!store) {
      setState(null);
      return;
    }
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);
  return state;
}
