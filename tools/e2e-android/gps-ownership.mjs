// G20.42 (#822): the walk's GPS ownership matrix on a real emulator. The
// native Expo adapter runs the ordinary session actions and the suite reads
// the OS's own attribution views — `dumpsys location` for the listener lines
// and `cmd appops get by.kudy.app MONITOR_LOCATION` for the per-app running
// op — never a fake counter and never the silent player UI. No raw
// coordinates, personal or production data are captured: the geo seeds are
// the suite's synthetic Minsk points and every snapshot holds listener
// attribution lines only.
//
// The no-revival polls run 22 s, past the 15 s gap watch: a stale tick that
// survived Pause or End fires (and resubscribes through the recovery step)
// no later than 15 s after the disarm, so the polls would see it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseDump, findNode } from './driver.mjs';
import {
  backToExplore,
  nodesOn,
  requireId,
  sessionRow,
  startWalkAtLocation,
  waitForLocationListeners,
  waitForRun,
} from './walk.mjs';

const SHORT_MS = 30000;
const DOWNLOAD_MS = 120000;
const POLL_MS = 300;
const FREE = 'e2e-free-guide';
const RECOVERY_WINDOW_MS = 22000;

// The synthetic walk origin of the walk suite (the same Minsk block).
const WALK_LAT = 53.9;
const WALK_LNG = 27.56;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The OS's per-app attribution view: one (running) line while our app holds
// an active location op, none while it holds none. This is the view that
// names the owner, so the "exactly one" and the "whose listener is this"
// assertions read it — remaining OS location requests are attributed here,
// not counted as walk leaks. A single adb roundtrip may time out on a loaded
// emulator; the read retries inside the caller's deadline.
export async function runningLocationOps(driver) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    try {
      const access = await driver.exec(['shell', 'cmd', 'appops', 'get', 'by.kudy.app', 'MONITOR_LOCATION']);
      return access.stdout.split(/\r?\n/).filter((line) => /\(running\)/.test(line));
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(POLL_MS * 2);
    }
  }
}

export async function waitForOpCount(driver, count) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    const ops = await runningLocationOps(driver);
    if (ops.length === count) return ops;
    if (Date.now() >= deadline) {
      throw new Error(`location op count did not become ${count}; last: ${ops.join(' | ')}`);
    }
    await delay(POLL_MS);
  }
}

// A named OS-state snapshot next to the case dumps (artifacts dir, gitignored).
async function snapshot(driver, name) {
  const location = await driver.exec(['shell', 'dumpsys', 'location']);
  const access = await driver.exec(['shell', 'cmd', 'appops', 'get', 'by.kudy.app', 'MONITOR_LOCATION']);
  const body = [
    `# ${name}`,
    '## cmd appops get by.kudy.app MONITOR_LOCATION',
    access.stdout,
    '## dumpsys location (lines naming the app)',
    location.stdout.split(/\r?\n/).filter((line) => line.includes('by.kudy.app')).join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(driver.artifactsDir, `gps-${name}.txt`), body);
  return body;
}

// Longer than the whole recovery window: any revival a stale gap-watch tick
// drives would resubscribe within 15 s of the disarm.
async function assertNoRevival(driver, slug, geoFix) {
  const deadline = Date.now() + RECOVERY_WINDOW_MS;
  let polls = 0;
  while (Date.now() < deadline) {
    const ops = await runningLocationOps(driver);
    assert.equal(ops.length, 0, `a location op reappeared during ${slug}: ${ops.join(' | ')}`);
    geoFix(); // a revived subscription would consume the seeded fix
    polls += 1;
    await delay(POLL_MS * 5);
  }
  console.log(`gps: ${slug} — no revival in ${String(polls)} polls over ${String(RECOVERY_WINDOW_MS)} ms`);
}

