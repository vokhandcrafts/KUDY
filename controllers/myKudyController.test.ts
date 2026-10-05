// G06.04 (issue #63) — the My KUDY history controller: the rows the port
// hands over are the screen's state, the store's own order kept; a failed
// read is the named unavailable state, never invented rows. G22.06 (spec E6):
// the completed history arrives in pages — a late page never overwrites a
// refresh, the live walk stays visible while paging, and the cursor walks to
// an honest empty final page without losing or duplicating rows.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMyKudyController, type MyKudyState, type SessionHistoryPort } from './myKudyController.ts';
import type {
  SessionHistoryCursor,
  SessionHistoryPage,
  SessionHistorySummary,
  SessionRow,
} from '../services/db/types.ts';

const row = (sessionId: string, state: SessionRow['state'], startedAt: number): SessionRow => ({
  sessionId,
  routeId: 'route-map',
  version: '1',
  locale: 'be',
  tier: ['base'],
  state,
  startedAt,
  finishedAt: state === 'finished' ? startedAt + 1_000 : null,
  autoFired: [],
  heard: ['story-1'],
  lastStopId: null,
  playSeq: 1,
});

const summaryOf = (entry: SessionRow): SessionHistorySummary => ({
  sessionId: entry.sessionId,
  routeId: entry.routeId,
  version: entry.version,
  locale: entry.locale,
  state: entry.state,
  startedAt: entry.startedAt,
  finishedAt: entry.finishedAt,
  heardCount: entry.heard.length,
});

// A scripted page: the live walk and the completed summaries of one read.
const page = (
  live: SessionRow | null,
  finished: SessionRow[],
  nextCursor: SessionHistoryCursor | null,
): SessionHistoryPage => ({
  live,
  rows: finished.map(summaryOf),
  nextCursor,
});

const until = async (store: { getState(): MyKudyState }, predicate: (state: MyKudyState) => boolean): Promise<MyKudyState> => {
  for (let tries = 0; tries < 200; tries += 1) {
    const state = store.getState();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the controller never reached the awaited state');
};

test('G06.04: the history is the live walk beside the finished runs, the store order kept', async () => {
  const live = row('walk-live', 'paused', 5_000);
  const done = row('walk-old', 'finished', 1_000);
  let calls = 0;
  const port: SessionHistoryPort = {
    listPage: async () => {
      calls += 1;
      return page(live, [done], null);
    },
  };
  const store = createMyKudyController(port);
  const state = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.equal(state.live?.sessionId, 'walk-live');
  assert.deepEqual(state.rows.map((entry) => entry.sessionId), ['walk-old']);
  assert.equal(state.nextCursor, null, 'a single page closes the walk');
  // The screen's focus refresh re-reads the port.
  await store.getState().refresh();
  assert.equal(calls, 2);
});

test('G06.04: a failed read is the named unavailable, not fake rows', async () => {
  const store = createMyKudyController({
    listPage: async () => {
      throw new Error('db closed');
    },
  });
  const state = (await until(store, (current) => current.status === 'unavailable')) as Extract<
    MyKudyState,
    { status: 'unavailable' }
  >;
  assert.equal(state.reason, 'db closed');
});

test('G06.04: a slower earlier read never overwrites a newer one', async () => {
  const fresh = row('walk-new', 'active', 9_000);
  let resolveSlow: ((value: SessionHistoryPage) => void) | undefined;
  let calls = 0;
  const store = createMyKudyController({
    listPage: async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<SessionHistoryPage>((resolve) => {
          resolveSlow = resolve;
        });
      }
      return page(fresh, [], null);
    },
  });
  // The boot read hangs; the screen's focus refresh runs and finishes first.
  const second = store.getState().refresh();
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.equal(ready.live?.sessionId, 'walk-new');
  // The stale boot read lands late and writes nothing.
  resolveSlow?.(page(fresh, [], null));
  await Promise.resolve();
  const final = store.getState();
  assert.equal(final.status, 'ready');
  assert.equal(final.status === 'ready' ? final.live?.sessionId : null, 'walk-new');
  void second;
});

const CURSOR_ONE: SessionHistoryCursor = { startedAt: 4_000, sessionId: 'walk-1' };
const CURSOR_TWO: SessionHistoryCursor = { startedAt: 3_000, sessionId: 'walk-2' };

