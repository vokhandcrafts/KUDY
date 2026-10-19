// G23.05 (#663): recovery journeys on the installed Android app. SQLite is
// read through run-as only for facts the UI cannot expose (pinned version and
// exact session identity); actions still pass through the app and origin.
import assert from 'node:assert/strict';

import { findNode } from './driver.mjs';
import { backToExplore, nodesOn, requireId, startWalkAtLocation, tapMapPoint,
  visiblePointStatus, waitForRun } from './walk.mjs';

const FREE = 'e2e-free-guide';
const PAID = 'e2e-paid-guide';
const SHORT_MS = 30000;
const DOWNLOAD_MS = 120000;
const PLAYED = /[Пп]раслух|[Пп]райгран|[Pp]layed/;

async function sessionRows(driver, appPackage) {
  const found = await driver.exec(['shell', 'run-as', appPackage, 'find', '.', '-name', 'kudy.db']);
  const dbPath = found.stdout.trim().split(/\r?\n/).find((line) => line.endsWith('/kudy.db'));
  assert.ok(dbPath && /^\.\/(?:files|databases)\//.test(dbPath), `app SQLite database not found: ${found.stdout.trim()}`);
  const query = 'SELECT session_id,route_id,version,locale,state,heard,auto_fired FROM session ORDER BY started_at,session_id';
  const result = await driver.exec(['shell', `run-as ${appPackage} sqlite3 -json ${dbPath} '${query}'`]);
  return JSON.parse(result.stdout.trim() || '[]');
}

function oneLive(rows) {
  const live = rows.filter((row) => row.state === 'active' || row.state === 'paused');
  assert.equal(live.length, 1, `expected one live session, found ${live.length}`);
  return live[0];
}

async function openMy(driver) {
  await backToExplore(driver);
  await driver.tapSelector({ testID: 'link-kudy' });
  return nodesOn(driver, 'screen-KUDY', 'recovery-my');
}

async function openPreview(driver, routeId) {
  await driver.launchDeepLink(`kudy:///route/${routeId}`);
  await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS });
}

async function assertHeardStop(driver, stopId, slug) {
  await visiblePointStatus(driver, stopId, (node) => PLAYED.test(node.text), slug, DOWNLOAD_MS);
}

