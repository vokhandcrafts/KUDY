// G20.01 — the production POST /v1/events wire handler, moved out of the Deno
// entrypoint so the node suites can drive it end-to-end with asynchronous SQL
// (spec N1: «Прыёмка праходзіць сапраўдныя апрацоўшчыкі і асінхронныя
// SQL-парты»). The intake decision itself is handleEventsRequest in
// events-core.ts; this module owns the wire serialization and the one
// redacted server diagnostic for internal (storage) failures — port faults
// are deliberately not caught in the core, so this catch is the mapping the
// core's contract names.
import { logServerDiagnostic } from './server-diagnostics.ts';
import {
  createSqlEventsPort,
  defaultEventsConfig,
  handleEventsRequest,
  type EventSqlRunner,
  type EventTableSpec,
  type EventsAnswer,
} from './events-core.ts';

export function serializeEventsAnswer(answer: EventsAnswer): Response {
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

export function serializeEvents500(code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleEventsWireRequest(req: Request, db: EventSqlRunner, table: EventTableSpec): Promise<Response> {
  let answer: EventsAnswer;
  try {
    answer = await handleEventsRequest(
      {
        method: req.method,
        authorization: req.headers.get('authorization'),
        rawBody: new Uint8Array(await req.arrayBuffer()),
      },
      createSqlEventsPort(db),
      table,
      defaultEventsConfig(Date.now()),
    );
  } catch {
    logServerDiagnostic('events_intake', 'storage_failure');
    return serializeEvents500('server_error');
  }
  return serializeEventsAnswer(answer);
}
