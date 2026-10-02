// G09.02 — acceptance suite for services/analytics (issue #286). Criteria:
// 1. no consent — zero sends: the gated flush never reads the queue, never
//    constructs network work (no pings, no batches) and marks nothing
//    (fails when the consent check is reverted to a pass-through);
// 2. refusal/withdrawal stops sending without losing local progress or the
//    queue — pending rows survive, emit keeps recording locally;
// plus the consent state contract (closed vocabulary, durable across a
// restart, corrupt value = named diagnostic) and the wire transport's
// verbatim mapping + closed error rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AnalyticsError,
  createEventsTransport,
  flushAnalytics,
  getAnalyticsConsent,
  setAnalyticsConsent,
  type EventsHttpTransport,
} from './analytics.ts';
import { DbError, listPendingEvents, openDatabase } from './db/db.ts';
import { nodeSqliteFileDriver } from './db/test-fixture.ts';
import type { SqlDriver } from './db/types.ts';
import { stubGlobalFetch } from './fetch-stub-test-fixture.ts';
import { eventFactory, openFreshEventStore } from './eventLog-test-fixture.ts';
import { emitEvent, flushEvents, type OutgoingEvent } from './eventLog.ts';

const event = eventFactory('22222222-2222-4222-8222-');

function openFileDriver(): { driver: SqlDriver; file: string; close(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-analytics-'));
  const file = path.join(dir, 'zone-b.sqlite');
  const { driver, close } = nodeSqliteFileDriver(file);
  openDatabase(driver);
  return { driver, file, close };
}

test('criterion 1: no consent asked — zero sends, nothing marked, the queue untouched', async () => {
  const driver = openFreshEventStore();
  emitEvent(driver, event());
  emitEvent(driver, event());

  let calls = 0;
  const marked = await flushAnalytics(driver, () => {
    calls += 1;
    return Promise.resolve();
  });

  assert.equal(calls, 0, 'the sender must not be invoked without consent — no pings, no batched sends');
  assert.equal(marked, 0);
  assert.equal(getAnalyticsConsent(driver), null);

  // Nothing was marked behind the caller's back: a granted flush drains the
  // very same two events afterwards.
  setAnalyticsConsent(driver, 'granted');
  let drained = 0;
  await flushAnalytics(driver, (batch) => {
    drained += batch.length;
    return Promise.resolve();
  });
  assert.equal(drained, 2, 'the events queued before the grant are sent by the first granted flush');
});

test('criterion 1: a refused consent keeps the flush closed the same way', async () => {
  const driver = openFreshEventStore();
  emitEvent(driver, event());
  setAnalyticsConsent(driver, 'revoked');

  let calls = 0;
  await flushAnalytics(driver, () => {
    calls += 1;
    return Promise.resolve();
  });

  assert.equal(calls, 0);
});

test('criterion 2: withdrawal stops sending — the queue and the marked progress survive', async () => {
  const driver = openFreshEventStore();
  emitEvent(driver, event());
  setAnalyticsConsent(driver, 'granted');

  const sent: OutgoingEvent[][] = [];
  assert.equal(await flushAnalytics(driver, (batch) => {
    sent.push(batch);
    return Promise.resolve();
  }), 1);
  assert.equal(sent.length, 1);

  // Withdrawal: new events queue up but nothing leaves the device.
  setAnalyticsConsent(driver, 'revoked');
  emitEvent(driver, event({ type: 'route_preview' }));
  let callsAfterWithdrawal = 0;
  await flushAnalytics(driver, () => {
    callsAfterWithdrawal += 1;
    return Promise.resolve();
  });
  assert.equal(callsAfterWithdrawal, 0);

  // The withdrawn batch is still pending, the granted one stays marked.
  let calls = 0;
  await flushEvents(driver, (batch) => {
    calls += 1;
    assert.equal(batch.length, 1);
    assert.equal(batch[0]!.type, 'route_preview');
    return Promise.resolve();
  });
  assert.equal(calls, 1, 'the pending event survived the withdrawal');
});

test('criterion 2: local recording never depends on consent — emit works after refusal', async () => {
  const driver = openFreshEventStore();
  setAnalyticsConsent(driver, 'revoked');
  emitEvent(driver, event());
  emitEvent(driver, event({ type: 'session_started' }));
  // A plain flush (no gate) still drains through an explicit sender — the
  // consent decision belongs to the send path, not to the queue's storage.
  assert.equal(await flushEvents(driver, () => Promise.resolve()), 2);
});

// G20.05 (issue #476) — the durable consent is re-read before every batch
// (network-privacy N2). Audit A26-05 scenario: 257 queued events, the
// withdrawal lands while the first batch (256) is in flight — the second
// batch must not start, and the skipped batch must stay pending, unmarked.
test('G20.05 revoke_between_batches: withdrawal between batches sends exactly one batch and leaves the tail pending', async () => {
  const driver = openFreshEventStore();
  setAnalyticsConsent(driver, 'granted');
  const ids: string[] = [];
  for (let i = 0; i < 257; i += 1) {
    const one = event({ at: 1_700_000_000_000 + i });
    ids.push(one.eventId);
    emitEvent(driver, one);
  }

  let calls = 0;
  const marked = await flushAnalytics(driver, (batch) => {
    calls += 1;
    assert.equal(batch.length, 256);
    // the withdrawal lands while the first batch is in flight: the server
    // already has these 256, the next batch must not start
    setAnalyticsConsent(driver, 'revoked');
    return Promise.resolve();
  });

  assert.equal(calls, 1, 'exactly one network batch — the second 256+1 batch is the regression');
  assert.equal(marked, 256, 'the completed in-flight batch is acknowledged');
  assert.deepEqual(
    listPendingEvents(driver).map((row) => row.eventId),
    [ids[256]!],
    'a skipped batch cannot be marked delivered: the tail stays pending, unmarked',
  );
});

test('G20.05 revoke_before_flush: no network request, and restoring consent resumes the queue without duplicates', async () => {
  const driver = openFreshEventStore();
  const one = event();
  const two = event({ type: 'route_preview' });
  emitEvent(driver, one);
  emitEvent(driver, two);

  // revoked before the flush: no request starts, nothing is marked
  setAnalyticsConsent(driver, 'revoked');
  let calls = 0;
  assert.equal(await flushAnalytics(driver, () => {
    calls += 1;
    return Promise.resolve();
  }), 0);
  assert.equal(calls, 0);

  // restoring consent resumes the same queued rows with their stable
  // event_ids — the ids the server dedupes against — in queue order
  setAnalyticsConsent(driver, 'granted');
  const sent: string[][] = [];
  assert.equal(await flushAnalytics(driver, (batch) => {
    sent.push(batch.map((e) => e.event_id));
    return Promise.resolve();
  }), 2);
  assert.deepEqual(sent, [[one.eventId, two.eventId]]);

  // the resumed rows were marked exactly once: a second flush wakes nothing
  let again = 0;
  assert.equal(await flushAnalytics(driver, () => {
    again += 1;
    return Promise.resolve();
  }), 0);
  assert.equal(again, 0);
});

test('consent state: durable across a restart, corrupt value is a named diagnostic', () => {
  const { driver, file, close } = openFileDriver();
  assert.equal(getAnalyticsConsent(driver), null);
  setAnalyticsConsent(driver, 'granted');
  close();
  const { driver: reopened } = nodeSqliteFileDriver(file);
  openDatabase(reopened);
  assert.equal(getAnalyticsConsent(reopened), 'granted');

  reopened.execSql("update settings set value = 'maybe' where key = 'analytics_consent'");
  assert.throws(() => getAnalyticsConsent(reopened), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'invalid_consent_state');
    return true;
  });
});

