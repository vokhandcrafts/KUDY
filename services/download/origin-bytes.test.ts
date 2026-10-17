import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { WaitTimeoutError } from '../network-wait.ts';
import { activate, layerPath } from './download.ts';
import { createOriginByteSource } from './origin-bytes.ts';
import { depsFor, lockFrom, STOPS } from './test-fixture.ts';
import type { LayerKey } from './types.ts';

const originalFetch = globalThis.fetch;
const origin = 'https://files.example.invalid';
const response = (status: number, body: () => Promise<ArrayBuffer>): Response =>
  Object.assign(new Response(null, { status }), { arrayBuffer: body });

test('successful bytes and non-200 status keep the response contract and redact the URL', async () => {
  try {
    globalThis.fetch = (async () => response(200, async () => Uint8Array.from([1, 2, 3]).buffer)) as typeof fetch;
    const fetchBytes = createOriginByteSource(origin);
    assert.deepEqual([...(await fetchBytes('bundles/r/lock.json'))], [1, 2, 3]);

    globalThis.fetch = (async () => response(404, async () => {
      assert.fail('a non-200 body must not be read');
    })) as typeof fetch;
    await assert.rejects(() => fetchBytes('bundles/r/lock.json'), (error: Error) => {
      assert.equal(error.message, 'bundle-bytes#status-404');
      assert.ok(!error.message.includes(origin));
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('delayed headers abort at the named deadline', async () => {
  let signal: AbortSignal | undefined;
  try {
    globalThis.fetch = (async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    await assert.rejects(createOriginByteSource(origin, 20)('x'), (error: Error) => {
      assert.ok(error instanceof WaitTimeoutError);
      assert.equal(error.rule, 'wait-bundle-bytes');
      assert.equal(error.kind, 'timeout');
      return true;
    });
    assert.equal(signal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stalled body aborts at the named deadline; a late body cannot succeed', async () => {
  let signal: AbortSignal | undefined;
  let releaseBody: ((body: ArrayBuffer) => void) | undefined;
  const body = new Promise<ArrayBuffer>((resolve) => { releaseBody = resolve; });
  try {
    globalThis.fetch = (async (_input, init) => {
      signal = init?.signal ?? undefined;
      return response(200, () => body);
    }) as typeof fetch;
    const pending = createOriginByteSource(origin, 20)('x');
    await assert.rejects(pending, (error: Error) => {
      assert.ok(error instanceof WaitTimeoutError);
      assert.equal(error.rule, 'wait-bundle-bytes');
      assert.equal(error.kind, 'timeout');
      return true;
    });
    assert.equal(signal?.aborted, true);
    releaseBody?.(Uint8Array.from([9]).buffer);
    await assert.rejects(pending, WaitTimeoutError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a delayed body that finishes before the deadline returns its bytes', async () => {
  let releaseBody: ((body: ArrayBuffer) => void) | undefined;
  const body = new Promise<ArrayBuffer>((resolve) => { releaseBody = resolve; });
  try {
    globalThis.fetch = (async () => response(200, () => body)) as typeof fetch;
    const pending = createOriginByteSource(origin, 500)('x');
    releaseBody?.(Uint8Array.from([4, 5]).buffer);
    assert.deepEqual([...(await pending)], [4, 5]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetch rejection is named and does not expose the source URL', async () => {
  try {
    globalThis.fetch = (async () => {
      throw new Error(`request failed at ${origin}/secret`);
    }) as typeof fetch;
    await assert.rejects(createOriginByteSource(origin)('x'), (error: Error) => {
      assert.equal(error.message, 'bundle-bytes#fetch-failed');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('body rejection is named and does not expose the source URL', async () => {
  try {
    globalThis.fetch = (async () => response(200, async () => {
      throw new Error(`read failed at ${origin}/secret`);
    })) as typeof fetch;
    await assert.rejects(createOriginByteSource(origin)('x'), (error: Error) => {
      assert.equal(error.message, 'bundle-bytes#body-failed');
      assert.ok(!error.message.includes(origin));
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('activate stays partial after a body timeout and completes on retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2033-'));
  const key: LayerKey = { routeId: 'route-x', version: '1', locale: 'be', tier: 'base' };
  let calls = 0;
  let timedOutSignal: AbortSignal | undefined;
  try {
    globalThis.fetch = (async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        timedOutSignal = init?.signal ?? undefined;
        return response(200, () => new Promise<ArrayBuffer>(() => {}));
      }
      return response(200, async () => Uint8Array.from(STOPS).buffer);
    }) as typeof fetch;
    const { deps } = depsFor(root);
    deps.fetch = createOriginByteSource(origin, 20);
    const lock = await lockFrom({ 'stops.json': STOPS });
    const first = await activate({ ...key, lock }, deps);
    assert.equal(first.status, 'partial');
    if (first.status !== 'partial') return;
    assert.deepEqual(first.missing, ['stops.json']);
    assert.match(first.diagnostics[0] ?? '', /stops\.json#fetch-failed/);
    assert.match(first.diagnostics[1] ?? '', /wait-bundle-bytes/);
    assert.equal(timedOutSignal?.aborted, true);
    assert.equal(fs.existsSync(path.join(root, layerPath(key))), false);

    const second = await activate({ ...key, lock }, deps);
    assert.equal(second.status, 'complete');
    assert.equal(calls, 2);
    assert.deepEqual(fs.readFileSync(path.join(root, layerPath(key), 'stops.json')), Buffer.from(STOPS));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
