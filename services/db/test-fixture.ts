// G04.01 — node:sqlite adapter for the services/db tests. The production
// driver is an open stack-baseline row (TR-10, `23`) and is deliberately not
// chosen here; the built-in node:sqlite (engines ≥ 22.13, unflagged; the
// CI matrix runs 22.x and 24.x) exercises the same driver surface with a
// real SQLite engine, including partial indexes and transactional DDL.
import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver } from './types.ts';

export function nodeSqliteDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
  };
}
