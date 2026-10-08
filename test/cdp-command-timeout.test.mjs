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
  assert.ok(state.spawnArgs.includes('--disable-gpu-watchdog'));
  assert.ok(state.spawnArgs.includes('--in-process-gpu'));
  assert.equal(state.spawnArgs.includes('--disable-crashpad-for-testing'), false);
  assert.equal(state.spawnOptions.detached, true);
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
