// Shared test fixtures for services/download (download.test.ts, grant.test.ts,
// access.test.ts): a lock.json built from the real bytes of the sources, so
// activation hash checks verify against honest digests.
import { nodeSha256 } from './nodeDownloadStore.ts';
import type { ActivateDeps } from './types.ts';

export async function lockFrom(sources: Record<string, Uint8Array>): Promise<unknown> {
  const lock: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [lockPath, bytes] of Object.entries(sources)) {
    lock.push({ path: lockPath, bytes: bytes.length, sha256: await nodeSha256(bytes) });
  }
  return lock;
}

// Simulates process death at a chosen rename: the wrapped store throws
// instead of performing it (a real rename is atomic — it either happened or
// it did not, and the injected crash is the "did not" side).
export function crashOnRename(
  store: ActivateDeps['store'],
  target: (from: string, to: string) => boolean,
): ActivateDeps['store'] {
  return {
    ...store,
    rename: async (fromRel: string, toRel: string) => {
      if (target(fromRel, toRel)) throw new Error('injected crash');
      return store.rename(fromRel, toRel);
    },
  };
}
