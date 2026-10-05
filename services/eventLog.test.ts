// G09.01 — acceptance suite for services/eventLog (issue #285). Criteria:
// 1. event_id is stable on retry — a resend carries the same ids, the server
//    dedupes; a marked batch is never re-sent;
// 2. a new playback is a new event — distinct event_ids never merge;
// 3. after a kill/restart neither unsent nor already-credited events are
//    lost (file-backed store, reopened across a close);
// 4. local progress never depends on sending — a failing sender surfaces its
//    error and leaves the queue intact;
// 5. a manual Play carries the correct context and no stop_reached.
// Plus the boundary diagnostics: a payload that is not a JSON object is
// refused at emit and at flush with a named rule, nothing stored or sent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearDeviceAccountState, DbError, listPendingEvents, openDatabase, setDeviceId } from './db/db.ts';
import { nodeSqliteFileDriver } from './db/test-fixture.ts';
import type { EventInput, SqlDriver } from './db/types.ts';
import { eventFactory, openFreshEventStore } from './eventLog-test-fixture.ts';
import { emitEvent, flushEvents, type OutgoingEvent } from './eventLog.ts';

const event = eventFactory('11111111-1111-4111-8111-');

function queuedRows(driver: SqlDriver, type: string): number {
  return Number(driver.prepare('SELECT COUNT(*) AS n FROM event_queue WHERE type = ?').get(type)!.n);
}

async function capture(driver: SqlDriver): Promise<OutgoingEvent[]> {
  const batch: OutgoingEvent[] = [];
  await flushEvents(driver, (events) => {
    batch.push(...events);
    return Promise.resolve();
  });
  return batch;
}

test('criterion 1: a failed send resends the same event_ids; success drains the queue', async () => {
  const driver = openFreshEventStore();
  emitEvent(driver, event());
  emitEvent(driver, event());

  const firstAttempt: string[] = [];
  // the transport dies after the server processed the batch — nothing was
  // marked, so the retry must go out with the very same event_ids
  await assert.rejects(
    flushEvents(driver, (events) => {
      firstAttempt.push(...events.map((e) => e.event_id));
      return Promise.reject(new Error('connection lost'));
    }),
    /connection lost/,
  );

  const secondAttempt = await capture(driver);
  assert.deepEqual(
    secondAttempt.map((e) => e.event_id),
    firstAttempt,
  );
  assert.equal(secondAttempt.length, 2);
  // the acknowledged batch never goes out again (one event = one credit)
  assert.equal((await capture(driver)).length, 0);
});

test('criterion 2: a new playback is a new event — distinct ids never merge into one credit', async () => {
  const driver = openFreshEventStore();
  emitEvent(
    driver,
    event({
      type: 'story_play_started',
      payload: JSON.stringify({ stop_id: 'stop-1', story_id: 'story-1', play_id: 1, trigger: 'gps' }),
    }),
  );
  emitEvent(
    driver,
    event({
      type: 'story_play_started',
      payload: JSON.stringify({ stop_id: 'stop-1', story_id: 'story-1', play_id: 2, trigger: 'gps' }),
    }),
  );

  const batch = await capture(driver);
  assert.equal(batch.length, 2);
  assert.notEqual(batch[0]!.event_id, batch[1]!.event_id);
  assert.deepEqual(
    batch.map((e) => (e.payload as { play_id: number }).play_id).sort(),
    [1, 2],
  );
});

