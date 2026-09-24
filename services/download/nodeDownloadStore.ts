// Node adapter over a bundles root directory (tests, demo, dev tooling) —
// the DownloadStore seam for the activation core. The device wires
// expo-file-system into the same port and owns confinement there, as for
// PackageStore — this test adapter joins paths naively (the core validates
// every segment on input before the first call). Path idiom matches
// validate-package.mjs: '/'-separated rel paths joined onto the root — the fs
// APIs accept '/' on Windows.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename as fsRename, rm, stat, statfs, writeFile } from 'node:fs/promises';

import type { DownloadStore, Sha256 } from './types.ts';

// SHA-256 over the raw bytes (node:crypto here; the device wires expo-crypto
// into the same port — TR-10).
export const nodeSha256: Sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

export function createNodeDownloadStore(root: string): DownloadStore {
  const at = (rel: string) => `${root}/${rel}`;
  return {
    async ensureDir(rel: string): Promise<void> {
      await mkdir(at(rel), { recursive: true });
    },
    async writeFile(rel: string, bytes: Uint8Array): Promise<void> {
      await writeFile(at(rel), bytes);
    },
    async rename(fromRel: string, toRel: string): Promise<void> {
      await fsRename(at(fromRel), at(toRel));
    },
    // Idempotent by contract (DownloadStore): force removes an absent target
    // as the already-desired state.
    async remove(rel: string): Promise<void> {
      await rm(at(rel), { recursive: true, force: true });
    },
    async exists(rel: string): Promise<boolean> {
      try {
        await stat(at(rel));
        return true;
      } catch {
        return false;
      }
    },
    async readFile(rel: string): Promise<Uint8Array | null> {
      try {
        return await readFile(at(rel));
      } catch {
        return null;
      }
    },
    async statSize(rel: string): Promise<number | null> {
      try {
        return (await stat(at(rel))).size;
      } catch {
        return null;
      }
    },
    async freeBytes(): Promise<number | null> {
      try {
        const usage = await statfs(root);
        return usage.bsize * usage.bavail;
      } catch {
        return null;
      }
    },
  };
}