test('loadMore appends the next pages and the empty final page closes the walk', async () => {
  const done = (id: string, startedAt: number): SessionRow => row(id, 'finished', startedAt);
  let calls = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      calls += 1;
      if (cursor === null) return page(null, [done('walk-1', 4_000), done('walk-2', 3_000)], CURSOR_ONE);
      if (cursor === CURSOR_ONE) return page(null, [done('walk-3', 2_000)], CURSOR_TWO);
      if (cursor === CURSOR_TWO) return page(null, [], null);
      throw new Error('no scripted page');
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.deepEqual(ready.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2']);
  await store.getState().loadMore();
  await store.getState().loadMore();
  const grown = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(grown.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2', 'walk-3']);
  assert.equal(grown.nextCursor, null, 'the empty final page closes the walk');
  assert.equal(grown.moreError, null);
  assert.equal(grown.loadingMore, false);
  // past the end the load-more is a no-op — the port is not called again
  await store.getState().loadMore();
  assert.equal(calls, 3);
});

test('late_page_does_not_overwrite_refresh: a page landing after a refresh is discarded whole', async () => {
  const live = row('walk-live', 'paused', 5_000);
  const first = row('walk-1', 'finished', 4_000);
  const second = row('walk-2', 'finished', 3_000);
  let releaseLate: ((value: SessionHistoryPage) => void) | undefined;
  let cursorReads = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      if (cursor === null) return page(live, [first], CURSOR_ONE);
      cursorReads += 1;
      // only the first page-two read hangs; later ones resolve — the paging
      // must survive the superseded attempt
      if (cursorReads === 1) {
        return new Promise<SessionHistoryPage>((resolve) => {
          releaseLate = () => resolve(page(null, [second], null));
        });
      }
      return page(null, [second], null);
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.deepEqual(ready.rows.map((entry) => entry.sessionId), ['walk-1']);
  // the load-more hangs; the focus refresh runs and finishes first
  const pending = store.getState().loadMore();
  await store.getState().refresh();
  const refreshed = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(refreshed.rows.map((entry) => entry.sessionId), ['walk-1'], 'the refresh reset to page one');
  // the late page lands into a history that moved on — nothing is appended
  releaseLate?.(page(null, [second], null));
  await pending;
  const final = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(final.rows.map((entry) => entry.sessionId), ['walk-1'], 'no duplicate, no stale row');
  assert.equal(final.loadingMore, false, 'the superseded page unlocks the load-more state');
  assert.equal(final.moreError, null);
  // the negative guard: paging keeps working after the superseded attempt —
  // the in-flight flag must not stay stuck for the rest of the store's life
  const cursorReadsBefore = cursorReads;
  await store.getState().loadMore();
  assert.equal(cursorReads, cursorReadsBefore + 1, 'loadMore reaches the port again after a superseded attempt');
  const grown = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(grown.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2'], 'the retried page appends');
});

test('live_session_is_visible_on_every_page: paging never hides the live walk', async () => {
  const live = row('walk-live', 'paused', 5_000);
  const done = row('walk-1', 'finished', 4_000);
  let reads = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      reads += 1;
      if (cursor === null && reads === 1) return page(live, [done], CURSOR_ONE);
      // the walk finished between the pages — a later read reports it
      // honestly, but the screen keeps showing the walk until that refresh
      return page(null, [], null);
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.equal(ready.live?.sessionId, 'walk-live');
  await store.getState().loadMore();
  const paged = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.equal(paged.live?.sessionId, 'walk-live', 'the live walk stays visible while paging');
  // the next refresh reports the finish without losing the completed rows
  await store.getState().refresh();
  const refreshed = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.equal(refreshed.live, null, 'the refresh reports the finished walk honestly');
});

test('a load-more failure keeps the rows, names the error and retries the same page', async () => {
  const done = row('walk-1', 'finished', 4_000);
  let fail = true;
  let calls = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      calls += 1;
      if (cursor === null) return page(null, [done], CURSOR_ONE);
      if (fail) throw new Error('db busy');
      return page(null, [row('walk-2', 'finished', 3_000)], null);
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  await store.getState().loadMore();
  const failed = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.equal(failed.status, 'ready', 'a failed page does not empty the loaded rows');
  assert.deepEqual(failed.rows.map((entry) => entry.sessionId), ['walk-1']);
  assert.equal(failed.moreError, 'db busy');
  assert.equal(failed.nextCursor, CURSOR_ONE, 'the cursor stays open for the retry');
  // the retry re-reads the same page and recovers
  fail = false;
  await store.getState().loadMore();
  const recovered = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(recovered.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2']);
  assert.equal(recovered.moreError, null);
  assert.equal(calls, 3);
});

test('a load-more in flight blocks a second one — no double append', async () => {
  const done = row('walk-1', 'finished', 4_000);
  const next = row('walk-2', 'finished', 3_000);
  let release: ((value: SessionHistoryPage) => void) | undefined;
  let calls = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      calls += 1;
      if (cursor === null) return page(null, [done], CURSOR_ONE);
      return new Promise<SessionHistoryPage>((resolve) => {
        release = () => resolve(page(null, [next], null));
      });
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  const pending = store.getState().loadMore();
  await store.getState().loadMore();
  release?.(page(null, [next], null));
  await pending;
  const final = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(final.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2'], 'appended exactly once');
  assert.equal(calls, 2, 'the second concurrent load-more never reached the port');
});

test('a completion between pages neither duplicates nor loses rows', async () => {
  const older = row('walk-2', 'finished', 3_000);
  const first = row('walk-1', 'finished', 4_000);
  const fresh = row('walk-0', 'finished', 9_000);
  let calls = 0;
  const store = createMyKudyController({
    listPage: async (cursor) => {
      calls += 1;
      if (cursor === null && calls === 1) return page(null, [first], CURSOR_ONE);
      if (cursor === CURSOR_ONE) return page(null, [older], null);
      // the boot read of the second visit: the new completion sorts first
      return page(null, [fresh, first], CURSOR_ONE);
    },
  });
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  await store.getState().loadMore();
  const paged = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  assert.deepEqual(paged.rows.map((entry) => entry.sessionId), ['walk-1', 'walk-2'], 'the new completion is not on the tail pages yet');
  // the surface's focus refresh reopens page one — the new completion lands
  // exactly once, the tail pages still hold the older rows
  await store.getState().refresh();
  await store.getState().loadMore();
  const final = store.getState() as Extract<MyKudyState, { status: 'ready' }>;
  const ids = final.rows.map((entry) => entry.sessionId);
  assert.deepEqual(ids, ['walk-0', 'walk-1', 'walk-2']);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates after the mid-history completion');
});
