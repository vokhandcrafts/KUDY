// G20.20 — the driver mapping over a stand-in SQLiteDatabase: the SQL and
// params pass through verbatim, rows map null→undefined for get, bigint
// params fail named (implementation-rules 14: corrupt input answers with a
// diagnostic, not a silent precision loss).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createExpoSqliteDriver } from './expo-sqlite-driver.ts';

function fakeDb(logs: string[], rowsBySql: Record<string, Record<string, unknown>[]>) {
  return {
    execSync(sql: string) {
      logs.push(sql);
    },
    prepareSync(sql: string) {
      return {
        executeSync(...params: unknown[]) {
          logs.push(`${sql} [${params.map((p) => String(p)).join(',')}]`);
          const rows = rowsBySql[sql] ?? [];
          return {
            changes: rows.length,
            getFirstSync: () => rows[0] ?? null,
            getAllSync: () => rows,
          };
        },
      };
    },
  };
}

test('execSql, get, all and run map onto the driver surface', () => {
  const logs: string[] = [];
  const db = fakeDb(logs, { 'SELECT v FROM t WHERE k = ?': [{ v: 1 }] });
  const driver = createExpoSqliteDriver(db as never);
  driver.execSql('CREATE TABLE t (k, v)');
  assert.deepEqual(logs, ['CREATE TABLE t (k, v)']);
  logs.length = 0;
  assert.deepEqual(driver.prepare('SELECT v FROM t WHERE k = ?').get('a'), { v: 1 });
  assert.deepEqual(logs, ['SELECT v FROM t WHERE k = ? [a]']);
  assert.equal(driver.prepare('SELECT v FROM t WHERE k = 2').get('a'), undefined);
  assert.deepEqual(driver.prepare('SELECT v FROM t WHERE k = ?').all('a'), [{ v: 1 }]);
  const changes = driver.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'x');
  assert.deepEqual(changes, { changes: 0 });
});

test('a bigint param fails named, never silently', () => {
  const driver = createExpoSqliteDriver(fakeDb([], {}) as never);
  assert.throws(() => driver.prepare('INSERT INTO t VALUES (?)').run(1n), /bigint-param/);
});
