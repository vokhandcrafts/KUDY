import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { installCdpFakes } from './cdp-browser-fake.mjs';

let mode = 'socket-closes';
const state = installCdpFakes({
  onSend(payload, socket) {
    const { method } = JSON.parse(payload);
    assert.equal(method, 'Browser.close');
    if (mode === 'socket-closes') queueMicrotask(() => socket.close());
  },
});
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
  t.after(() => rmSync(state.profileDir, { recursive: true, force: true }));
  assert.equal(await closesWithin(browser, 250), true, 'closed socket must finish cleanup without a CDP reply');
  assert.equal(state.child.killed, true);
  assert.equal(existsSync(state.profileDir), false);
});

test('CDP cleanup: an unresponsive close is bounded and still releases the child and profile', async t => {
  mode = 'unresponsive';
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => rmSync(state.profileDir, { recursive: true, force: true }));
  assert.equal(await closesWithin(browser, 3000), true, 'unresponsive browser must not keep the suite alive');
  assert.equal(state.child.killed, true);
  assert.equal(existsSync(state.profileDir), false);
});
