// G20.10 (issue #481) — behavioral checks for the wait-policy owner. The
// mechanics are proven on the primitive with a controlled clock (node:test
// fake timers: the deadline, the timer cleanup after every ending, owner
// disposal and the late-reply rule) plus one production adapter (the catalog
// loader) against a stubbed platform fetch that never resolves.
import assert from 'node:assert/strict';
import test from 'node:test';

import { stubGlobalFetch } from './fetch-stub-test-fixture.ts';
import { createOriginCatalogLoader } from './catalog/loader.ts';
import { NETWORK_WAIT_LIMITS, WaitTimeoutError, withWaitLimit } from './network-wait.ts';

test('timeout_cleanup: the timer is cleared on success — the deadline never fires after the wait settled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const outcome = await withWaitLimit('wait-catalog', 10_000, (signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    return Promise.resolve('done');
  });
  assert.equal(outcome, 'done');
  // Advancing the clock past the limit: a live timer would abort the signal
  // here; a cleared one cannot (implementation-rules 1 — the revert makes
  // this test red).
  t.mock.timers.tick(60_000);
  assert.equal(aborted, false, 'no deadline fired after a successful wait');
});

test('timeout_cleanup: the deadline fires the named error and aborts the signal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let abortObserved = false;
  const wait = withWaitLimit('wait-config', 10_000, (signal) => {
    signal.addEventListener('abort', () => {
      abortObserved = true;
    });
    return new Promise<string>(() => {});
  });
  const expectation = assert.rejects(wait, (error: WaitTimeoutError) => {
    assert.equal(error.rule, 'wait-config');
    assert.equal(error.kind, 'timeout');
    return true;
  });
  t.mock.timers.tick(10_000);
  await expectation;
  // The deadline aborted the request signal itself — an adapter honoring
  // the signal stops transferring the body, not just the headers.
  assert.equal(abortObserved, true, 'the abort reached the running request');
});

test('timeout_cleanup: owner disposal cancels named, and a late reply cannot settle the wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owner = new AbortController();
  let settleLate: (() => void) | null = null;
  const wait = withWaitLimit(
    'wait-device',
    10_000,
    (signal) =>
      new Promise<string>((resolve) => {
        // The adapter resolves only when the test releases it — long after
        // the owner is gone.
        signal.addEventListener('abort', () => {
          settleLate = () => resolve('late reply');
        });
      }),
    owner.signal,
  );
  const expectation = assert.rejects(wait, (error: WaitTimeoutError) => {
    assert.equal(error.kind, 'cancelled');
    assert.equal(error.rule, 'wait-device');
    return true;
  });
  owner.abort();
  await expectation;
  // The late reply lands after disposal: the wait already rejected, nobody
  // consumes the stale resolution — disposed state is never mutated.
  assert.notEqual(settleLate, null, 'the abort reached the adapter');
  settleLate!();
  t.mock.timers.tick(60_000);
  assert.ok(true, 'no late settle and no timer leak after cancellation');
});

test('the wait limits have one owner: every rule carries its NETWORK_WAIT_LIMITS value', () => {
  // The policy constants are the single source the call sites read; this pin
  // fails the removal of any limit from the owner (implementation-rules 1).
  assert.equal(NETWORK_WAIT_LIMITS.catalogMs, 10_000);
  assert.equal(NETWORK_WAIT_LIMITS.configMs, 10_000);
  assert.equal(NETWORK_WAIT_LIMITS.deviceMs, 10_000);
  assert.equal(NETWORK_WAIT_LIMITS.grantRequestMs, 15_000);
  assert.equal(NETWORK_WAIT_LIMITS.grantBytesMs, 30_000);
});

test('stalled_catalog_loader_deadline: an unresolved catalog fetch rejects named at the deadline', async () => {
  const stub = stubGlobalFetch(
    () =>
      new Promise<Response>(() => {
        // never resolves — the stalled origin
      }),
  );
  try {
    const loader = createOriginCatalogLoader('https://catalog.example.invalid', { waitLimitMs: 25 });
    await assert.rejects(loader('catalog.json'), (error: WaitTimeoutError) => {
      assert.equal(error.rule, 'wait-catalog');
      assert.equal(error.kind, 'timeout');
      return true;
    });
  } finally {
    stub.restore();
  }
});

test('timeout_cleanup: an owner already gone before the wait answers cancelled immediately', async () => {
  // The pre-aborted signal never fires an abort event again — the wait must
  // still reject named without waiting out its deadline (the first delta
  // review round caught the hang).
  const owner = new AbortController();
  owner.abort();
  const started = Date.now();
  await assert.rejects(
    withWaitLimit('wait-device', 60_000, () => new Promise<string>(() => {}), owner.signal),
    (error: WaitTimeoutError) => {
      assert.equal(error.kind, 'cancelled');
      assert.equal(error.rule, 'wait-device');
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, 'the wait rejected immediately, not at the deadline');
});