// The arrange of the walk cases: cold start, open the free guide's preview,
// download it, and wait for Start to unlock (the walk suite's arrange
// without its preview assertions — those belong to the walk suite). The
// location scopes are granted through pm grant (the recovery suite's idiom):
// this suite proves subscription ownership, not the permission ask, and an
// unanswered runtime dialog would leave no subscription to observe.
export async function arrangeReadyStart(driver, url, coldStart) {
  for (const scope of ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION']) {
    await driver.exec(['shell', 'pm', 'grant', 'by.kudy.app', scope]);
  }
  await coldStart(driver, url, { timeoutMs: 420000, caseSlug: 'gps-explore' });
  await driver.waitFor({ testID: `guide-card-${FREE}` }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-guide-card.xml' });
  await driver.tapSelector({ testID: 'link-guides' });
  await driver.waitFor({ testID: 'screen-Guides' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-guides.xml' });
  await driver.tapSelector({ testID: `guide-card-${FREE}` });
  await driver.waitFor({ testID: 'btn-download' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-preview.xml' });
  await driver.tapSelector({ testID: 'btn-download' });
  await driver.waitFor({ testID: 'btn-start', enabled: true },
    { timeoutMs: DOWNLOAD_MS, dumpBasename: 'dump-gps-start-ready.xml' });
}

export async function runGpsOwnershipSuite({ driver, url, runCase, coldStart }) {
  await runCase('gps: Start holds exactly one subscription; Pause releases it and no stale tick revives it',
    'gps-pause', driver, async () => {
      await arrangeReadyStart(driver, url, coldStart);
      await startWalkAtLocation(driver, WALK_LAT, WALK_LNG);
      await waitForRun(driver, 'gps-entry');
      const ops = await waitForOpCount(driver, 1);
      await waitForLocationListeners(driver, true);
      await snapshot(driver, 'after-start');
      console.log(`gps: after Start the app runs ${String(ops.length)} location op: ${ops.join(' | ')}`);

      await driver.tapSelector({ testID: 'btn-run-pause' });
      await driver.waitFor({ testID: 'run-paused' }, { timeoutMs: SHORT_MS });
      await waitForOpCount(driver, 0);
      await waitForLocationListeners(driver, false);
      await snapshot(driver, 'after-pause');
      await assertNoRevival(driver, 'paused-no-revival', () => driver.geoFix(WALK_LAT + 0.001, WALK_LNG + 0.002));
    });

  await runCase('gps: Resume re-arms exactly one subscription', 'gps-resume', driver, async () => {
    await driver.tapSelector({ testID: 'btn-run-resume' });
    // The paused banner must go before the subscription can come back.
    const deadline = Date.now() + SHORT_MS;
    for (;;) {
      const nodes = parseDump((await driver.dump('dump-gps-resumed.xml')).xml);
      if (!findNode(nodes, { testID: 'run-paused' })) break;
      if (Date.now() >= deadline) throw new Error('timeout waiting for the paused banner to clear');
      await delay(POLL_MS);
    }
    const ops = await waitForOpCount(driver, 1);
    await waitForLocationListeners(driver, true);
    await snapshot(driver, 'after-resume');
    console.log(`gps: after Resume the app runs ${String(ops.length)} location op: ${ops.join(' | ')}`);
  });

  await runCase('gps: Back while active retains the walk subscription; the Nearby surface adds no owner',
    'gps-back', driver, async () => {
      await driver.tapSelector({ testID: 'btn-run-back' });
      await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-back-preview.xml' });
      await backToExplore(driver);
      // The deliberate Back semantics: the live session keeps its subscription.
      const ops = await waitForOpCount(driver, 1);
      await snapshot(driver, 'after-back-explore');
      console.log(`gps: after Back the app still runs ${String(ops.length)} location op: ${ops.join(' | ')}`);

      // The Nearby surface must hold, not add a second owner.
      await driver.tapSelector({ testID: 'link-nearby' });
      await driver.waitFor({ testID: 'screen-Map' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-nearby.xml' });
      const nearbyNodes = parseDump((await driver.dump('dump-gps-nearby-mode.xml')).xml);
      const mode = findNode(nearbyNodes, { testID: 'nearby-mode' });
      console.log(`gps: Nearby view while the walk is live: ${mode ? mode.text : '(no mode header)'}`);
      const heldOps = await waitForOpCount(driver, 1);
      await snapshot(driver, 'nearby-while-walk-live');
      console.log(`gps: Nearby open while live — still ${String(heldOps.length)} location op (held, not doubled)`);
      await driver.tapSelector({ testID: 'btn-map-back' });
      await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-nearby-closed.xml' });
      await waitForOpCount(driver, 1); // the walk's subscription survives the surface
      await snapshot(driver, 'nearby-closed-walk-still-live');

      // The same live session is reachable again from My KUDY.
      await driver.tapSelector({ testID: 'link-kudy' });
      const myNodes = await nodesOn(driver, 'screen-KUDY', 'gps-my-live');
      requireId(myNodes, 'my-live-section');
      const rowId = sessionRow(myNodes);
      console.log(`gps: live row while back-navigated: ${rowId}`);
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await waitForRun(driver, 'gps-return-to-run');
      await waitForOpCount(driver, 1);
      await snapshot(driver, 'returned-to-run');
    });

  await runCase('gps: End releases everything; ungated deep-link re-entry remains non-live (#862)',
    'gps-end', driver, async () => {
      await driver.tapSelector({ testID: 'btn-run-end' });
      await driver.waitFor({ testID: 'end-confirm-dialog' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-end-dialog.xml' });
      await driver.tapSelector({ testID: 'btn-end-confirm-accept' });
      await driver.waitFor({ testID: 'run-ended' }, { timeoutMs: SHORT_MS });
      await waitForOpCount(driver, 0);
      await waitForLocationListeners(driver, false);
      await snapshot(driver, 'after-end');
      await assertNoRevival(driver, 'ended-no-revival', () => driver.geoFix(WALK_LAT + 0.001, WALK_LNG + 0.002));

      await backToExplore(driver);
      await driver.tapSelector({ testID: 'link-kudy' });
      const historyNodes = await nodesOn(driver, 'screen-KUDY', 'gps-my-history');
      requireId(historyNodes, 'my-history-section');
      const historyRows = historyNodes.filter((node) => node.resourceId.startsWith('my-session-'));
      assert.ok(historyRows.length >= 1, 'the ended session never reached the My KUDY history');
      console.log(`gps: ended session is history: ${historyRows.map((row) => row.resourceId).join(', ')}`);

      // #862: a direct link has no preview-approved Start. It must neither
      // create a session row nor re-arm the walk's location subscription.
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await driver.waitFor({ testID: 'run-unavailable-reason' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-reentry-run.xml' });
      await snapshot(driver, 'after-reentry');
      const reentryNodes = parseDump((await driver.dump('dump-gps-reentry-state.xml')).xml);
      requireId(reentryNodes, 'run-unavailable');
      assert.equal(findNode(reentryNodes, { testID: 'btn-run-pause' }), undefined, 'ungated link started a walk');
      await waitForOpCount(driver, 0);
      await waitForLocationListeners(driver, false);
      await assertNoRevival(driver, 'reentry-no-revival', () => driver.geoFix(WALK_LAT + 0.001, WALK_LNG + 0.002));

      // Check the persisted history through the same My KUDY UI. No second
      // session row should appear after the ungated mount.
      await driver.tapSelector({ testID: 'btn-run-back' });
      await backToExplore(driver);
      await driver.tapSelector({ testID: 'link-kudy' });
      const afterNodes = await nodesOn(driver, 'screen-KUDY', 'gps-my-after-reentry');
      const afterRows = afterNodes.filter((node) => node.resourceId.startsWith('my-session-'));
      assert.deepEqual(
        afterRows.map((row) => row.resourceId).sort(),
        historyRows.map((row) => row.resourceId).sort(),
        'ungated Run re-entry created a session row',
      );
      // The next GPS ownership case begins from the non-live Run surface.
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await driver.waitFor({ testID: 'run-unavailable-reason' }, { timeoutMs: SHORT_MS });
    });

  await runCase('gps: with no walk live the Nearby surface is the explicit city owner', 'gps-city', driver, async () => {
    await driver.tapSelector({ testID: 'btn-run-back' });
    await backToExplore(driver);
    // No walk is live now: the remaining listener could only be a city owner.
    await driver.tapSelector({ testID: 'link-nearby' });
    await driver.waitFor({ testID: 'screen-Map' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-city-open.xml' });
    const ops = await waitForOpCount(driver, 1);
    await snapshot(driver, 'nearby-city-owner');
    console.log(`gps: Nearby open with no walk — the city owner runs ${String(ops.length)} location op: ${ops.join(' | ')}`);
    await driver.tapSelector({ testID: 'btn-map-back' });
    await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS, dumpBasename: 'dump-gps-city-closed.xml' });
    await waitForOpCount(driver, 0);
    await snapshot(driver, 'nearby-city-released');
    console.log('gps: the city surface returned the subscription on close');
  });
}
