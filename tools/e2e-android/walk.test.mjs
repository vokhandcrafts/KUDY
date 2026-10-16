import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertNoReadyStart, waitForRun, locationListeners, waitForManualStart, tapMapPoint, visiblePointStatus, startWalkAtLocation } from './walk.mjs';

test('walk seeds the emulator position before starting its location watcher', async () => {
  const calls = [];
  await startWalkAtLocation({
    geoFix: async (...coordinates) => { calls.push(['fix', ...coordinates]); },
    tapSelector: async (selector) => { calls.push(['tap', selector]); },
  }, 53.9, 27.56);
  assert.deepEqual(calls, [['fix', 53.9, 27.56], ['tap', { testID: 'btn-start', enabled: true }]]);
});

test('walk map point helpers use native list or schematic marker as rendered', async () => {
  for (const path of ['native', 'schematic']) {
    const taps = [];
    let pointsListOpen = false;
    const driver = {
      dump: async () => ({ xml: path === 'native'
        ? `<node resource-id="run-map-points"/>${pointsListOpen ? '<node resource-id="run-point-status-stop-1" text="played"/>' : ''}`
        : '<node resource-id="run-marker-stop-1"/><node resource-id="run-status-stop-1" text="played"/>' }),
      tapSelector: async ({ testID }) => {
        taps.push(testID);
        if (testID === 'run-map-points') pointsListOpen = !pointsListOpen;
        if (testID === 'run-point-stop-1') pointsListOpen = false;
      },
    };
    await tapMapPoint(driver, 'stop-1');
    await visiblePointStatus(driver, 'stop-1', (node) => node.text === 'played', 'fallback-test', 0);
    assert.deepEqual(taps, path === 'native'
      ? ['run-map-points', 'run-point-stop-1', 'run-map-points', 'run-map-points']
      : ['run-marker-stop-1']);
  }
});

test('walk status polling follows the native map when it loads after the schematic', async () => {
  const taps = [];
  let dumps = 0;
  let pointsListOpen = false;
  const driver = {
    dump: async () => {
      dumps += 1;
      if (dumps === 1) return { xml: '<node resource-id="run-marker-stop-1"/><node resource-id="run-status-stop-1" text="чакае"/>' };
      return { xml: `<node resource-id="run-map-points"/>${pointsListOpen ? '<node resource-id="run-point-status-stop-1" text="played"/>' : ''}` };
    },
    tapSelector: async ({ testID }) => {
      taps.push(testID);
      if (testID === 'run-map-points') pointsListOpen = !pointsListOpen;
    },
  };

  const status = await visiblePointStatus(driver, 'stop-1', (node) => node.text === 'played', 'native-load', 1000);
  assert.equal(status.resourceId, 'run-point-status-stop-1');
  assert.deepEqual(taps, ['run-map-points', 'run-map-points']);
});

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

test('manual walk dismisses the location-disabled notice without enabling location', async () => {
  let closed = false;
  const driver = {
    dump: async () => ({ xml: closed ? screen(true) : '<node text="No location access"/><node resource-id="android:id/button2" text="Close"/><node resource-id="android:id/button1" text="Turn on location"/>' }),
    tapNode: async (node) => {
      assert.equal(node.resourceId, 'android:id/button2');
      closed = true;
    },
  };
  await waitForManualStart(driver);
  assert.equal(closed, true);
});

test('manual Run declines accuracy settings while location is deliberately off', async () => {
  let declined = false;
  const driver = {
    dump: async () => ({ xml: declined
      ? '<node resource-id="screen-Run"/><node resource-id="run-map"/>'
      : '<node text="No thanks" resource-id="android:id/button2"/><node text="OK" resource-id="android:id/button1"/>' }),
    tapNode: async (node) => {
      assert.equal(node.resourceId, 'android:id/button2');
      declined = true;
    },
  };
  await waitForRun(driver, 'manual', false);
  assert.equal(declined, true);
});
