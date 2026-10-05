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
import { appendEvent, DbError, getDeviceId, latestEnqueueSeq, listPendingEvents, markEventsSent } from './db/db.ts';
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

// Flushes the pending tail through the injected sender one bounded page at
// a time: one send call and one sent mark per page, so no driver's
// bind-parameter limit can wedge the queue and a failing page leaves the
// earlier ones marked, the rest pending — the retry resends only what
// stayed. Returns the number of marked events; an empty queue wakes no
// transport.
//
// G22.03: the page read is bounded twice — by the page size and by the
// enqueue_seq bound frozen before the first read, so rows appended while
// the flush runs (backdated or not) wait for the next flush instead of
// joining a batch that is already in flight.
//
// The optional beforeBatch gate is read before every page is sent; a false
// return stops the flush there — pages already acknowledged stay marked,
// the rest stay pending and unmarked. The gate is a loop decision, not a
// sender wrapper: a resolving wrapper would still be followed by the mark,
// retiring a batch that never left (the G20.05 consent recheck relies on
// the gate, not on a silent no-op send).
//
// The device identity captured at flush start is rechecked before every
// send and again after the awaited send, before the mark: an account
// cleared or replaced mid-flush stops the flush, so old work never
// acknowledges rows of the replacement account (G09.03).
export interface FlushEventsOptions {
  beforeBatch?: () => boolean;
}

export async function flushEvents(driver: SqlDriver, send: EventSender, options?: FlushEventsOptions): Promise<number> {
  const upToSeq = latestEnqueueSeq(driver);
  const ownerId = getDeviceId(driver);
  let marked = 0;
  for (;;) {
    if (options?.beforeBatch && !options.beforeBatch()) break;
    if (getDeviceId(driver) !== ownerId) break;
    const page = listPendingEvents(driver, { limit: FLUSH_CHUNK, upToSeq });
    if (page.length === 0) break;
    await send(
      page.map((row) => ({
        event_id: row.eventId,
        type: row.type,
        at: row.at,
        schema_version: row.schemaVersion,
        payload: parsePayload(row.payload, `event ${row.eventId}`),
      })),
    );
    if (getDeviceId(driver) !== ownerId) break;
    marked += markEventsSent(
      driver,
      page.map((row) => row.eventId),
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
