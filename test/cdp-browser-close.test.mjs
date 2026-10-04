import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { mock, test } from 'node:test';

let mode = 'socket-closes';
let child;
let profileDir;
mock.module('node:child_process', { namedExports: {
  spawn(_binary, args) {
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
    const { method } = JSON.parse(payload);
    assert.equal(method, 'Browser.close');
    if (mode === 'socket-closes') queueMicrotask(() => this.close());
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