function fakeHttp(responses: Array<{ status: number; body: unknown }>): {
  transport: EventsHttpTransport;
  requests: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
} {
  const requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  let n = 0;
  return {
    requests,
    transport: {
      async postEvents(url, body, headers) {
        requests.push({ url, body, headers });
        const response = responses[Math.min(n, responses.length - 1)]!;
        n += 1;
        return response;
      },
    },
  };
}

function wireDeps(transport: EventsHttpTransport) {
  return {
    baseUrl: 'https://example.supabase.co/functions/v1',
    identity: { deviceId: '33333333-3333-4333-8333-000000000001', deviceSecret: 'secret-value' },
    transport,
  };
}

test('transport: verbatim wire shape — envelope, ISO timestamp, bearer identity', async () => {
  const { transport, requests } = fakeHttp([{ status: 200, body: { accepted: 1 } }]);
  const send = createEventsTransport(wireDeps(transport));
  const queued: OutgoingEvent = {
    event_id: '44444444-4444-4444-8444-000000000001',
    type: 'stop_reached',
    at: 1_700_000_000_123,
    schema_version: 1,
    payload: { session_id: 'sess-1', stop_id: 'stop-1' },
  };
  await send([queued]);

  assert.equal(requests.length, 1);
  const { url, body, headers } = requests[0]!;
  assert.equal(url, 'https://example.supabase.co/functions/v1/events');
  assert.equal(headers.authorization, 'Bearer secret-value');
  const envelope = body as { events: Array<Record<string, unknown>> };
  assert.deepEqual(
    Object.keys(envelope.events[0]!).sort(),
    ['at', 'event_id', 'payload', 'schema_version', 'type'],
    'the wire element carries exactly the queued fields — the transport adds nothing',
  );
  assert.equal(envelope.events[0]!['event_id'], queued.event_id);
  assert.equal(envelope.events[0]!['type'], queued.type);
  assert.equal(envelope.events[0]!['schema_version'], queued.schema_version);
  assert.deepEqual(envelope.events[0]!['payload'], queued.payload);
  assert.equal(envelope.events[0]!['at'], '2023-11-14T22:13:20.123Z');
});

