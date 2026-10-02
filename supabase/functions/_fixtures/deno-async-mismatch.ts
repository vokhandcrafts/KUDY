// G20.13 fixture — the audit A26-01 async contract mismatch, planted on
// purpose. `_fixtures/` is not a function directory: Supabase never deploys
// it and tools/ci/deno-typecheck.mjs production mode never enumerates it.
// The committed behavioral check runs `deno check --file` over this file and
// requires a nonzero exit with a named TS diagnostic — the old device wiring
// read `db.unsafe(...)` as already-resolved rows
// [key: async-sql-result-not-awaited], and the casts below mirror the real
// handler's row casts: they must not be able to hide a missing await.
interface DeviceSqlClient {
  unsafe(sql: string, params: (string | number | boolean | null)[]): PromiseLike<ArrayLike<unknown>>;
}

export function plantedAsyncMismatch(db: DeviceSqlClient): number {
  const rows = db.unsafe('SELECT attempts FROM device_registration_rate', []);
  const row = rows[0] as Record<string, unknown>;
  return row?.['attempts'] as number;
}
