// G20.01 — regression tests for the production /v1/events wire handler
// (spec N1, audit A26-01). Every suite drives `handleEventsWireRequest` — the
// same function the Deno entrypoint calls — through an asynchronous SQL fake
// whose rate counter answers a Promise after a real await; no synchronous
// counter fake exists here. The success-path suites fail when awaiting the
// SQL result is removed, and the diagnostic suites fail when the redacted
// logging is dropped or made unsafe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEVICE_LOOKUP_SQL, hashSecret } from './device-core.ts';
import {
  EVENT_RATE_INCREMENT_SQL,
  EVENT_RATE_LIMIT,
  eventInsertSql,
  type EventSqlRunner,
  type EventTableSpec,
} from './events-core.ts';
import { handleEventsWireRequest } from './events-wire.ts';
import { captureConsoleError, wireEvent } from './wire-test-support.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(
  fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'contracts', 'events', 'event-table.v1.json'), 'utf8'),
) as EventTableSpec;

const BEARER = 'Bearer test-device-secret-0123456789abcdef';

interface SqlCall {
  sql: string;
  params: readonly unknown[];
}

interface EventsSqlSeed {
  /** The raw bearer secret the fake lookup accepts; defaults to the suite's `BEARER`. */
  acceptedBearer?: string;
  /** The `device_id` cell the lookup answers; it may carry a marker for the redaction check. */
  deviceId?: string;
  lookupError?: Error;
  /** The `rows[0].attempts` cell on the nth rate increment (1-based); default: the call number. */
  attemptsByCall?: Array<unknown>;
  /** The rate statement answers no row at all. */
  rateEmptyRows?: boolean;
  rateError?: Error;
  insertError?: Error;
}

interface EventsSqlSpy extends EventSqlRunner {
  calls: SqlCall[];
  rateCalls(): number;
  insertCalls(): number;
}

function asyncEventsSql(seed: EventsSqlSeed = {}): EventsSqlSpy {
  const calls: SqlCall[] = [];
  let rateCalls = 0;
  let insertCalls = 0;
  const acceptedHash = hashSecret(seed.acceptedBearer ?? BEARER.slice('Bearer '.length));
  return {
    calls,
    rateCalls: () => rateCalls,
    insertCalls: () => insertCalls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === DEVICE_LOOKUP_SQL) {
        if (seed.lookupError) throw seed.lookupError;
        if (params[0] !== acceptedHash) return { rows: [] };
        return { rows: [{ device_id: seed.deviceId ?? '66666666-6666-4666-8666-000000000009' }] };
      }
      if (sql === EVENT_RATE_INCREMENT_SQL) {
        if (seed.rateError) throw seed.rateError;
        rateCalls += 1;
        if (seed.rateEmptyRows) return { rows: [] };
        const attempts = seed.attemptsByCall ? seed.attemptsByCall[rateCalls - 1] : rateCalls;
        return { rows: [{ attempts }] };
      }
      if (sql.startsWith('insert into event_log')) {
        if (seed.insertError) throw seed.insertError;
        insertCalls += 1;
        return { rows: [{ event_id: 'stored-1' }] };
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

function postRequest(body: unknown, bearer: string | null = BEARER): Request {
  const headers: Record<string, string> = {};
  if (bearer !== null) headers['authorization'] = bearer;
  return new Request('https://edge.example/functions/v1/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('criterion 1: the first event batch is inserted exactly once through asynchronous SQL', async () => {
  const db = asyncEventsSql();
  const response = await handleEventsWireRequest(postRequest({ events: [wireEvent()] }), db, TABLE);
  assert.equal(response.status, 200, 'a valid first batch is accepted, not priced as 429 by an unawaited counter');
  assert.deepEqual(await response.json(), { accepted: 1 });
  assert.equal(db.rateCalls(), 1);
  assert.equal(db.insertCalls(), 1, 'the batch is stored once');
  const insert = db.calls.find((call) => call.sql.startsWith('insert into event_log'))!;
  assert.equal(insert.sql, eventInsertSql(1));
});

test('criterion 2: the limit boundary and one beyond retain the 429/retry contract', async () => {
  const db = asyncEventsSql();
  for (let i = 0; i < EVENT_RATE_LIMIT; i += 1) {
    const response = await handleEventsWireRequest(postRequest({ events: [wireEvent()] }), db, TABLE);
    assert.equal(response.status, 200, `batch ${i + 1} is inside the limit`);
  }
  const denied = await handleEventsWireRequest(postRequest({ events: [wireEvent()] }), db, TABLE);
  assert.equal(denied.status, 429);
  const body = (await denied.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'event_rate_limited');
  assert.ok(Number(denied.headers.get('retry-after')) >= 1, 'the answer carries a retry-after');
  assert.equal(db.rateCalls(), EVENT_RATE_LIMIT + 1);
  assert.equal(db.insertCalls(), EVENT_RATE_LIMIT, 'the over-limit batch is never stored');
});

test('criterion 2: an invalid SQL counter reply fails closed — 500, never 429, no insert', async () => {
  for (const attempts of [undefined, null, '3', -1, Number.NaN, 1.5]) {
    const db = asyncEventsSql({ attemptsByCall: [attempts] });
    const { result: response, lines } = await captureConsoleError(() =>
      handleEventsWireRequest(postRequest({ events: [wireEvent()] }), db, TABLE),
    );
    assert.equal(response.status, 500, `attempts ${String(attempts)} must not be accepted or priced as 429`);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'server_error');
    assert.equal(db.insertCalls(), 0, `no batch is stored for attempts ${String(attempts)}`);
    assert.equal(lines.length, 1, `attempts ${String(attempts)} emits one diagnostic`);
    const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
    assert.deepEqual(entry, { operation: 'events_intake', reason: 'storage_failure' });
  }
  const rowless = asyncEventsSql({ rateEmptyRows: true });
  const { result: response, lines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }), rowless, TABLE),
  );
  assert.equal(response.status, 500, 'a missing counter row fails closed');
  assert.equal(rowless.insertCalls(), 0);
  assert.equal(lines.length, 1, 'a missing counter row emits one diagnostic');
});

