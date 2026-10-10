import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mock, test } from 'node:test';
import { installCdpFakes } from './cdp-browser-fake.mjs';

const realRmSync = fs.rmSync.bind(fs);
const rmCalls = [];
let failCode = null;
let failTimes = 0;

mock.method(fs, 'rmSync', (target, options) => {
  rmCalls.push(target);
  if (failCode !== null && rmCalls.length <= failTimes) {
    const error = new Error(failCode);
    error.code = failCode;
    throw error;
  }
  return realRmSync(target, options);
});

const state = installCdpFakes({
  onSend(payload, socket) {
    const { method } = JSON.parse(payload);
    if (method === 'Browser.close') queueMicrotask(() => socket.close());
  },
});
const { launchBrowser } = await import('../web/test-browser/cdp-browser.mjs');

function flush() {
  return Promise.resolve().then(() => Promise.resolve());
}

test('CDP cleanup: EPERM is retried after 250ms, longer than the 50ms POSIX backoff', async (t) => {
  rmCalls.length = 0;
  failCode = 'EPERM';
  failTimes = 1;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => {
    failCode = null;
    realRmSync(state.profileDir, { recursive: true, force: true });
  });
  const closing = browser.close();
  let settled = null;
  closing.then(() => { settled = 'ok'; }, (error) => { settled = error; });
  await flush();
  assert.equal(rmCalls.length, 1);
  t.mock.timers.tick(249);
  await flush();
  assert.equal(rmCalls.length, 1, 'EPERM must not retry at the 50ms POSIX delay');
  t.mock.timers.tick(1);
  await flush();
  assert.equal(rmCalls.length, 2);
  assert.equal(settled, 'ok');
  assert.equal(fs.existsSync(state.profileDir), false);
});

test('CDP cleanup: exhausted profile removal writes the path to stderr and does not throw', async (t) => {
  rmCalls.length = 0;
  failCode = 'EPERM';
  failTimes = 5;
  const lines = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = function write(chunk, encoding, callback) {
    lines.push(String(chunk));
    return originalWrite.call(this, chunk, encoding, callback);
  };
  t.after(() => {
    process.stderr.write = originalWrite;
    failCode = null;
    realRmSync(state.profileDir, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser = await launchBrowser('synthetic-chromium');
  const closing = browser.close();
  let settled = null;
  closing.then(() => { settled = 'ok'; }, (error) => { settled = error; });
  await flush();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    t.mock.timers.tick(250);
    await flush();
  }
  assert.equal(rmCalls.length, 5);
  assert.equal(settled, 'ok');
  const diagnostic = lines.join('');
  assert.match(diagnostic, /profile cleanup failed after 5 attempts:/);
  assert.ok(diagnostic.includes(state.profileDir));
  assert.equal(fs.existsSync(state.profileDir), true);
});
