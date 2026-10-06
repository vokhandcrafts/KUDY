import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { mock, test } from 'node:test';

// Touch the global before mock.module. Node 22.14's experimental module
// mock hides a lazy global this module has not read yet, and WebSocket is
// one of those — mock.method then sees undefined. CI's 22.23 already
// exposes it; the read is a no-op there.
void globalThis.WebSocket;

let mode = 'socket-closes';
let child;
let profileDir;
mock.module('node:child_process', { namedExports: {
  spawn(_binary, args, options) {
    assert.equal(options.detached, true, 'Chromium must lead its own process group');
    profileDir = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    setImmediate(() => child.stderr.emit('data', 'DevTools listening on ws://127.0.0.1/synthetic'));
    return child;
  },
} });

class FakeSocket extends EventTarget {
  closed = false;
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(payload) {
    if (this.closed) throw new Error('socket closed');
    const message = JSON.parse(payload);
    if (message.method === 'Browser.close') {
      if (mode !== 'unresponsive') queueMicrotask(() => this.close());
      return;
    }
    if (mode === 'reply') {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ id: message.id, result: { ok: true } }),
      })));
      return;
    }
    if (mode === 'null-then-reply') {
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent('message', { data: null }));
        this.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ id: message.id, result: { ok: true } }),
        }));
      });
      return;
    }
    if (mode === 'drop-socket') queueMicrotask(() => this.close());
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}
mock.method(globalThis, 'WebSocket', function () { return new FakeSocket(); });
const { launchBrowser } = await import('../web/test-browser/cdp-browser.mjs');

async function closesWithin(browser, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      browser.close().then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A reverted driver leaves the command pending. Race a short deadline so
// the regression fails instead of pinning the suite the way CI did.
async function settleOrPending(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => 'resolved', (error) => error),
      new Promise(resolve => { timer = setTimeout(() => resolve('pending'), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('CDP cleanup: a socket closing before the Browser.close reply still kills the child and removes its profile', async t => {
  mode = 'socket-closes';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => rmSync(profileDir, { recursive: true, force: true }));
  assert.equal(await closesWithin(browser, 250), true, 'closed socket must finish cleanup without a CDP reply');
  assert.equal(child.killed, true);
  assert.equal(existsSync(profileDir), false);
});

test('CDP cleanup: an unresponsive close is bounded and still releases the child and profile', async t => {
  mode = 'unresponsive';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => rmSync(profileDir, { recursive: true, force: true }));
  assert.equal(await closesWithin(browser, 3000), true, 'unresponsive browser must not keep the suite alive');
  assert.equal(child.killed, true);
  assert.equal(existsSync(profileDir), false);
});

test('CDP command: a reply settles the command', async t => {
  mode = 'reply';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => browser.close());
  assert.deepEqual(await browser.send('Runtime.evaluate', {}, undefined, 1000), { ok: true });
});

test('CDP command: a null DevTools frame does not drop the real reply', async t => {
  mode = 'null-then-reply';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => browser.close());
  assert.deepEqual(await browser.send('Runtime.evaluate', {}, undefined, 1000), { ok: true });
});

test('CDP command: a socket close rejects an in-flight command instead of leaving it pending', async t => {
  mode = 'drop-socket';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => browser.close());
  const outcome = await settleOrPending(browser.send('Runtime.evaluate', {}, undefined, 5000), 500);
  assert.ok(outcome instanceof Error, 'a closed socket must reject the command');
  assert.match(outcome.message, /DevTools WebSocket closed/);
});

test('CDP command: no reply rejects within the command timeout', async t => {
  mode = 'silent';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => browser.close());
  const started = Date.now();
  const outcome = await settleOrPending(browser.send('Runtime.evaluate', {}, undefined, 200), 1000);
  assert.ok(outcome instanceof Error, 'a missing reply must reject, not stay pending');
  assert.match(outcome.message, /timed out after 200ms/);
  assert.ok(Date.now() - started < 1000);
});
