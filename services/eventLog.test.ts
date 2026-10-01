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

import { DbError, openDatabase } from './db/db.ts';
import { nodeSqliteDriver, nodeSqliteFileDriver } from './db/test-fixture.ts';
import type { EventInput, SqlDriver } from './db/types.ts';
import { emitEvent, flushEvents, type OutgoingEvent } from './eventLog.ts';

function openFresh(): SqlDriver {
  const driver = nodeSqliteDriver();
  openDatabase(driver);
  return driver;
}

let seq = 0;
function event(overrides: Partial<EventInput> = {}): EventInput {
  seq += 1;
  return {
    eventId: `11111111-1111-4111-8111-${String(seq).padStart(12, '0')}`,
    type: 'app_open',
    at: 1_700_000_000_000 + seq,
    schemaVersion: 1,
    payload: JSON.stringify({}),
    ...overrides,
  };
}

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
  const driver = openFresh();
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
  const driver = openFresh();
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
  const driver = openFresh();
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
  const driver = openFresh();
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
  const driver = openFresh();
  const one = event();
  emitEvent(driver, one);
  emitEvent(driver, one);
  assert.equal(queuedRows(driver, 'app_open'), 1);
});

test('the flush batch is bounded: a queue larger than the chunk goes out in order, nothing re-sent', async () => {
  const driver = openFresh();
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

test('emit refuses a payload that is not a JSON object — named diagnostic, nothing stored', () => {
  const driver = openFresh();
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
  const driver = openFresh();
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
