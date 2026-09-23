// Node facts adapter over a directory (tests, demo, dev tooling) — the
// BundlesStore seam for the library inventory. Reads and listings only: the
// inventory never writes (G04.04.a criterion 3, guarded in wiring.test.ts).
// The device wires expo-file-system into the same port and owns confinement
// there, as for PackageStore.
import { readdir, stat } from 'node:fs/promises';

import { readFileFacts } from './nodePackageStore.ts';
import type { BundlesStore } from './types.ts';

export function createNodeBundlesStore(root: string): BundlesStore {
  return {
    async listDir(rel: string): Promise<string[] | null> {
      try {
        return await readdir(`${root}/${rel}`);
      } catch {
        return null;
      }
    },
    readFile: (rel: string) => readFileFacts(root, rel),
    async statSize(rel: string): Promise<number | null> {
      try {
        return (await stat(`${root}/${rel}`)).size;
      } catch {
        return null;
      }
    },
  };
}