test('criterion 3: kill/restart mid-queue loses neither unsent nor credited events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g0901-'));
  const file = path.join(dir, 'events.db');
  const credited = event();
  const pendingB = event();
  const pendingC = event();
  try {
    {
      const { driver, close } = nodeSqliteFileDriver(file);
      openDatabase(driver);
      emitEvent(driver, credited);
      assert.equal(await flushEvents(driver, async () => {}), 1); // credited before the kill
      emitEvent(driver, pendingB);
      emitEvent(driver, pendingC);
      close(); // the kill
    }
    {
      const { driver, close } = nodeSqliteFileDriver(file);
      openDatabase(driver);
      // the credited row survived and is not re-sent; the unsent tail kept
      // its payloads and stable order
      const batch = await capture(driver);
      assert.deepEqual(
        batch.map((e) => e.event_id),
        [pendingB.eventId, pendingC.eventId],
      );
      assert.deepEqual(
        batch.map((e) => e.type),
        ['app_open', 'app_open'],
      );
      assert.equal(queuedRows(driver, 'app_open'), 3); // nothing was dropped
      close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('criterion 4: a failing sender never blocks recording — error surfaces, queue keeps working', async () => {
  const driver = openFreshEventStore();
  const first = event();
  const second = event();
  emitEvent(driver, first);
  await assert.rejects(flushEvents(driver, async () => { throw new Error('offline'); }), /offline/);
  // Run records straight through the outage; nothing was marked
  emitEvent(driver, second);
  const batch = await capture(driver);
  assert.equal(batch.length, 2);
  assert.deepEqual(
    batch.map((e) => e.event_id).sort(),
    [first.eventId, second.eventId].sort(),
  );
});

test('criterion 5: a manual Play carries trigger manual and produces no stop_reached', async () => {
  const driver = openFreshEventStore();
  emitEvent(
    driver,
    event({
      type: 'story_play_started',
      payload: JSON.stringify({ stop_id: 'stop-1', story_id: 'story-1', play_id: 1, trigger: 'manual' }),
    }),
  );

  const batch = await capture(driver);
  assert.equal(batch.length, 1);
  assert.equal(batch[0]!.type, 'story_play_started');
  assert.equal((batch[0]!.payload as { trigger: string }).trigger, 'manual');
  // the queue never synthesizes a physical visit: stop_reached exists for
  // pipeline-confirmed presence only (event table, stop-reached-pipeline-only)
  assert.equal(queuedRows(driver, 'stop_reached'), 0);
});

test('emitEvent: a repeated event_id lands once through the service too', () => {
  const driver = openFreshEventStore();
  const one = event();
  emitEvent(driver, one);
  emitEvent(driver, one);
  assert.equal(queuedRows(driver, 'app_open'), 1);
});

test('the flush batch is bounded: a queue larger than the chunk goes out in order, nothing re-sent', async () => {
  const driver = openFreshEventStore();
  const ids: string[] = [];
  for (let i = 0; i < 300; i += 1) {
    const one = event({ at: 1_700_000_000_000 + i });
    ids.push(one.eventId);
    emitEvent(driver, one);
  }
  const batches: string[][] = [];
  await flushEvents(driver, (events) => {
    batches.push(events.map((e) => e.event_id));
    return Promise.resolve();
  });
  // 256 + 44: no driver's bind-parameter limit can wedge the queue, and a
  // revert to one unbounded batch fails this count
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flat(), ids);
  assert.equal((await capture(driver)).length, 0);
});

test('the beforeBatch gate stops the flush between chunks — acknowledged chunks stay marked, the tail stays pending', async () => {
  const driver = openFreshEventStore();
  const ids: string[] = [];
  for (let i = 0; i < 300; i += 1) {
    const one = event({ at: 1_700_000_000_000 + i });
    ids.push(one.eventId);
    emitEvent(driver, one);
  }
  let chunks = 0;
  const marked = await flushEvents(
    driver,
    (events) => {
      chunks += 1;
      assert.equal(events.length, 256);
      return Promise.resolve();
    },
    { beforeBatch: () => chunks === 0 },
  );

  assert.equal(chunks, 1, 'the gate closed before the second chunk was sent');
  assert.equal(marked, 256, 'only the acknowledged chunk is marked');
  assert.deepEqual(
    listPendingEvents(driver).map((row) => row.eventId),
    ids.slice(256),
    'the gated-out tail stays pending, in queue order',
  );
});

test('emit refuses a payload that is not a JSON object — named diagnostic, nothing stored', () => {
  const driver = openFreshEventStore();
  const corrupt = ['{broken', '5', '[1,2]', 'null'];
  for (const payload of corrupt) {
    assert.throws(
      () => emitEvent(driver, event({ payload })),
      (error: unknown) =>
        error instanceof DbError &&
        error.rule === 'event-payload-invalid-json' &&
        (payload === '{broken' ? /not valid JSON/.test(error.message) : /JSON object/.test(error.message)),
    );
  }
  assert.equal(queuedRows(driver, 'app_open'), 0);
});

test('flush surfaces a corrupt stored row as a named diagnostic and sends nothing', async () => {
  const driver = openFreshEventStore();
  emitEvent(driver, event());
  driver.prepare('UPDATE event_queue SET payload = ?').run('{broken');
  let senderCalled = false;
  await assert.rejects(
    flushEvents(driver, (events) => {
      senderCalled = true;
      return Promise.resolve();
    }),
    (error: unknown) => error instanceof DbError && error.rule === 'event-payload-invalid-json',
  );
  assert.equal(senderCalled, false);
  // the row stays pending for diagnostics, not silently dropped
  assert.equal(queuedRows(driver, 'app_open'), 1);
});

// G22.03 (issue #608, spec E3) — the flush reads the queue in bounded pages
// against a frozen enqueue_seq snapshot instead of one unbounded tail read.

// G22.03 — a driver wrapper that counts how many rows the pending queue
// query hands over. The flush must select one bounded page per attempt; this
// counts the real SELECTs against the store, not the wire batches.
function pendingRowCountingDriver(driver: SqlDriver, counter: { pendingRows: number }): SqlDriver {
  return {
    execSql: (sql) => driver.execSql(sql),
    prepare: (sql) => {
      const statement = driver.prepare(sql);
      if (!sql.includes('FROM event_queue') || !sql.includes('ORDER BY at, event_id')) return statement;
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => statement.get(...params),
        all: (...params) => {
          const rows = statement.all(...params);
          counter.pendingRows += rows.length;
          return rows;
        },
      };
    },
  };
}

