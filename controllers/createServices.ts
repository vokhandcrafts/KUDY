// G06.09.b — the composition root (issue #209): the only module that
// constructs services. Ports are explicit parameters — the app build passes
// device ports, Node tests pass fakes; no module-level singletons, no DI
// framework, no event bus (19 §2.6). Device adapters arrive with their owning
// tasks (G05.02.c location, G05.03.b audio, TR-10 filesystem); a service
// member exists only when its port is provided, so `Services` mirrors what
// the root could actually construct rather than promising services that no
// port backs.
import { evaluatePackage } from '../services/contentRepo/contentRepo.ts';
import type { EvaluateInput, PackageStore, Readiness } from '../services/contentRepo/types.ts';

export interface ServicePorts {
  // The package store is the seam services/contentRepo already defines
  // (G04.03, types.ts); further ports join as their services are implemented.
  readonly packageStore?: PackageStore;
}

export interface Services {
  readonly contentRepo:
    | {
        readonly evaluatePackage: (input: EvaluateInput) => Promise<Readiness>;
      }
    | undefined;
}

export function createServices(ports: ServicePorts): Services {
  const { packageStore } = ports;
  return {
    contentRepo: packageStore && {
      evaluatePackage: (input) => evaluatePackage(packageStore, input),
    },
  };
}
