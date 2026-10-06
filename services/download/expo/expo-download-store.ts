// G20.20 — the device DownloadStore, the same seam the node adapter serves
// (services/download/nodeDownloadStore.ts): staged writes, the rename tail,
// idempotent remove (an absent target is already the desired state). The
// File/Directory classes and the free-space read are injected (the app root
// passes the real ones over the same bundles root the content readers use).
// Segment validation matches the content adapters: a rejected rel answers
// the contract's absent/false/null — or the named unsafe-path throw for the
// write paths — never a path outside the root.
import type { Directory, File } from 'expo-file-system';
import { isSafeSegment } from '../../safe-path.ts';
import type { DownloadStore } from '../types.ts';

export interface DownloadFileSystem {
  File: typeof File;
  Directory: typeof Directory;
  /** Bytes available on the volume; null when the host cannot say. */
  freeBytes: () => number | null;
}

function segmentsOf(rel: string): string[] | null {
  const segments = rel.split('/');
  for (const segment of segments) {
    if (!isSafeSegment(segment)) return null;
  }
  return segments;
}

export function createExpoDownloadStore(fs: DownloadFileSystem, root: Directory): DownloadStore {
  const { File, Directory } = fs;
  const unsafe = (): Error => new Error('download-store#unsafe-path');
  return {
    async ensureDir(rel: string): Promise<void> {
      const segments = segmentsOf(rel);
      if (segments === null) throw unsafe();
      new Directory(root, ...segments).create({ idempotent: true, intermediates: true });
    },
    async writeFile(rel: string, bytes: Uint8Array): Promise<void> {
      const segments = segmentsOf(rel);
      if (segments === null) throw unsafe();
      new File(root, ...segments).write(bytes);
    },
    async rename(fromRel: string, toRel: string): Promise<void> {
      const from = segmentsOf(fromRel);
      const to = segmentsOf(toRel);
      if (from === null || to === null) throw unsafe();
      // The rename tail moves both files (staged .part entries) and whole
      // layer directories (the staging tree's commit) — the source kind
      // decides which class moves it.
      const file = new File(root, ...from);
      if (file.exists) {
        file.move(new File(root, ...to));
        return;
      }
      new Directory(root, ...from).move(new Directory(root, ...to));
    },
    async remove(rel: string): Promise<void> {
      const segments = segmentsOf(rel);
      if (segments === null) throw unsafe();
      const file = new File(root, ...segments);
      if (file.exists) {
        file.delete();
        return;
      }
      const dir = new Directory(root, ...segments);
      if (dir.exists) dir.delete();
    },
    async exists(rel: string): Promise<boolean> {
      const segments = segmentsOf(rel);
      if (segments === null) return false;
      return new File(root, ...segments).exists;
    },
    async readFile(rel: string): Promise<Uint8Array | null> {
      const segments = segmentsOf(rel);
      if (segments === null) return null;
      const file = new File(root, ...segments);
      return file.exists ? await file.bytes() : null;
    },
    async statSize(rel: string): Promise<number | null> {
      const segments = segmentsOf(rel);
      if (segments === null) return null;
      const file = new File(root, ...segments);
      return file.exists ? file.size : null;
    },
    async freeBytes(): Promise<number | null> {
      return fs.freeBytes();
    },
  };
}
