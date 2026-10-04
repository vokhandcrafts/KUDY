// G20.01 — regression tests for the production /v1/device wire handler
// (spec N1, audit A26-01 [key: async-sql-result-not-awaited]). Every suite
// drives `handleDeviceRequest` — the same function the Deno entrypoint calls —
// through an asynchronous SQL fake whose counter answers a Promise after a
// real await; no synchronous counter fake exists here. The success-path
// suites fail when awaiting the SQL result is removed, and the diagnostic
// suites fail when the redacted logging is dropped or made unsafe.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSqlDeviceDeletePort,
  DEVICE_DELETE_SQL,
  DEVICE_INSERT_SQL,
  DEVICE_LOOKUP_SQL,
  DEVICE_RATE_LIMIT,
  hashIp,
  RATE_INCREMENT_SQL,
  registerDevice,
} from './device-core.ts';
import { deviceClientIp, handleDeviceRequest, type DeviceSqlClient, type RequestLike } from './device-wire.ts';
import { captureConsoleError } from './wire-test-support.ts';

interface SqlCall {
  sql: string;
  params: readonly unknown[];
}

interface DeviceSqlSeed {
  /** The `rows[0].attempts` cell on the nth rate increment (1-based); default: the call number. */
  attemptsByCall?: Array<unknown>;
  /** The rate statement answers no row at all. */
  rateEmptyRows?: boolean;
  rateError?: Error;
  insertError?: Error;
  /** The `device_id` the delete lookup answers; `null` = no row (unknown secret). */
  lookupResult?: string | null;
  lookupError?: Error;
  deleteError?: Error;
}

interface DeviceSqlSpy extends DeviceSqlClient {
  calls: SqlCall[];
  rateCalls(): number;
  insertCalls(): number;
  lookupCalls(): number;
  deleteCalls(): number;
}

