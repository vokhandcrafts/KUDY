// Deno wiring helper shared by the edge function wrappers (device, grant):
// one lazily opened Postgres connection per isolate behind the fail-closed
// DATABASE_URL gate (ADR G00.03 §2.1 idiom). Imports the pinned driver with
// Deno's npm: specifier — this module is wiring, never imported by the node
// test suites (the SQL the functions run is proven on PGlite from the core
// constants).
import postgres from 'npm:postgres@3.4.9';

let sql: postgres.Sql | null = null;

export function database(): postgres.Sql {
  if (sql === null) {
    const url = Deno.env.get('DATABASE_URL');
    if (typeof url !== 'string' || url === '') {
      throw new Error('DATABASE_URL is required (fail-closed env gate, ADR G00.03 §2.1 idiom)');
    }
    sql = postgres(url, { prepare: false, max: 1 });
  }
  return sql;
}
