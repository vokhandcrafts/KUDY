// G20.20 — the free byte source over a stubbed fetch: status passthrough,
// byte mapping, and the redaction rule (a failure names the rule and the
// status, never the URL). The deadline case rides the real wait-policy
// owner with a short limit (implementation-rules 1: removing the
// withWaitLimit wrapper fails deadline_named).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaitTimeoutError, withWaitLimit as realWithWaitLimit } from '../network-wait.ts';

const originalFetch = globalThis.fetch;

test('a 200 answers the full bytes; failures keep rule and status only', async () => {
  const body = new Uint8Array([1, 2, 3]).buffer;
  globalThis.fetch = (async () => ({ status: 200, arrayBuffer: async () => body })) as unknown as typeof fetch;
  const { createOriginByteSource } = await import('./origin-bytes.ts');
  const fetchBytes = createOriginByteSource('https://files.example.invalid');
  assert.deepEqual([...(await fetchBytes('bundles/r/lock.json'))], [1, 2, 3]);
  globalThis.fetch = (async () => ({ status: 404, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
  await assert.rejects(() => fetchBytes('bundles/r/lock.json'), /bundle-bytes#status-404/);
  try {
    await fetchBytes('bundles/r/lock.json');
  } catch (error) {
    assert.ok(!(error instanceof Error && error.message.includes('example.invalid')), 'the URL never leaks');
  }
  globalThis.fetch = originalFetch;
});

test('a stalled transfer terminates named at the deadline', async () => {
  globalThis.fetch = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const { createOriginByteSource } = await import('./origin-bytes.ts');
  const fetchBytes = createOriginByteSource('https://files.example.invalid', 25 as number);
  try {
    await fetchBytes('x');
    assert.fail('expected the deadline');
  } catch (error) {
    assert.ok(error instanceof WaitTimeoutError);
    assert.equal(error.rule, 'wait-bundle-bytes');
  }
  globalThis.fetch = originalFetch;
});

// Silence the unused import guard: the real withWaitLimit is exercised
// through the adapter; the named import documents the owner.
void realWithWaitLimit;