test('transport: closed error rules — 400 reason, 429, server status, network fault', async () => {
  const reason = 'events[0].payload.lat: forbidden-coordinates';
  const bad = fakeHttp([{ status: 400, body: { error: { code: 'invalid_event', reason } } }]);
  await assert.rejects(createEventsTransport(wireDeps(bad.transport))([]), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'invalid_payload');
    assert.match((error as AnalyticsError).message, /forbidden-coordinates/);
    return true;
  });

  const bare = fakeHttp([{ status: 400, body: null }]);
  await assert.rejects(createEventsTransport(wireDeps(bare.transport))([]), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'invalid_payload');
    return true;
  });

  const limited = fakeHttp([{ status: 429, body: { error: { code: 'event_rate_limited' } } }]);
  await assert.rejects(createEventsTransport(wireDeps(limited.transport))([]), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'rate_limited');
    return true;
  });

  const broken = fakeHttp([{ status: 503, body: { error: { code: 'server_error' } } }]);
  await assert.rejects(createEventsTransport(wireDeps(broken.transport))([]), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'server_error');
    return true;
  });

  const network: EventsHttpTransport = {
    async postEvents() {
      throw new AnalyticsError('network_failed', 'offline', { cause: new Error('EAI_AGAIN') });
    },
  };
  await assert.rejects(createEventsTransport(wireDeps(network))([]), (error: unknown) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'network_failed');
    return true;
  });
});

test('transport: a non-finite queued timestamp is a named diagnostic before any network work', async () => {
  const { transport, requests } = fakeHttp([{ status: 200, body: { accepted: 1 } }]);
  const send = createEventsTransport(wireDeps(transport));
  await assert.rejects(send([{ event_id: 'x', type: 'app_open', at: Number.NaN, schema_version: 1, payload: {} }]), (
    error: unknown,
  ) => {
    assert.ok(error instanceof AnalyticsError);
    assert.equal((error as AnalyticsError).rule, 'invalid_event_time');
    return true;
  });
  assert.equal(requests.length, 0);
});

