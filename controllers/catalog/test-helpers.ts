// G06.01.b (issue #314) — shared controller-test helpers: the deferred
// promise gate, the boot-completion poll and the path-loader fake. One copy
// for the controller suites — sibling variants are jscpd clones
// (implementation-rules 3, 8).
import assert from 'node:assert/strict';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'condition not reached');
}

export function loaderFromTexts(map: Record<string, string>): (relPath: string) => Promise<string> {
  return (relPath) =>
    relPath in map ? Promise.resolve(map[relPath]) : Promise.reject(new Error(`unexpected: ${relPath}`));
}
