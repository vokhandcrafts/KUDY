// Node adapter over a package directory (tests, demo, dev tooling). The
// device wires the same PackageStore seam to expo-file-system instead — and
// owns confinement there, since this test adapter joins paths naively.
// Path idiom matches validate-package.mjs: '/'-separated package-relative
// paths joined onto the root — the fs APIs accept '/' on Windows.
import { readFile as fsReadFile, stat } from 'node:fs/promises';

import type { FileFacts, PackageKey, PackageStore } from './types.ts';

// Shared file-facts read (package and bundles adapters): ENOENT is 'absent',
// every other fault is 'unreadable' (FileFacts contract in types.ts).
export async function readFileFacts(root: string, rel: string): Promise<FileFacts> {
  let bytes: Buffer;
  try {
    bytes = await fsReadFile(`${root}/${rel}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unreadable' };
  }
  return { kind: 'present', bytes };
}

export function createNodePackageStore(root: string, key: PackageKey): PackageStore {
  return {
    key,
    readFile: (rel: string) => readFileFacts(root, rel),
    async exists(rel: string): Promise<boolean> {
      try {
        await stat(`${root}/${rel}`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
