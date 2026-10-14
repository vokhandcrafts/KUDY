// G23.04 (#662): Journey 1 and the free portion of Journey 2 on a real
// emulator. All screen assertions read fresh uiautomator dumps through the
// G23.03 driver; polling intervals only pace observations, never stand in
// for a state transition.
import assert from 'node:assert/strict';

import { findNode, parseDump } from './driver.mjs';

const SHORT_MS = 30000;
const DOWNLOAD_MS = 120000;
const POLL_MS = 300;
const FREE = 'e2e-free-guide';
const PAID = 'e2e-paid-guide';

const delay = () => new Promise((resolve) => setTimeout(resolve, POLL_MS));

async function nodesOn(driver, screenId, slug) {
  await driver.waitFor({ testID: screenId }, { timeoutMs: SHORT_MS, dumpBasename: `dump-walk-${slug}-screen.xml` });
  return parseDump((await driver.dump(`dump-walk-${slug}.xml`)).xml);
}

function requireId(nodes, id) {
  const node = findNode(nodes, { testID: id });
  assert.ok(node, `missing testID ${id}`);
  return node;
}

async function waitForId(driver, id, predicate, slug, timeoutMs = SHORT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastPath = '';
  for (;;) {
    const dump = await driver.dump(`dump-walk-${slug}.xml`);
    lastPath = dump.localPath;
    const node = findNode(parseDump(dump.xml), { testID: id });
    if (node && predicate(node)) return node;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for testID ${id} (${slug}); last dump: ${lastPath}`);
    await delay();
  }
}

async function assertNoReadyStart(driver, durationMs) {
  const deadline = Date.now() + durationMs;
  for (;;) {
    const nodes = parseDump((await driver.dump('dump-walk-download-held.xml')).xml);
    requireId(nodes, 'screen-Route preview');
    assert.equal(findNode(nodes, { testID: 'btn-start', enabled: true }), undefined,
      'Start became enabled before the held package file was delivered');
    if (Date.now() >= deadline) return;
    await delay();
  }
}

async function assertNoPlaying(driver, durationMs, slug) {
  const deadline = Date.now() + durationMs;
  for (;;) {
    const nodes = parseDump((await driver.dump(`dump-walk-${slug}.xml`)).xml);
    requireId(nodes, 'screen-Run');
    assert.equal(findNode(nodes, { testID: 'btn-bar-playpause' }), undefined,
      `audio started during ${slug}`);
    assert.equal(nodes.some((node) => node.resourceId.startsWith('run-status-') && /гучыць|playing/i.test(node.text)), false,
      `a stop is playing during ${slug}`);
    assert.equal(await activeAudioPlayers(driver), false, `native audio player is active during ${slug}`);
    if (Date.now() >= deadline) return;
    await delay();
  }
}

async function activeAudioPlayers(driver) {
  const pid = (await driver.exec(['shell', 'pidof', 'by.kudy.app'])).stdout.trim().split(/\s+/)[0];
  assert.match(pid, /^\d+$/, 'the app process is not running');
  const { stdout } = await driver.exec(['shell', 'dumpsys', 'audio']);
  const current = stdout.split('Events log: playback activity')[0];
  assert.ok(current.includes('players:'), 'dumpsys audio has no player section');
  return current.split(/\r?\n/).some((line) => line.includes(`/${pid} state:started`) && line.includes('AudioPlaybackConfiguration'));
}

async function waitForAudioActive(driver, expected) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    if ((await activeAudioPlayers(driver)) === expected) return;
    if (Date.now() >= deadline) throw new Error(`native audio player did not become ${expected ? 'active' : 'stopped'}`);
    await delay();
  }
}

async function waitForRun(driver, slug) {
  const deadline = Date.now() + 45000;
  for (;;) {
    const nodes = parseDump((await driver.dump(`dump-walk-${slug}.xml`)).xml);
    if (findNode(nodes, { testID: 'screen-Run' }) && findNode(nodes, { testID: 'run-map' })) return;
    const accuracyPrompt = findNode(nodes, { text: 'No thanks' });
    if (accuracyPrompt) await driver.tapNode(accuracyPrompt);
    if (Date.now() >= deadline) throw new Error(`timeout waiting for Run map (${slug})`);
    await delay();
  }
}

async function locationListeners(driver) {
  const { stdout } = await driver.exec(['shell', 'dumpsys', 'location']);
  const providerState = stdout.split('  Historical Aggregate Location Provider Data:')[0];
  assert.ok(providerState.includes('Location Providers:'), 'dumpsys location has no provider section');
  return providerState.split(/\r?\n/).filter((line) => line.includes('by.kudy.app'));
}

async function waitForLocationListeners(driver, present) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    const lines = await locationListeners(driver);
    if ((lines.length > 0) === present) return lines;
    if (Date.now() >= deadline) throw new Error(`location listeners ${present ? 'did not start' : 'did not stop'}; ${lines.join(' | ')}`);
    await delay();
  }
}

async function backToExplore(driver) {
  for (let i = 0; i < 4; i += 1) {
    const nodes = parseDump((await driver.dump('dump-walk-back.xml')).xml);
    if (findNode(nodes, { testID: 'screen-Explore' })) return;
    await driver.back();
  }
  await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS });
}

function sessionRow(nodes) {
  const rows = nodes.filter((node) => node.resourceId.startsWith('my-session-') &&
    !node.resourceId.startsWith('my-session-locale-'));
  assert.equal(rows.length, 1, `expected one live/history row, found ${rows.length}`);
  return rows[0].resourceId;
}

export async function runWalkSuite({ driver, url, runCase, coldStart }) {
  let rowId = null;
  await runCase('walk: Explore, Guides and preview show theme, languages and locks', 'walk-preview', driver, async () => {
    await coldStart(driver, url, { timeoutMs: 420000, caseSlug: 'walk-explore' });
    await driver.waitFor({ testID: `guide-card-${FREE}` }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'link-guides' });
    await driver.waitFor({ testID: 'screen-Guides' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: `guide-card-${PAID}` });
    let nodes = await nodesOn(driver, 'screen-Route preview', 'paid-preview');
    requireId(nodes, 'preview-locales');
    requireId(nodes, 'stop-e2e-stop-1');
    requireId(nodes, 'stop-e2e-stop-2');
    requireId(nodes, 'stop-locked-e2e-stop-2');
    await driver.tapSelector({ testID: 'btn-preview-back' });
    await driver.waitFor({ testID: 'screen-Guides' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: `guide-card-${FREE}` });
    await driver.waitFor({ testID: 'preview-theme' }, { timeoutMs: SHORT_MS });
    await driver.waitFor({ testID: 'btn-download' }, { timeoutMs: SHORT_MS });
    nodes = await nodesOn(driver, 'screen-Route preview', 'free-preview');
    requireId(nodes, 'preview-theme');
    requireId(nodes, 'preview-locales');
    for (const stop of [1, 2, 3]) requireId(nodes, `stop-e2e-stop-${stop}`);
    requireId(nodes, 'btn-download');
  });

  await runCase('walk: Download becomes Start only after verified package delivery', 'walk-download', driver, async () => {
    await driver.tapSelector({ testID: 'btn-download' });
    // The origin holds the final synthetic audio object for 12 s. During
    // that outstanding response a usable Start must never appear.
    await assertNoReadyStart(driver, 3000);
    await driver.waitFor({ testID: 'btn-start', enabled: true },
      { timeoutMs: DOWNLOAD_MS, dumpBasename: 'dump-walk-start-ready.xml' });
  });

  await runCase('walk: GPS starts stop 1 and stop 3 out of order; pause and Back preserve the session', 'walk-run', driver, async () => {
    await driver.tapSelector({ testID: 'btn-start', enabled: true });
    await waitForRun(driver, 'run-entry');
    await waitForLocationListeners(driver, true);
    await driver.geoFix(53.9, 27.56);
    await waitForId(driver, 'run-status-e2e-stop-1', (node) => /[Пп]раслух|[Пп]райгран|[Pp]layed/.test(node.text),
      'stop-1-played', DOWNLOAD_MS);
    // Start another story by hand so the session pause is exercised while
    // audio is active, not after the six-second synthetic clip has ended.
    await driver.tapSelector({ testID: 'run-marker-e2e-stop-2' });
    await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-card-play' });
    await waitForAudioActive(driver, true);
    await driver.tapSelector({ testID: 'btn-run-pause' });
    await driver.waitFor({ testID: 'run-paused' }, { timeoutMs: SHORT_MS });
    await waitForAudioActive(driver, false);
    await waitForLocationListeners(driver, false);
    await assertNoPlaying(driver, 1500, 'paused-no-audio');
    await driver.geoFix(53.902, 27.562);
    await assertNoPlaying(driver, 1500, 'paused-at-stop-3');
    await driver.tapSelector({ testID: 'btn-run-resume' });
    await waitForLocationListeners(driver, true);
    // The inspected stop-2 card covers the lower map, including marker 3.
    // Dismiss it before checking the out-of-order marker by testID.
    const resumedNodes = await nodesOn(driver, 'screen-Run', 'resumed');
    if (findNode(resumedNodes, { testID: 'btn-panel-close' })) await driver.tapSelector({ testID: 'btn-panel-close' });
    await driver.waitFor({ testID: 'run-marker-e2e-stop-3' }, { timeoutMs: SHORT_MS });
    await driver.geoFix(53.902, 27.562);
    await waitForId(driver, 'run-status-e2e-stop-3', (node) => /[Пп]раслух|[Пп]райгран|[Pp]layed/.test(node.text),
      'stop-3-played', DOWNLOAD_MS);
    const nodes = await nodesOn(driver, 'screen-Run', 'before-back');
    assert.equal(findNode(nodes, { testID: 'run-ended' }), undefined);
    if (findNode(nodes, { testID: 'btn-panel-close' })) await driver.tapSelector({ testID: 'btn-panel-close' });
    await driver.tapSelector({ testID: 'btn-run-back' });
    await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS });
    await backToExplore(driver);
    await driver.tapSelector({ testID: 'link-kudy' });
    const myNodes = await nodesOn(driver, 'screen-KUDY', 'my-live');
    requireId(myNodes, 'my-live-section');
    rowId = sessionRow(myNodes);
    await driver.launchDeepLink(`kudy:///run/${FREE}`);
    await waitForRun(driver, 'return-to-run');
  });

  await runCase('walk: End lists unheard stories and moves the same session to history', 'walk-end', driver, async () => {
    assert.ok(rowId, 'the live session row was not captured');
    await driver.tapSelector({ testID: 'btn-run-end' });
    await driver.waitFor({ testID: 'end-confirm-dialog' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-end-confirm-accept' });
    const nodes = await nodesOn(driver, 'screen-Run', 'ended');
    requireId(nodes, 'run-ended');
    requireId(nodes, 'run-missed-stories');
    requireId(nodes, 'run-missed-story-story-free-2');
    assert.equal(findNode(nodes, { testID: 'run-missed-story-story-free-1' }), undefined);
    assert.equal(findNode(nodes, { testID: 'run-missed-story-story-free-3' }), undefined);
    await backToExplore(driver);
    await driver.tapSelector({ testID: 'link-kudy' });
    const historyNodes = await nodesOn(driver, 'screen-KUDY', 'my-history');
    requireId(historyNodes, 'my-history-section');
    requireId(historyNodes, rowId);
  });

  await runCase('walk: no fresh position cannot autoplay; manual Play still works', 'walk-manual', driver, async () => {
    await driver.exec(['shell', 'cmd', 'location', 'set-location-enabled', 'false']);
    try {
      await driver.launchDeepLink(`kudy:///route/${FREE}`);
      await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-start', enabled: true });
      await waitForRun(driver, 'no-location-entry');
      await assertNoPlaying(driver, 2500, 'no-fresh-position');
      await driver.tapSelector({ testID: 'run-marker-e2e-stop-2' });
      await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-card-play' });
      await waitForAudioActive(driver, true);
    } finally {
      await driver.exec(['shell', 'cmd', 'location', 'set-location-enabled', 'true']);
    }
  });
}
