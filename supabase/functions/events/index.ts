// G09.02 — POST /v1/events (docs/architecture/09 §5): the Deno wiring for the
// device-bearer event-batch edge function. The intake decision, the wire
// serialization and the redacted internal-failure diagnostic live in
// ../_shared/events-core.ts + ../_shared/events-wire.ts (proven by node --test
// and the PGlite RLS suite); this file is the Supabase-runtime wiring only.
//
// Path mapping: the canonical `POST /v1/events` is served by this function at
// `https://<project-ref>.supabase.co/functions/v1/events`.
//
// Environment (fail-closed, the G00.03 spike's env-gate idiom):
//   DATABASE_URL — Postgres connection string with the service role.
// Non-POST requests and missing env never reach the database.
import postgres from 'npm:postgres@3.4.9';

import eventTableJson from '../../../contracts/events/event-table.v1.json' with { type: 'json' };
import { database } from '../_shared/postgres-connection.ts';
import {
  handleEventsWireRequest,
  serializeEvents500,
} from '../_shared/events-wire.ts';
import { logServerDiagnostic } from '../_shared/server-diagnostics.ts';
import type { EventSqlRunner, EventTableSpec } from '../_shared/events-core.ts';

// The table's canonical shape is machine-checked against the contract rules by
// contracts/events/event-contract.test.mjs in the standard suite; TypeScript's
// JSON-module inference cannot prove the Record<string, EventTableFieldSpec>
// index signature, so the assertion stays a boundary restatement of that proof.
const eventTable = eventTableJson as unknown as EventTableSpec;

// postgres.js answers an unsafe call with an array-like; the core's port
// reads `{ rows }` (the PGlite-compatible surface, test-db idiom). The port's
// primitive parameter list is copied into a fresh mutable array — the pinned
// driver's `unsafe` takes a mutable `ParameterOrJSON[]`.
function sqlRunner(db: postgres.Sql): EventSqlRunner {
  return {
    async query(sql, params) {
      const rows = await db.unsafe(sql, params ? [...params] : []);
      return { rows: Array.from(rows as Array<Record<string, unknown>>) };
    },
  };
}

Deno.serve(async (req) => {
  try {
    return await handleEventsWireRequest(req, sqlRunner(database()), eventTable);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL')) {
      logServerDiagnostic('events_intake', 'configuration_missing');
      return serializeEvents500('server_configuration_error');
    }
    logServerDiagnostic('events_intake', 'unexpected_failure');
    return serializeEvents500('server_error');
  }
});