export async function runRecoverySuite({ driver, url, runCase, coldStart, appPackage, clearOriginFault }) {
  let originalSessionId = null;
  let originalProgress = null;

  await runCase('recovery: failed download remains unavailable, then retries after origin recovery',
    'recovery-download', driver, async () => {
      await coldStart(driver, url, { timeoutMs: 420000, caseSlug: 'recovery-download' });
      await driver.waitFor({ testID: `guide-card-${FREE}` }, { timeoutMs: SHORT_MS });
      await openPreview(driver, FREE);
      await driver.tapSelector({ testID: 'btn-download' });
      await driver.waitFor({ testID: 'download-error' }, { timeoutMs: DOWNLOAD_MS });
      let nodes = await nodesOn(driver, 'screen-Route preview', 'download-failed');
      requireId(nodes, 'download-error-banner');
      requireId(nodes, 'btn-download-retry');
      assert.equal(findNode(nodes, { testID: 'btn-start', enabled: true }), undefined,
        'failed package was advertised as Start-ready');
      await clearOriginFault();
      await driver.tapSelector({ testID: 'btn-download-retry' });
      await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: DOWNLOAD_MS });
      nodes = await nodesOn(driver, 'screen-Route preview', 'download-retried');
      assert.equal(findNode(nodes, { testID: 'download-error' }), undefined);
    });

  await runCase('recovery: background and foreground preserve the active session and heard progress',
    'recovery-background', driver, async () => {
      await startWalkAtLocation(driver, 53.9, 27.56);
      await waitForRun(driver, 'recovery-start');
      await driver.geoFix(53.9, 27.56);
      await assertHeardStop(driver, 'e2e-stop-1', 'recovery-before-background');
      const before = oneLive(await sessionRows(driver, appPackage));
      assert.equal(before.version, '1');
      assert.ok(JSON.parse(before.heard).includes('story-free-1'), 'stop 1 did not checkpoint heard progress');
      originalSessionId = before.session_id;
      originalProgress = before.heard;
      await driver.background();
      await driver.foregroundApp(appPackage);
      await waitForRun(driver, 'recovery-foreground');
      await assertHeardStop(driver, 'e2e-stop-1', 'recovery-after-background');
      const after = oneLive(await sessionRows(driver, appPackage));
      assert.equal(after.session_id, originalSessionId);
      assert.equal(after.heard, originalProgress);
      assert.equal(after.version, before.version);
    });

  await runCase('recovery: force-stop restores the pinned walk and its heard stop',
    'recovery-force-stop', driver, async () => {
      assert.ok(originalSessionId, 'the background case did not capture a session');
      await coldStart(driver, url, { timeoutMs: 180000, caseSlug: 'recovery-force-stop' });
      const my = await openMy(driver);
      requireId(my, `my-session-${originalSessionId}`);
      requireId(my, `my-live-state-${originalSessionId}`);
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await waitForRun(driver, 'recovery-restored');
      const nodes = await nodesOn(driver, 'screen-Run', 'recovery-restored-banner');
      requireId(nodes, 'run-restored');
      await assertHeardStop(driver, 'e2e-stop-1', 'recovery-restored-heard');
      const restored = oneLive(await sessionRows(driver, appPackage));
      assert.equal(restored.session_id, originalSessionId);
      assert.equal(restored.version, '1');
      assert.equal(restored.heard, originalProgress);
    });

  await runCase('recovery: revoked location permission leaves a working manual Play path',
    'recovery-permission', driver, async () => {
      // ADB can leave background granted after foreground is revoked, a
      // combination the normal Settings UI cannot produce. Revoke all scopes.
      await driver.exec(['shell', 'pm', 'revoke', appPackage, 'android.permission.ACCESS_BACKGROUND_LOCATION']);
      await driver.exec(['shell', 'pm', 'revoke', appPackage, 'android.permission.ACCESS_FINE_LOCATION']);
      await driver.exec(['shell', 'pm', 'revoke', appPackage, 'android.permission.ACCESS_COARSE_LOCATION']);
      try {
        await coldStart(driver, url, { timeoutMs: 180000, caseSlug: 'recovery-permission' });
        await driver.launchDeepLink(`kudy:///run/${FREE}`);
        await waitForRun(driver, 'recovery-manual', false);
        const nodes = await nodesOn(driver, 'screen-Run', 'recovery-location-degraded');
        assert.ok(findNode(nodes, { testID: 'run-gps-denied' }) ||
          findNode(nodes, { testID: 'run-autoplay-suspended' }),
        'revoked location did not offer a manual continuation');
        await tapMapPoint(driver, 'e2e-stop-2');
        await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
        await driver.tapSelector({ testID: 'btn-card-play' });
        await assertHeardStop(driver, 'e2e-stop-2', 'recovery-manual-play');
      } finally {
        await driver.exec(['shell', 'pm', 'grant', appPackage, 'android.permission.ACCESS_COARSE_LOCATION']);
        await driver.exec(['shell', 'pm', 'grant', appPackage, 'android.permission.ACCESS_FINE_LOCATION']);
        await driver.exec(['shell', 'pm', 'grant', appPackage, 'android.permission.ACCESS_BACKGROUND_LOCATION']);
      }
    });

  await runCase('recovery: cancelling a second-guide start retains the first session',
    'recovery-switch-cancel', driver, async () => {
      assert.ok(originalSessionId, 'the first session was not captured');
      const before = oneLive(await sessionRows(driver, appPackage));
      await openPreview(driver, PAID);
      let nodes = await nodesOn(driver, 'screen-Route preview', 'recovery-paid-preview');
      if (findNode(nodes, { testID: 'btn-download' })) {
        await driver.tapSelector({ testID: 'btn-download' });
        await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: DOWNLOAD_MS });
      }
      await driver.tapSelector({ testID: 'btn-start', enabled: true });
      await driver.waitFor({ testID: 'confirm-dialog' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-confirm-cancel' });
      nodes = await nodesOn(driver, 'screen-Route preview', 'recovery-cancelled');
      assert.equal(findNode(nodes, { testID: 'confirm-dialog' }), undefined);
      const live = oneLive(await sessionRows(driver, appPackage));
      assert.equal(live.session_id, originalSessionId);
      assert.equal(live.heard, before.heard);
    });

  await runCase('recovery: End stays finished and a new pass creates a new session',
    'recovery-new-pass', driver, async () => {
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await waitForRun(driver, 'recovery-before-end');
      await driver.tapSelector({ testID: 'btn-run-end' });
      await driver.waitFor({ testID: 'end-confirm-dialog' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-end-confirm-accept' });
      await driver.waitFor({ testID: 'run-ended' }, { timeoutMs: SHORT_MS });
      let rows = await sessionRows(driver, appPackage);
      assert.equal(rows.find((row) => row.session_id === originalSessionId)?.state, 'finished');
      assert.equal(rows.filter((row) => row.state !== 'finished').length, 0);
      await openPreview(driver, FREE);
      await driver.tapSelector({ testID: 'btn-start', enabled: true });
      await waitForRun(driver, 'recovery-new-pass');
      rows = await sessionRows(driver, appPackage);
      const next = oneLive(rows);
      assert.notEqual(next.session_id, originalSessionId);
      assert.deepEqual(JSON.parse(next.heard), []);
      assert.equal(rows.find((row) => row.session_id === originalSessionId)?.state, 'finished');
    });

  await runCase('recovery: removing downloaded files leaves durable session history and progress',
    'recovery-clear-downloads', driver, async () => {
      assert.ok(originalSessionId, 'the first session was not captured');
      const before = await sessionRows(driver, appPackage);
      const packageDirs = await driver.exec(['shell', 'run-as', appPackage, 'find', 'files', '-type', 'd', '-name', FREE]);
      const dir = packageDirs.stdout.trim().split(/\r?\n/).find((line) => /(?:^|\/)bundles\/.+e2e-free-guide$/.test(line));
      assert.ok(dir && /^files\/bundles\//.test(dir), `downloaded package directory not found: ${packageDirs.stdout.trim()}`);
      await driver.exec(['shell', 'run-as', appPackage, 'rm', '-rf', dir]);
      await coldStart(driver, url, { timeoutMs: 180000, caseSlug: 'recovery-clear-downloads' });
      const after = await sessionRows(driver, appPackage);
      assert.deepEqual(after, before, 'clearing package files changed durable session rows');
      const my = await openMy(driver);
      requireId(my, `my-history-state-${originalSessionId}`);
    });
}
