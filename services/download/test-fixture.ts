// Shared test fixtures for services/download (download.test.ts, grant.test.ts):
// a lock.json built from the real bytes of the sources, so activation hash
// checks verify against honest digests.
import { nodeSha256 } from './nodeDownloadStore.ts';

export async function lockFrom(sources: Record<string, Uint8Array>): Promise<unknown> {
  const lock: Array<{ path: string; bytes: number; sha256: string }> = [];
  for (const [lockPath, bytes] of Object.entries(sources)) {
    lock.push({ path: lockPath, bytes: bytes.length, sha256: await nodeSha256(bytes) });
  }
  return lock;
}
