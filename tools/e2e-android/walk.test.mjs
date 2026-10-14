import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertNoReadyStart, waitForRun, locationListeners } from './walk.mjs';

const target = 'bundle/e2e-free-guide/1/be/base/audio/story-free-3.m4a';
const start = `E2E stall start: ${target}\n`;
const complete = `E2E stall complete: ${target}\n`;

function screen(startEnabled = false) {
  return `<node resource-id="screen-Route preview" enabled="true"/>` +
    `<node resource-id="btn-start" enabled="${startEnabled}"/>`;
}

test('the download guard rejects Start throughout an unfinished held response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-walk-held-'));
  const log = path.join(dir, 'origin.log');
  try {
    fs.writeFileSync(log, start);
    const driver = { dump: async () => ({ xml: screen(true) }) };
    await assert.rejects(assertNoReadyStart(driver, log, 1000), /Start became enabled/);
    const waitingDriver = { dump: async () => ({ xml: screen(false) }) };
    await assert.rejects(assertNoReadyStart(waitingDriver, log, 0), /did not complete/);
    fs.appendFileSync(log, complete);
    await assertNoReadyStart(waitingDriver, log, 1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('walk accepts location accuracy so the pending GPS watch can start', async () => {
  let accepted = false;
  const driver = {
    dump: async () => ({ xml: accepted
      ? '<node resource-id="screen-Run"/><node resource-id="run-map"/>'
      : '<node text="No thanks" resource-id="android:id/button2"/><node text="OK" resource-id="android:id/button1"/>' }),
    tapNode: async (node) => {
      assert.equal(node.resourceId, 'android:id/button1');
      accepted = true;
    },
  };
  await waitForRun(driver, 'accuracy');
  assert.equal(accepted, true);
});

test('location observer checks app-attributed running access behind Play Services', async () => {
  let running = true;
  const driver = { exec: async (args) => {
    if (args.includes('dumpsys')) return { stdout: 'Location Providers:\n com.google.android.gms[fused_location_provider]\n  Historical Aggregate Location Provider Data:\n by.kudy.app' };
    assert.deepEqual(args, ['shell', 'cmd', 'appops', 'get', 'by.kudy.app', 'MONITOR_LOCATION']);
    return { stdout: running ? 'MONITOR_LOCATION: allow; time=+1s ago; (running)' : 'MONITOR_LOCATION: allow; time=+1s ago; duration=+2s' };
  } };
  assert.equal((await locationListeners(driver)).length, 1);
  running = false;
  assert.deepEqual(await locationListeners(driver), []);
});
