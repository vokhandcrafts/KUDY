// G20.20 — the production SqlDriver over expo-sqlite (the stack baseline the
// services/db header names as the candidate). The surface is the minimal
// execSql + prepared statements of services/db/types.ts; the value mapping
// mirrors the node:sqlite fixture (blob = Uint8Array, numbers pass through).
// The one own rule: a bigint param is a named diagnostic, never a silent
// precision loss — the schema writes epoch-ms timestamps and counters that
// stay in the number range. The SQLiteDatabase instance is injected (the app
// root opens it with openDatabaseSync); this module stays importable in
// plain node tests.
import type { SQLiteDatabase } from 'expo-sqlite';
import type { SqlDriver, SqlStatement, SqlValue } from '../types.ts';

function assertBindable(params: readonly SqlValue[]): void {
  for (const value of params) {
    if (typeof value === 'bigint') {
      throw new TypeError(`expo-sqlite-driver#bigint-param:${value}`);
    }
  }
}

export function createExpoSqliteDriver(db: SQLiteDatabase): SqlDriver {
  return {
    execSql: (sql) => db.execSync(sql),
    prepare: (sql): SqlStatement => ({
      run: (...params: SqlValue[]) => {
        assertBindable(params);
        const result = db.prepareSync(sql).executeSync<Record<string, SqlValue>>(...(params as never[]));
        return { changes: result.changes };
      },
      get: (...params: SqlValue[]) => {
        assertBindable(params);
        const result = db.prepareSync(sql).executeSync<Record<string, SqlValue>>(...(params as never[]));
        return result.getFirstSync() ?? undefined;
      },
      all: (...params: SqlValue[]) => {
        assertBindable(params);
        const result = db.prepareSync(sql).executeSync<Record<string, SqlValue>>(...(params as never[]));
        return result.getAllSync();
      },
    }),
  };
}
