// G06.09.b — the React half of the sample controller (issue #209): the same
// store factory from sampleController.ts runs under a hook, so a controller
// is written once and runs in the app (hook) and in a Node test (factory).
// Test-only like the factory; product screens arrive with their own tasks.
import { useMemo } from 'react';
import type { Services } from './createServices.ts';
import { useController } from './createControllerStore.ts';
import { createSampleController, type SampleControllerState } from './sampleController.ts';

export function useSampleController(services: Services): SampleControllerState {
  const store = useMemo(() => {
    if (!services.contentRepo) {
      throw new Error('useSampleController: the composition root has no contentRepo port wired');
    }
    return createSampleController(services.contentRepo);
  }, [services]);
  return useController(store);
}