function asyncDeviceSql(seed: DeviceSqlSeed = {}): DeviceSqlSpy {
  const calls: SqlCall[] = [];
  let rateCalls = 0;
  let insertCalls = 0;
  let lookupCalls = 0;
  let deleteCalls = 0;
  return {
    calls,
    rateCalls: () => rateCalls,
    insertCalls: () => insertCalls,
    lookupCalls: () => lookupCalls,
    deleteCalls: () => deleteCalls,
    async unsafe(sql, params) {
      calls.push({ sql, params });
      if (sql === RATE_INCREMENT_SQL) {
        if (seed.rateError) throw seed.rateError;
        rateCalls += 1;
        if (seed.rateEmptyRows) return [];
        const attempts = seed.attemptsByCall ? seed.attemptsByCall[rateCalls - 1] : rateCalls;
        return [{ attempts }];
      }
      if (sql === DEVICE_INSERT_SQL) {
        if (seed.insertError) throw seed.insertError;
        insertCalls += 1;
        return [];
      }
      if (sql === DEVICE_LOOKUP_SQL) {
        if (seed.lookupError) throw seed.lookupError;
        lookupCalls += 1;
        if (seed.lookupResult === null || seed.lookupResult === undefined) return [];
        return [{ device_id: seed.lookupResult }];
      }
      if (sql === DEVICE_DELETE_SQL) {
        if (seed.deleteError) throw seed.deleteError;
        deleteCalls += 1;
        return [];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

function postRequest(ip: string | null = '203.0.113.7'): RequestLike {
  return { method: 'POST', headers: { get: (name) => (name === 'x-forwarded-for' ? ip : null) } };
}

test('criterion 1: the first registration succeeds through asynchronous SQL', async () => {
  const db = asyncDeviceSql();
  const response = await handleDeviceRequest(postRequest(), db);
  assert.equal(response.status, 201, 'a valid first registration is accepted, not crashed by the async driver');
  const body = (await response.json()) as { device_id: string; device_secret: string };
  assert.match(body.device_id, /^[0-9a-f-]{36}$/);
  assert.ok(body.device_secret.length >= 40, 'the 32-byte secret is returned once');
  assert.equal(db.rateCalls(), 1);
  assert.equal(db.insertCalls(), 1, 'the device row is stored after the awaited limit decision');
  assert.equal(db.calls[0]!.sql, RATE_INCREMENT_SQL);
  assert.deepEqual(db.calls[1]!.sql, DEVICE_INSERT_SQL);
  assert.equal(db.calls[0]!.params[0], hashIp('203.0.113.7'));
});

test('criterion 1: deviceClientIp keeps the rightmost forwarded address and the unknown bucket', () => {
  const forwarded = deviceClientIp({ method: 'POST', headers: { get: (n) => (n === 'x-forwarded-for' ? '10.0.0.1, 198.51.100.9' : null) } });
  assert.equal(forwarded, '198.51.100.9');
  assert.equal(deviceClientIp(postRequest(null)), 'unknown');
});

test('criterion 2: the limit boundary and one beyond retain the 429/retry contract', async () => {
  const db = asyncDeviceSql();
  for (let i = 0; i < DEVICE_RATE_LIMIT; i += 1) {
    const response = await handleDeviceRequest(postRequest(), db);
    assert.equal(response.status, 201, `attempt ${i + 1} is inside the limit`);
  }
  const denied = await handleDeviceRequest(postRequest(), db);
  assert.equal(denied.status, 429);
  assert.equal(((await denied.json()) as { error: string }).error, 'rate_limited');
  assert.ok(Number(denied.headers.get('retry-after')) >= 1, 'the answer carries a retry-after');
  assert.equal(db.rateCalls(), DEVICE_RATE_LIMIT + 1);
  assert.equal(db.insertCalls(), DEVICE_RATE_LIMIT, 'the denied request stored nothing');
});

test('criterion 2: an invalid SQL counter reply fails closed — 500, never 429, no insert', async () => {
  for (const attempts of [undefined, null, '3', -1, Number.NaN, 1.5]) {
    const db = asyncDeviceSql({ attemptsByCall: [attempts] });
    const { result: response, lines } = await captureConsoleError(() => handleDeviceRequest(postRequest(), db));
    assert.equal(response.status, 500, `attempts ${String(attempts)} must not be accepted or priced as 429`);
    assert.equal(((await response.json()) as { error: string }).error, 'server_error');
    assert.equal(db.insertCalls(), 0, `no device is stored for attempts ${String(attempts)}`);
    assert.equal(lines.length, 1, `attempts ${String(attempts)} emits one diagnostic`);
    const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
    assert.deepEqual(entry, { operation: 'device_registration', reason: 'rate_increment_failed' });
  }
  const rowless = asyncDeviceSql({ rateEmptyRows: true });
  const { result: response, lines } = await captureConsoleError(() => handleDeviceRequest(postRequest(), rowless));
  assert.equal(response.status, 500, 'a missing counter row fails closed');
  assert.equal(rowless.insertCalls(), 0);
  assert.equal(lines.length, 1, 'a missing counter row emits one diagnostic');
});

test('criterion 2: a failed SQL reply fails closed without inserts', async () => {
  const rateFailure = asyncDeviceSql({ rateError: new Error('pq: connection refused') });
  const { result: rateResponse, lines: rateLines } = await captureConsoleError(() =>
    handleDeviceRequest(postRequest(), rateFailure),
  );
  assert.equal(rateResponse.status, 500);
  assert.equal(((await rateResponse.json()) as { error: string }).error, 'server_error');
  assert.equal(rateFailure.insertCalls(), 0, 'a storage failure never registers a device');
  assert.equal(rateLines.length, 1, 'one diagnostic for the failed increment');

  const insertFailure = asyncDeviceSql({ insertError: new Error('pq: unique violation') });
  const { result: insertResponse, lines: insertLines } = await captureConsoleError(() =>
    handleDeviceRequest(postRequest(), insertFailure),
  );
  assert.equal(insertResponse.status, 500);
  assert.equal(((await insertResponse.json()) as { error: string }).error, 'server_error');
  assert.equal(insertFailure.rateCalls(), 1, 'the limit decision still consumed its one increment');
  assert.equal(insertLines.length, 1, 'one diagnostic for the failed insert');
});

test('criterion 3: one atomic increment per request — concurrency never reads-then-writes', async () => {
  const db = asyncDeviceSql();
  const responses = await Promise.all(
    Array.from({ length: DEVICE_RATE_LIMIT + 1 }, () => handleDeviceRequest(postRequest(), db)),
  );
  const statuses = responses.map((response) => response.status);
  assert.equal(statuses.filter((status) => status === 201).length, DEVICE_RATE_LIMIT);
  assert.equal(statuses.filter((status) => status === 429).length, 1);
  assert.equal(db.rateCalls(), DEVICE_RATE_LIMIT + 1, 'exactly one increment per request');
  assert.equal(db.insertCalls(), DEVICE_RATE_LIMIT);
  assert.ok(
    db.calls.every((call) => call.sql === RATE_INCREMENT_SQL || call.sql === DEVICE_INSERT_SQL),
    'the only statements issued are the pinned atomic ones — a client-side read/update would speak a different SQL',
  );
});

test('criterion 5: an internal failure emits one redacted diagnostic (rate increment path)', async () => {
  const markers = {
    bearer: 'SYNTHETIC-G2001-BEARER',
    ip: 'SYNTHETIC-G2001-IP',
    sqlFailure: 'SYNTHETIC-G2001-SQLFAILURE',
  };
  const db = asyncDeviceSql({ rateError: new Error(`pq: broken (${markers.sqlFailure})`) });
  const { result, lines } = await captureConsoleError(() =>
    handleDeviceRequest(
      {
        method: 'POST',
        headers: {
          get: (name) => (name === 'x-forwarded-for' ? markers.ip : name === 'authorization' ? `Bearer ${markers.bearer}` : null),
        },
      },
      db,
    ),
  );
  assert.equal(result.status, 500);
  assert.equal(lines.length, 1, 'exactly one diagnostic reaches the server log');
  const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
  assert.equal(entry.operation, 'device_registration');
  assert.equal(entry.reason, 'rate_increment_failed');
  const logged = lines.join('\n');
  for (const marker of Object.values(markers)) {
    assert.ok(!logged.includes(marker), `the log must not leak ${marker}`);
  }
  assert.ok(!logged.includes(hashIp(markers.ip)), 'SQL parameters are not logged, even hashed');
});

test('criterion 5: an internal failure emits one redacted diagnostic (device insert path)', async () => {
  const marker = 'SYNTHETIC-G2001-SQLFAILURE';
  const db = asyncDeviceSql({ insertError: new Error(`pq: broken (${marker})`) });
  const { result, lines } = await captureConsoleError(() => handleDeviceRequest(postRequest(), db));
  assert.equal(result.status, 500);
  assert.equal(lines.length, 1, 'exactly one diagnostic, not one per catch site');
  const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
  assert.equal(entry.operation, 'device_registration');
  assert.equal(entry.reason, 'device_insert_failed');
  assert.ok(!lines.join('\n').includes(marker), 'the SQL failure message is not logged');
});

test('criterion 5: ordinary denials produce no diagnostic', async () => {
  const deniedDb = asyncDeviceSql({ attemptsByCall: [DEVICE_RATE_LIMIT + 1] });
  const { result: denied, lines: deniedLines } = await captureConsoleError(() => handleDeviceRequest(postRequest(), deniedDb));
  assert.equal(denied.status, 429);
  assert.equal(deniedLines.length, 0, 'a rate denial is not an internal failure');

  const { result: notFound, lines: notFoundLines } = await captureConsoleError(() =>
    handleDeviceRequest({ method: 'GET', headers: { get: () => null } }, asyncDeviceSql()),
  );
  assert.equal(notFound.status, 404);
  assert.equal(notFoundLines.length, 0, 'a non-POST answer logs nothing');
});

// --- G09.03 — DELETE /v1/device through the production handler (the same
// function the Deno entrypoint calls). The suites fail when the delete branch
// leaves the closed answer list, deletes without auth, or logs an ordinary
// denial (implementation-rules 1/15).

function deleteRequest(authorization: string | null): RequestLike {
  return { method: 'DELETE', headers: { get: (name) => (name === 'authorization' ? authorization : null) } };
}

test('G09.03: a live device deletes through the production handler with an empty 204', async () => {
  const registration = registerDevice();
  const db = asyncDeviceSql({ lookupResult: registration.deviceId });
  const response = await handleDeviceRequest(deleteRequest(`Bearer ${registration.deviceSecret}`), db);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '', 'the 204 carries no body — the client wipes its state only after it');
  assert.equal(db.rateCalls(), 0, 'the delete path never consumes a registration increment');
  assert.equal(db.lookupCalls(), 1);
  assert.equal(db.deleteCalls(), 1);
  assert.equal(db.calls[0]!.sql, DEVICE_LOOKUP_SQL);
  assert.equal(db.calls[1]!.sql, DEVICE_DELETE_SQL);
  assert.deepEqual(db.calls[1]!.params, [registration.deviceId], 'the row is removed by the looked-up id');
});

test('G09.03: auth denials answer 403 before any storage call, with no diagnostic', async () => {
  for (const authorization of [null, 'not-a-bearer', 'Bearer unknown-secret-value', 'Bearer '] as const) {
    const db = asyncDeviceSql({ lookupResult: null });
    const { result, lines } = await captureConsoleError(() => handleDeviceRequest(deleteRequest(authorization), db));
    assert.equal(result.status, 403, `authorization ${String(authorization)} is denied`);
    assert.equal(((await result.json()) as { error: string }).error, 'device_auth_failed');
    if (authorization === null || authorization === 'not-a-bearer') {
      assert.equal(db.lookupCalls(), 0, 'a malformed header never reaches the storage');
    }
    assert.equal(db.deleteCalls(), 0, 'a denied request never deletes');
    assert.equal(lines.length, 0, 'an ordinary auth denial is not an internal failure');
  }
});

test('G09.03: a storage fault on the delete path answers 500 with one redacted diagnostic', async () => {
  const marker = 'SYNTHETIC-G0903-SQLFAILURE';
  const bearer = 'SYNTHETIC-G0903-BEARER';
  const db = asyncDeviceSql({ lookupError: new Error(`pq: broken (${marker})`) });
  const { result, lines } = await captureConsoleError(() =>
    handleDeviceRequest(deleteRequest(`Bearer ${bearer}`), db),
  );
  assert.equal(result.status, 500);
  assert.equal(((await result.json()) as { error: string }).error, 'server_error');
  assert.equal(lines.length, 1, 'exactly one diagnostic reaches the server log');
  const entry = JSON.parse(lines[0]!) as { operation: string; reason: string };
  assert.deepEqual(entry, { operation: 'device_delete', reason: 'device_delete_failed' });
  const logged = lines.join('\n');
  assert.ok(!logged.includes(marker), 'the SQL failure message is not logged');
  assert.ok(!logged.includes(bearer), 'the bearer never reaches the log');
});
