// G20.20 — the wakelock adapter over a recording keep-awake facility: the
// tagged lease reaches both calls, and a refused activate degrades to
// screen-off without an unhandled rejection (implementation-rules 1: a
// reverted catch surfaces as an unhandled rejection on this test).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeviceWakelock } from './device-wakelock.ts';

test('the wakelock lease carries the one tag', async () => {
  const calls: string[] = [];
  const lock = createDeviceWakelock({
    activate: async (tag) => {
      calls.push(`activate:${tag}`);
    },
    deactivate: (tag) => {
      calls.push(`deactivate:${tag}`);
    },
  });
  lock.acquire();
  lock.release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, ['activate:kudy-run', 'deactivate:kudy-run']);
});

test('a refused lease is swallowed by the adapter, not unhandled', async () => {
  let refused = false;
  const unhandled = (error: unknown) => {
    refused = true;
    void error;
  };
  process.on('unhandledRejection', unhandled);
  const lock = createDeviceWakelock({
    activate: async () => {
      throw new Error('unsupported');
    },
    deactivate: () => {},
  });
  lock.acquire();
  await new Promise((resolve) => setTimeout(resolve, 10));
  process.off('unhandledRejection', unhandled);
  assert.equal(refused, false);
});
