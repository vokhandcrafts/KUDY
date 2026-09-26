// G06.01.a (issue #313) — the React binding for the catalog controller
// (hooks as controllers, 19 §2.2). A screen receives the controller from the
// composition root's Services; when the root constructed no catalog service
// (no loader port), the hook yields null and the surface renders its honest
// unavailable state — no inert fake controller stands in.
import { useEffect, useState } from 'react';

import type { ControllerStore } from '../createControllerStore.ts';
import type { CatalogControllerState } from './catalogController.ts';

export function useCatalogController(
  controller: ControllerStore<CatalogControllerState> | undefined,
): CatalogControllerState | null {
  const [state, setState] = useState<CatalogControllerState | null>(
    controller ? controller.getState() : null,
  );
  useEffect(() => {
    if (!controller) {
      setState(null);
      return;
    }
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}
