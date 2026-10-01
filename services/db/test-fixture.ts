// G04.01 — node:sqlite adapter for the services/db tests. The production
// driver is an open stack-baseline row (TR-10, `23`) and is deliberately not
// chosen here; the built-in node:sqlite (engines ≥ 22.13, unflagged; the
// CI matrix runs 22.x and 24.x) exercises the same driver surface with a
// real SQLite engine, including partial indexes and transactional DDL.
// G09.01: ':memory:' keeps the throwaway-store behavior; a file path exposes
// close() so the kill/restart durability tests reopen the same store.
import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver } from './types.ts';

export interface SqliteFileStore {
  driver: SqlDriver;
  close(): void;
}

export function nodeSqliteFileDriver(filePath: string): SqliteFileStore {
  const db = new DatabaseSync(filePath);
  return {
    driver: {
      execSql: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
    },
    close: () => db.close(),
  };
}

export function nodeSqliteDriver(): SqlDriver {
  return nodeSqliteFileDriver(':memory:').driver;
}