test('criterion 2: a failed SQL reply fails closed without inserts', async () => {
  const rateFailure = asyncEventsSql({ rateError: new Error('pq: connection refused') });
  const { result: rateResponse, lines: rateLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }), rateFailure, TABLE),
  );
  assert.equal(rateResponse.status, 500);
  assert.equal(((await rateResponse.json()) as { error: { code: string } }).error.code, 'server_error');
  assert.equal(rateFailure.insertCalls(), 0, 'a storage failure never stores a batch');
  assert.equal(rateLines.length, 1, 'one diagnostic for the failed increment');

  const lookupFailure = asyncEventsSql({ lookupError: new Error('pq: connection refused') });
  const { result: lookupResponse, lines: lookupLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }), lookupFailure, TABLE),
  );
  assert.equal(lookupResponse.status, 500);
  assert.equal(lookupFailure.rateCalls(), 0, 'a failed lookup never reaches the rate step');
  assert.equal(lookupLines.length, 1, 'one diagnostic for the failed lookup');

  const insertFailure = asyncEventsSql({ insertError: new Error('pq: connection refused') });
  const { result: insertResponse, lines: insertLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }), insertFailure, TABLE),
  );
  assert.equal(insertResponse.status, 500);
  assert.equal(insertFailure.rateCalls(), 1, 'the limit decision still consumed its one increment');
  assert.equal(insertLines.length, 1, 'one diagnostic for the failed insert');
});

test('criterion 3: one atomic increment per request — concurrency never reads-then-writes', async () => {
  const db = asyncEventsSql();
  const responses = await Promise.all(
    Array.from({ length: EVENT_RATE_LIMIT + 1 }, () => handleEventsWireRequest(postRequest({ events: [wireEvent()] }), db, TABLE)),
  );
  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 200).length, EVENT_RATE_LIMIT);
  assert.equal(statuses.filter((status) => status === 429).length, 1);
  assert.equal(db.rateCalls(), EVENT_RATE_LIMIT + 1, 'exactly one increment per request');
  assert.equal(db.insertCalls(), EVENT_RATE_LIMIT);
  assert.ok(
    db.calls.every(
      (call) => call.sql === DEVICE_LOOKUP_SQL || call.sql === EVENT_RATE_INCREMENT_SQL || call.sql.startsWith('insert into event_log'),
    ),
    'the only statements issued are the pinned atomic ones — a client-side read/update would speak a different SQL',
  );
});

test('criterion 5: an internal failure emits one redacted diagnostic', async () => {
  const markers = {
    bearer: 'SYNTHETIC-G2001-BEARER',
    device: 'SYNTHETIC-G2001-DEVICE',
    body: 'SYNTHETIC-G2001-BODY',
    sqlFailure: 'SYNTHETIC-G2001-SQLFAILURE',
  };
  const db = asyncEventsSql({
    acceptedBearer: markers.bearer,
    deviceId: markers.device,
    rateError: new Error(`pq: broken (${markers.sqlFailure})`),
  });
  const { result, lines } = await captureConsoleError(() =>
    handleEventsWireRequest(
      postRequest({ synthetic: markers.body, events: [wireEvent()] }, `Bearer ${markers.bearer}`),
      db,
      TABLE,
    ),
  );
  assert.equal(result.status, 500);
  assert.equal(lines.length, 1, 'exactly one diagnostic reaches the server log');
  const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
  assert.equal(entry.operation, 'events_intake');
  assert.equal(entry.reason, 'storage_failure');
  const logged = lines.join('\n');
  for (const marker of Object.values(markers)) {
    assert.ok(!logged.includes(marker), `the log must not leak ${marker}`);
  }
  assert.ok(!logged.includes('Bearer '), 'no authorization material is logged');
});

test('criterion 5: ordinary denials produce no diagnostic', async () => {
  const authDb = asyncEventsSql();
  const { result: unauthorized, lines: authLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }, 'Bearer nobody-knows-this-secret'), authDb, TABLE),
  );
  assert.equal(unauthorized.status, 403);
  assert.equal(authLines.length, 0, 'an auth denial is not an internal failure');

  const invalidDb = asyncEventsSql();
  const { result: invalid, lines: invalidLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [{ nope: true }] }), invalidDb, TABLE),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalidLines.length, 0, 'a validation denial is not an internal failure');

  const rateDb = asyncEventsSql({ attemptsByCall: [EVENT_RATE_LIMIT + 1] });
  const { result: denied, lines: deniedLines } = await captureConsoleError(() =>
    handleEventsWireRequest(postRequest({ events: [wireEvent()] }), rateDb, TABLE),
  );
  assert.equal(denied.status, 429);
  assert.equal(deniedLines.length, 0, 'a rate denial is not an internal failure');
});
