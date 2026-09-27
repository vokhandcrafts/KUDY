// G06.01.b (issue #314) — the React binding for the preview controller
// (hooks as controllers, 19 §2.2). The factory creates one store per opened
// route; when the root constructed no preview (no catalog ports), the hook
// yields null and the surface renders its honest unavailable state — no
// inert fake controller stands in.
import { useEffect, useMemo, useState } from 'react';

import type { ControllerStore } from '../createControllerStore.ts';
import type { PreviewControllerState } from './previewController.ts';

export function usePreviewController(
  factory: { create(routeId: string): ControllerStore<PreviewControllerState> } | undefined,
  routeId: string,
): PreviewControllerState | null {
  const controller = useMemo(() => factory?.create(routeId), [factory, routeId]);
  const [state, setState] = useState<PreviewControllerState | null>(
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
