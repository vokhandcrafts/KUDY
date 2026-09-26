import { evaluatePackage } from '../services/contentRepo/contentRepo.ts';
import type { EvaluateInput, PackageStore, Readiness, Sha256 } from '../services/contentRepo/types.ts';
import { createOriginCatalogLoader } from '../services/catalog/loader.ts';
import { createCatalogService } from '../services/catalog/catalogService.ts';
import { createCatalogController, type CatalogControllerState } from './catalog/catalogController.ts';
import type { ControllerStore } from './createControllerStore.ts';

export interface ServicePorts {
  // The package store is the seam services/contentRepo already defines
  // (G04.03, types.ts); further ports join as their services are implemented.
  readonly packageStore?: PackageStore;
  // G06.01.a — the configured public origin the catalog loader binds
  // (21 §3.3; the app passes it from its environment) and the digest that
  // pins the fetched index to its pointer. The digest adapter joins with the
  // device crypto task; until then the root constructs no catalog service
  // and the surfaces show their honest unavailable state.
  readonly catalogOrigin?: string;
  readonly catalogSha256?: Sha256;
}

export interface Services {
  readonly contentRepo:
    | {
        readonly evaluatePackage: (input: EvaluateInput) => Promise<Readiness>;
      }
    | undefined;
  readonly catalog:
    | {
        readonly controller: ControllerStore<CatalogControllerState>;
      }
    | undefined;
}

export function createServices(ports: ServicePorts): Services {
  const { packageStore, catalogOrigin, catalogSha256 } = ports;
  const catalogLoader = catalogOrigin ? createOriginCatalogLoader(catalogOrigin) : undefined;
  return {
    contentRepo: packageStore && {
      evaluatePackage: (input) => evaluatePackage(packageStore, input),
    },
    // A service member exists only when its port is provided (the root's
    // rule): with no origin bound there is no catalog to render and the
    // surfaces show their honest unavailable state.
    catalog:
      catalogLoader &&
      catalogSha256 && {
        controller: createCatalogController(
          // MVP display-locale order: Belarusian first (21 §3.2 allowlist;
          // the UI-locale selection is G06.05/L02 and will replace this).
          createCatalogService({ loader: catalogLoader, sha256: catalogSha256 }, {
            localePreference: ['be', 'en'],
          }),
        ),
      },
  };
}
