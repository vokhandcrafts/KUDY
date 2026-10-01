// Shared event-queue test support for the G09 suites (services/eventLog,
// services/analytics): a fresh in-memory zone-B store and a deterministic
// EventInput factory per suite. Test-only module — imported by *.test.ts
// suites, never by production code (the jscpd gate: one variant, not two).
import { openDatabase } from './db/db.ts';
import { nodeSqliteDriver } from './db/test-fixture.ts';
import type { EventInput, SqlDriver } from './db/types.ts';

export function openFreshEventStore(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

// Each factory owns its sequence, so two suites never share `at` or the
// event_id tail; `prefix` is the per-suite UUID head (12 hex tail digits are
// appended, zero-padded).
export function eventFactory(prefix: string): (overrides?: Partial<EventInput>) => EventInput {
  let seq = 0;
  return (overrides = {}) => {
    seq += 1;
    return {
      eventId: `${prefix}${String(seq).padStart(12, '0')}`,
      type: 'app_open',
      at: 1_700_000_000_000 + seq,
      schemaVersion: 1,
      payload: JSON.stringify({}),
      ...overrides,
    };
  };
}
