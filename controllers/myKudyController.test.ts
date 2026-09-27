// G06.04 (issue #63) — the My KUDY history controller: the rows the port
// hands over are the screen's state, the store's own order kept; a failed
// read is the named unavailable state, never invented rows. The refresh is
// one load at a time — a slower earlier read never overwrites a newer one.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMyKudyController, type MyKudyState, type SessionHistoryPort } from './myKudyController.ts';
import type { SessionRow } from '../services/db/types.ts';

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

const until = async (store: { getState(): MyKudyState }, predicate: (state: MyKudyState) => boolean): Promise<MyKudyState> => {
  for (let tries = 0; tries < 200; tries += 1) {
    const state = store.getState();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the controller never reached the awaited state');
};

test('G06.04: the history is the live walk beside the finished runs, the store order kept', async () => {
  const rows = [row('walk-live', 'paused', 5_000), row('walk-old', 'finished', 1_000)];
  let calls = 0;
  const port: SessionHistoryPort = {
    list: async () => {
      calls += 1;
      return rows;
    },
  };
  const store = createMyKudyController(port);
  const state = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.deepEqual(state.rows.map((entry) => entry.sessionId), ['walk-live', 'walk-old']);
  assert.equal(state.rows[0]?.state, 'paused');
  // The screen's focus refresh re-reads the port.
  await store.getState().refresh();
  assert.equal(calls, 2);
});

test('G06.04: a failed read is the named unavailable, not fake rows', async () => {
  const store = createMyKudyController({
    list: async () => {
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
  let resolveSlow: ((rows: SessionRow[]) => void) | undefined;
  let calls = 0;
  const store = createMyKudyController({
    list: async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<SessionRow[]>((resolve) => {
          resolveSlow = resolve;
        });
      }
      return [row('walk-new', 'active', 9_000)];
    },
  });
  // The boot read hangs; the screen's focus refresh runs and finishes first.
  const second = store.getState().refresh();
  const ready = (await until(store, (current) => current.status === 'ready')) as Extract<
    MyKudyState,
    { status: 'ready' }
  >;
  assert.deepEqual(ready.rows.map((entry) => entry.sessionId), ['walk-new']);
  // The stale boot read lands late and writes nothing.
  resolveSlow?.([row('walk-stale', 'finished', 1_000)]);
  await Promise.resolve();
  const final = store.getState();
  assert.equal(final.status, 'ready');
  assert.deepEqual(final.status === 'ready' ? final.rows.map((entry) => entry.sessionId) : [], ['walk-new']);
  void second;
});
