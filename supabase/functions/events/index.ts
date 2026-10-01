// G09.02 — POST /v1/events (docs/architecture/09 §5): the device-bearer
// batch intake for the consent-gated event queue. The contract logic lives
// in ../_shared/events-core.ts (proven against PGlite by events-core.test.ts);
// this file is the Deno wiring only — it is exercised on the Supabase runtime
// at deploy time and marked not-run in docs/agent-tasks/results/G09.02.md
// (the G08.01 precedent; no Supabase project is attached to this repo yet).
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
  createSqlEventsPort,
  defaultEventsConfig,
  handleEventsRequest,
  type EventTableSpec,
  type EventSqlRunner,
} from '../_shared/events-core.ts';

const eventTable = eventTableJson as EventTableSpec;

// postgres.js answers an unsafe call with an array-like; the core's port
// reads `{ rows }` (the PGlite-compatible surface, test-db idiom).
function sqlRunner(db: postgres.Sql): EventSqlRunner {
  return {
    async query(sql, params) {
      const rows = await db.unsafe(sql, params as unknown[]);
      return { rows: Array.from(rows as Array<Record<string, unknown>>) };
    },
  };
}

function serialize(answer: Awaited<ReturnType<typeof handleEventsRequest>>): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (answer.status === 429) {
    headers.set('retry-after', String(answer.retryAfterSeconds));
  }
  const body =
    answer.status === 200
      ? answer.body
      : answer.status === 400
        ? { error: { code: answer.code, reason: answer.reason } }
        : { error: { code: answer.code } };
  return new Response(JSON.stringify(body), { status: answer.status, headers });
}

export async function handleEventsWireRequest(req: Request, db: postgres.Sql): Promise<Response> {
  const answer = await handleEventsRequest(
    {
      method: req.method,
      authorization: req.headers.get('authorization'),
      rawBody: new Uint8Array(await req.arrayBuffer()),
    },
    createSqlEventsPort(sqlRunner(db)),
    eventTable,
    defaultEventsConfig(Date.now()),
  );
  return serialize(answer);
}

Deno.serve(async (req) => {
  try {
    return await handleEventsWireRequest(req, database());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_URL')) {
      return serialize500('server_configuration_error');
    }
    return serialize500('server_error');
  }
});

function serialize500(code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}