test('flush_reads_one_bounded_page_before_send', async () => {
  const driver = openFreshEventStore();
  const total = 20_000;
  for (let i = 0; i < total; i += 1) {
    emitEvent(driver, event({ at: 1_700_000_000_000 + i }));
  }
  const reads = { pendingRows: 0 };
  const readsAtSend: number[] = [];
  const marked = await flushEvents(pendingRowCountingDriver(driver, reads), (batch) => {
    readsAtSend.push(reads.pendingRows);
    assert.ok(batch.length <= 256, 'the wire batch stays bounded too');
    return Promise.resolve();
  });
  assert.ok(
    (readsAtSend[0] ?? Number.POSITIVE_INFINITY) <= 256,
    `the first send attempt must be preceded by at most 256 selected rows, got ${String(readsAtSend[0])}`,
  );
  let previous = 0;
  for (const at of readsAtSend) {
    assert.ok(at - previous <= 256, 'every later query selects at most 256 rows');
    previous = at;
  }
  assert.equal(marked, total);
  assert.equal(listPendingEvents(driver).length, 0);
});

test('backdated_insert_waits_for_next_flush', async () => {
  const driver = openFreshEventStore();
  for (let i = 0; i < 600; i += 1) {
    emitEvent(driver, event({ at: 1_700_000_000_000 + i }));
  }
  const backdated = event({ at: 1_700_000_000_000 - 5_000 });
  const batches: string[][] = [];
  let firstLeft = true;
  await flushEvents(driver, (batch) => {
    if (firstLeft) {
      firstLeft = false;
      emitEvent(driver, backdated); // lands mid-flush, with an earlier `at`
    }
    batches.push(batch.map((e) => e.event_id));
    return Promise.resolve();
  });
  assert.ok(
    batches.flat().every((id) => id !== backdated.eventId),
    'an event appended during the flush stays pending until the next flush',
  );
  // the next flush picks it up first — its earlier `at` sorts ahead
  const next = await capture(driver);
  assert.deepEqual(next.map((e) => e.event_id), [backdated.eventId]);
});

