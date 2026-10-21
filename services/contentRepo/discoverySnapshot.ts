// The discovery_cache row is a replaceable zone-A copy of the verified index.
// A single SQLite statement replaces the whole payload, so failed writes keep
// the previous snapshot available for offline discovery.
import type { SqlDriver } from '../db/types.ts';
import type { DiscoverySnapshotStore } from './discoveryIndex.ts';

const CACHE_KEY = 'active';

export function discoverySnapshotOver(driver: SqlDriver): DiscoverySnapshotStore {
  return {
    async read() {
      const row = driver.prepare('SELECT payload FROM discovery_cache WHERE cache_key = ?').get(CACHE_KEY);
      return row === undefined ? null : new TextEncoder().encode(String(row.payload));
    },
    async write(bytes) {
      const payload = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      driver.prepare(`INSERT INTO discovery_cache (cache_key, revision, payload, updated_at)
        VALUES (?, NULL, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
        .run(CACHE_KEY, payload, Date.now());
    },
  };
}
