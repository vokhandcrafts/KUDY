// G09.01 — services/eventLog: the local event log with an idempotent send
// queue. Sources copied not paraphrased: `09` §10 (client-generated event_id
// carries idempotency — one event = one credit on repeated sends; a new
// manual replay is a new event, not a duplicate), the accepted event table
// contracts/events/event-table.v1.json (recording policy: local recording
// always, sending consent-gated, progress never depends on events) and the
// issue #285 criteria. Ownership: this module owns the queue semantics —
// emit validation, the flush batch, the sent mark — over the durable
// `event_queue` table; the SQL and transactions belong to services/db (ADR
// G01.03 §3.3), the wire endpoint and the consent gate belong to G09.02, so
// the sender here is injected and a failing network never touches Run.
//
// Naming boundary: the outgoing batch spells its fields verbatim in the
// event table's snake_case (event_id, type, at, schema_version, payload —
// implementation-rules 2); the mapper in this file is the single conversion
// point from the store's camelCase rows.
import { appendEvent, DbError, listPendingEvents, markEventsSent } from './db/db.ts';
import type { EventInput, SqlDriver } from './db/types.ts';

// The wire shape of one queued event, verbatim event-table field names. The
// payload is the stored JSON, parsed once — the queue never interprets it.
// Boundary note: `at` leaves the queue in epoch ms (the store's clock); the
// ISO-8601 conversion the event table defines is the G09.02 transport's job.
export interface OutgoingEvent {
  event_id: string;
  type: string;
  at: number;
  schema_version: number;
  payload: unknown;
}

// Resolving means acknowledged: the batch is then marked sent in one
// transaction. Rejecting means nothing is marked — the next flush resends
// the same event_ids and the server dedupes them (09 §15).
export type EventSender = (events: OutgoingEvent[]) => Promise<void>;

// Local recording is always (event table, recording_policy): emit is
// fire-and-forget — it performs no network work and only fails on its own
// input contract. The store trusts the typed EventInput, so the one
// runtime-checkable field is the payload string: corrupt JSON is a named
// diagnostic here, not a raw SyntaxError, and non-object JSON is refused
// before it enters the durable queue.
export function emitEvent(driver: SqlDriver, event: EventInput): void {
  parsePayload(event.payload, `event ${event.eventId}`);
  appendEvent(driver, event);
}

// The pending tail goes out in bounded chunks: one send call and one sent
// mark per chunk, so no driver's bind-parameter limit can wedge the queue
// and a failing chunk leaves the earlier ones marked, the rest pending —
// the retry resends only what stayed.
const FLUSH_CHUNK = 256;

// Flushes the pending tail through the injected sender and marks each
// acknowledged chunk sent in one transaction. A sender that resolved but a
// process that died before the mark leave the rows pending, and the next
// flush resends the same event_ids — the stable-id contract the server
// dedupes against. Returns the number of marked events; an empty queue
// wakes no transport.
export async function flushEvents(driver: SqlDriver, send: EventSender): Promise<number> {
  const pending = listPendingEvents(driver);
  let marked = 0;
  for (let start = 0; start < pending.length; start += FLUSH_CHUNK) {
    const chunk = pending.slice(start, start + FLUSH_CHUNK);
    await send(
      chunk.map((row) => ({
        event_id: row.eventId,
        type: row.type,
        at: row.at,
        schema_version: row.schemaVersion,
        payload: parsePayload(row.payload, `event ${row.eventId}`),
      })),
    );
    marked += markEventsSent(
      driver,
      chunk.map((row) => row.eventId),
    );
  }
  return marked;
}

function parsePayload(payload: string, source: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new DbError('event-payload-invalid-json', `${source}: payload is not valid JSON`, { cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DbError('event-payload-invalid-json', `${source}: payload must be a JSON object`);
  }
  return parsed;
}