test('batch_failure_preserves_pending_tail', async () => {
  const driver = openFreshEventStore();
  const ids: string[] = [];
  for (let i = 0; i < 600; i += 1) {
    const one = event({ at: 1_700_000_000_000 + i });
    ids.push(one.eventId);
    emitEvent(driver, one);
  }
  let attempt = 0;
  await assert.rejects(
    flushEvents(driver, (batch) => {
      attempt += 1;
      if (attempt === 2) return Promise.reject(new Error('connection lost'));
      return Promise.resolve();
    }),
    /connection lost/,
  );
  // the acknowledged first page stays marked; everything else stays pending
  assert.equal(Number(driver.prepare('SELECT COUNT(*) AS n FROM event_queue WHERE sent = 1').get()!.n), 256);
  assert.deepEqual(
    listPendingEvents(driver).map((row) => row.eventId),
    ids.slice(256),
    'the unacknowledged tail keeps its order and identity',
  );
  // the retry resends exactly the tail, same ids, then drains the queue
  const retry: string[][] = [];
  const marked = await flushEvents(driver, (batch) => {
    retry.push(batch.map((e) => e.event_id));
    return Promise.resolve();
  });
  assert.deepEqual(retry.flat(), ids.slice(256));
  assert.equal(marked, 344);
});

// G22.03 — the shared mid-send identity-switch arrangement: a captured
// owner, a queue of 600 events, and a sender whose first call runs the
// caller's identity action. The two scenarios below differ only in what that
// action does (a bare replacement vs a full account clearing), so the flush
// harness is one helper, not two pasted variants (jscpd).
async function flushWithMidSendIdentity(
  action: (driver: SqlDriver, replacement: EventInput) => void,
): Promise<{ driver: SqlDriver; replacement: EventInput; sends: number; marked: number }> {
  const driver = openFreshEventStore();
  setDeviceId(driver, 'device-old');
  for (let i = 0; i < 600; i += 1) {
    emitEvent(driver, event({ at: 1_700_000_000_000 + i }));
  }
  const replacement = event({ at: 1_700_000_000_000 + 10_000 });
  let sends = 0;
  const marked = await flushEvents(driver, (batch) => {
    sends += 1;
    if (sends === 1) action(driver, replacement);
    return Promise.resolve();
  });
  return { driver, replacement, sends, marked };
}

test('owner_change_stops_old_flush', async () => {
  // a replacement that keeps the rows: the identity switches mid-send while
  // the old account's events are still queued — the in-flight flush must
  // stop and must not acknowledge those rows for the new owner
  const { driver, replacement, sends, marked } = await flushWithMidSendIdentity((d, rep) => {
    setDeviceId(d, 'device-new');
    emitEvent(d, rep);
  });
  assert.equal(sends, 1, 'no further batch goes out after the ownership change');
  assert.equal(marked, 0, 'the in-flight batch is never acknowledged for the new owner');
  assert.equal(
    listPendingEvents(driver).length,
    601,
    'nothing marked, nothing lost: the old rows and the replacement event all stay pending',
  );
  assert.ok(
    listPendingEvents(driver).some((row) => row.eventId === replacement.eventId),
    'the replacement event stays pending for the next flush',
  );
});

test('account_clearing_mid_flush_keeps_the_replacement_event_pending', async () => {
  const { driver, replacement, sends, marked } = await flushWithMidSendIdentity((d, rep) => {
    // the account is cleared and replaced mid-send: queue rows go away,
    // the replacement account writes its own event and takes the device
    clearDeviceAccountState(d);
    emitEvent(d, rep);
    setDeviceId(d, 'device-new');
  });
  assert.equal(sends, 1, 'no further batch goes out after the clearing');
  assert.equal(marked, 0, 'the in-flight batch is not acknowledged by the old flush');
  assert.deepEqual(
    listPendingEvents(driver).map((row) => row.eventId),
    [replacement.eventId],
    'the replacement account keeps its own pending event; no old work touches it',
  );
  const refilled = await flushEvents(driver, async () => {});
  assert.equal(refilled, 1, 'the new owner flushes its own event under its own identity');
});
