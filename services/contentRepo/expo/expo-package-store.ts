// G20.20 — the device PackageStore/BundlesStore/teaser probe. The
// expo-file-system File/Directory classes are injected (the app root passes
// the real ones), so the module is importable in plain node tests.
// Confinement is owned here (the node adapters join naively on purpose):
// every rel is split on '/' and each segment validated through the shared
// safe-segment idiom before it joins the root — a rejected rel reads as the
// contract's absent/unreadable/null, never a path outside the root. The
// paths are '/'-separated and package-relative, the node adapter's idiom.
import type { Directory, File } from 'expo-file-system';
import { isSafeSegment } from '../../safe-path.ts';
import type { BundlesStore, FileFacts, PackageKey, PackageStore, TeaserAudioProbe } from '../types.ts';

export interface FileSystemClasses {
  File: typeof File;
  Directory: typeof Directory;
}

// The resolved rel as a root-relative segment list, or null when the rel is
// not a safe in-root path.
function segmentsOf(rel: string): string[] | null {
  const segments = rel.split('/');
  for (const segment of segments) {
    if (!isSafeSegment(segment)) return null;
  }
  return segments;
}

export function createExpoPackageStore(classes: FileSystemClasses, root: Directory, key: PackageKey): PackageStore {
  const { File } = classes;
  const readFileFacts = async (rel: string): Promise<FileFacts> => {
    const segments = segmentsOf(rel);
    if (segments === null) return { kind: 'absent' };
    try {
      const file = new File(root, ...segments);
      if (!file.exists) return { kind: 'absent' };
      return { kind: 'present', bytes: await file.bytes() };
    } catch {
      return { kind: 'unreadable' };
    }
  };
  return {
    key,
    readFile: readFileFacts,
    async exists(rel: string): Promise<boolean> {
      const segments = segmentsOf(rel);
      if (segments === null) return false;
      try {
        return new File(root, ...segments).exists;
      } catch {
        return false;
      }
    },
  };
}

// Reads and listings only: the inventory never writes (G04.04.a criterion 3).
export function createExpoBundlesStore(classes: FileSystemClasses, root: Directory): BundlesStore {
  const { File, Directory } = classes;
  return {
    async listDir(rel: string): Promise<string[] | null> {
      const segments = segmentsOf(rel);
      if (segments === null) return null;
      try {
        const dir = new Directory(root, ...segments);
        if (!dir.exists) return null;
        return dir.list().map((entry) => entry.name);
      } catch {
        return null;
      }
    },
    readFile: (rel) => {
      const segments = segmentsOf(rel);
      if (segments === null) return Promise.resolve({ kind: 'absent' as const });
      try {
        const file = new File(root, ...segments);
        if (!file.exists) return Promise.resolve({ kind: 'absent' as const });
        return file.bytes().then(
          (bytes): FileFacts => ({ kind: 'present', bytes }),
          (): FileFacts => ({ kind: 'unreadable' }),
        );
      } catch {
        return Promise.resolve({ kind: 'unreadable' as const });
      }
    },
    async statSize(rel: string): Promise<number | null> {
      const segments = segmentsOf(rel);
      if (segments === null) return null;
      try {
        const file = new File(root, ...segments);
        return file.exists ? file.size : null;
      } catch {
        return null;
      }
    },
  };
}

// G22.02 — the teaser-audio probe over the same root. Metadata only (a
// present, nonempty file): the expo-file-system surface has no bounded
// readability open, so the probe never reads the media body and a
// permission-refused read answers true on metadata alone — the limitation
// the node probe names for Windows, recorded for the device in the task
// results.
export function createExpoTeaserAudioProbe(classes: FileSystemClasses, root: Directory): TeaserAudioProbe {
  const { File } = classes;
  return async (rel: string): Promise<boolean> => {
    const segments = segmentsOf(rel);
    if (segments === null) return false;
    try {
      const file = new File(root, ...segments);
      return file.exists && file.size > 0;
    } catch {
      return false;
    }
  };
}
