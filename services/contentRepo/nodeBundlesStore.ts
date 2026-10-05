// Node facts adapter over a directory (tests, demo, dev tooling) — the
// BundlesStore seam for the library inventory. Reads and listings only: the
// inventory never writes (G04.04.a criterion 3, guarded in wiring.test.ts).
// The device wires expo-file-system into the same port and owns confinement
// there, as for PackageStore.
// G22.02 (issue #607) — the teaser-audio probe for the same root: metadata
// first (a regular, nonempty file), then one bounded 'r' open where metadata
// alone cannot answer readability. The handle is closed on every path and
// the media body is never read here.
import { open, readdir, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

import { readFileFacts } from './nodePackageStore.ts';
import type { BundlesStore, TeaserAudioProbe } from './types.ts';

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

// The probe joins `rel` onto the root the same naive way as the store above —
// the reader builds rel from checked segments only (09 §7), and the device
// adapter owns confinement. Windows: the readability check rides on open(2)
// semantics — Unix permission bits are not enforced there (the limitation
// issue #607 AC4 names), while the metadata answers (missing, directory,
// empty) and every positive answer behave identically on both platforms.
export function createNodeTeaserAudioProbe(root: string): TeaserAudioProbe {
  return async (rel: string): Promise<boolean> => {
    let facts: Awaited<ReturnType<typeof stat>>;
    try {
      facts = await stat(`${root}/${rel}`);
    } catch {
      return false;
    }
    if (!facts.isFile() || facts.size === 0) return false;
    let handle: FileHandle | null = null;
    try {
      handle = await open(`${root}/${rel}`, 'r');
      return true;
    } catch {
      return false;
    } finally {
      if (handle !== null) await handle.close().catch(() => {});
    }
  };
}
