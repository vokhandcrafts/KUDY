import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { installCdpFakes } from './cdp-browser-fake.mjs';

const state = installCdpFakes({
  onSend(payload, socket) {
    const { method } = JSON.parse(payload);
    // Close still has to finish; only the probed command stays unanswered.
    if (method === 'Browser.close') queueMicrotask(() => socket.close());
  },
});
const { launchBrowser } = await import('../web/test-browser/cdp-browser.mjs');

test('CDP command: a command that never replies fails within its timeout and kills the child', async (t) => {
  const browser = await launchBrowser('synthetic-chromium');
  t.after(async () => {
    await browser.close();
    rmSync(state.profileDir, { recursive: true, force: true });
  });
  assert.equal(state.spawnArgs.includes('--disable-crashpad-for-testing'), false);
  assert.equal(state.spawnArgs.includes('--in-process-gpu'), false);
  assert.equal(state.spawnOptions.detached, undefined);
  const started = Date.now();
  await assert.rejects(
    () => browser.send('Runtime.evaluate', {}, undefined, 200),
    /CDP Runtime\.evaluate timed out after 200ms/,
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(state.child.killed, true);
  await browser.close();
  await browser.close();
});

test('CDP command: send() without a timeout uses the 15000ms default and kills the child', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => {
    rmSync(state.profileDir, { recursive: true, force: true });
  });
  const pending = browser.send('Runtime.evaluate');
  let settled = null;
  pending.then(() => { settled = 'resolved'; }, (error) => { settled = error; });
  t.mock.timers.tick(14999);
  await Promise.resolve();
  assert.equal(settled, null);
  assert.equal(state.child.killed, false);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(state.child.killed, true);
  assert.ok(settled instanceof Error);
  assert.match(settled.message, /CDP Runtime\.evaluate timed out after 15000ms/);
  await browser.close();
});

test('CDP command: close rejects an in-flight command that never replies', async (t) => {
  const browser = await launchBrowser('synthetic-chromium');
  t.after(() => {
    rmSync(state.profileDir, { recursive: true, force: true });
  });
  const pending = browser.send('Runtime.evaluate');
  let settled = null;
  pending.then(() => { settled = 'resolved'; }, (error) => { settled = error; });
  await browser.close();
  await Promise.resolve();
  assert.ok(settled instanceof Error, 'close must reject the in-flight command');
  assert.match(settled.message, /CDP closed before Runtime\.evaluate finished/);
});