test('boundaries: DbError still surfaces through the gated flush (queue integrity diagnostics)', async () => {
  const driver = openFreshEventStore();
  driver.execSql("insert into event_queue (event_id, type, at, schema_version, payload) values ('x', 'app_open', 1, 1, 'not-json')");
  setAnalyticsConsent(driver, 'granted');
  await assert.rejects(flushAnalytics(driver, () => Promise.resolve()), (error: unknown) => {
    assert.ok(error instanceof DbError);
    return true;
  });
});

// G20.06 — network-privacy N3: the production default events transport
// validates the endpoint before the network and before the Authorization
// header is attached, and refuses redirects. These suites stub the platform
// fetch (services/fetch-stub-test-fixture — the network boundary, not the
// code under test) and drive the real defaultHttpTransport — reverting the
// validation, the redirect option or the redirected-response guard makes
// them fail (implementation-rules 1/15).

const N3_IDENTITY = { deviceId: '33333333-3333-4333-8333-000000000001', deviceSecret: 'secret-value' };

test('G20.06 N3: secret-bearing events requests reject unsafe endpoints before any network call', async () => {
  const stub = stubGlobalFetch(async () => {
    throw new Error('the network must not be reached for an unvalidated endpoint');
  });
  try {
    for (const baseUrl of ['http://example.invalid/functions/v1', 'not a url at all', 'https://user:pass@example.invalid/functions/v1']) {
      const send = createEventsTransport({ baseUrl, identity: N3_IDENTITY });
      await assert.rejects(send([]), (error: unknown) => {
        assert.ok(error instanceof AnalyticsError);
        assert.equal((error as AnalyticsError).rule, 'unsafe_endpoint');
        assert.ok(!((error as AnalyticsError).message.includes('example.invalid')), 'the diagnostic must not echo the URL');
        return true;
      }, baseUrl);
    }
    assert.equal(stub.requests.length, 0, 'unsafe endpoints must make zero network calls — the bearer never leaves');
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: a valid configured https endpoint keeps the wire behavior with redirect refused', async () => {
  const stub = stubGlobalFetch(async () => new Response(JSON.stringify({ accepted: 0 }), { status: 200 }));
  try {
    const send = createEventsTransport({ baseUrl: 'https://example.supabase.co/functions/v1', identity: N3_IDENTITY });
    await send([]);
    assert.equal(stub.requests.length, 1);
    const init = stub.requests[0]!.init as RequestInit | undefined;
    assert.equal(init?.redirect, 'error', 'the secret-bearing request must run with redirect: error');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${N3_IDENTITY.deviceSecret}`);
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: when the platform refuses the redirect, the send fails closed with network_failed', async () => {
  const stub = stubGlobalFetch(async () => {
    throw new TypeError('the redirect was refused by redirect: error');
  });
  try {
    const send = createEventsTransport({ baseUrl: 'https://example.supabase.co/functions/v1', identity: N3_IDENTITY });
    await assert.rejects(send([]), (error: unknown) => {
      assert.ok(error instanceof AnalyticsError);
      assert.equal((error as AnalyticsError).rule, 'network_failed');
      return true;
    });
    assert.equal((stub.requests[0]!.init as RequestInit | undefined)?.redirect, 'error');
  } finally {
    stub.restore();
  }
});

test('G20.06 N3: a response redirected away from the endpoint is not accepted', async () => {
  // A worst-case platform that followed the redirect despite the option:
  // the final response claims 200 but from a foreign URL.
  const redirected = {
    status: 200,
    url: 'https://attacker.example/functions/v1/events',
    text: async () => JSON.stringify({ accepted: 1 }),
  } as unknown as Response;
  const stub = stubGlobalFetch(async () => redirected);
  try {
    const send = createEventsTransport({ baseUrl: 'https://example.supabase.co/functions/v1', identity: N3_IDENTITY });
    await assert.rejects(send([]), (error: unknown) => {
      assert.ok(error instanceof AnalyticsError);
      assert.equal((error as AnalyticsError).rule, 'unsafe_endpoint');
      assert.match((error as AnalyticsError).message, /redirect/);
      return true;
    });
    assert.equal(stub.requests.length, 1, 'our code must not start a second authorized request after the redirect');
  } finally {
    stub.restore();
  }
});
