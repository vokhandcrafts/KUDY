// G23.04 (#662): Journey 1 and the free portion of Journey 2 on a real
// emulator. All screen assertions read fresh uiautomator dumps through the
// G23.03 driver; polling intervals only pace observations, never stand in
// for a state transition.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { findNode, parseDump } from './driver.mjs';
import { assertMediaServiceState } from './media-service-state.mjs';

const SHORT_MS = 30000;
const DOWNLOAD_MS = 120000;
const POLL_MS = 300;
const FREE = 'e2e-free-guide';
const PAID = 'e2e-paid-guide';
const HELD_FILE = 'bundle/e2e-free-guide/1/be/base/audio/story-free-3.m4a';

const delay = () => new Promise((resolve) => setTimeout(resolve, POLL_MS));

export async function nodesOn(driver, screenId, slug) {
  await driver.waitFor({ testID: screenId }, { timeoutMs: SHORT_MS, dumpBasename: `dump-walk-${slug}-screen.xml` });
  return parseDump((await driver.dump(`dump-walk-${slug}.xml`)).xml);
}

export function requireId(nodes, id) {
  const node = findNode(nodes, { testID: id });
  assert.ok(node, `missing testID ${id}`);
  return node;
}

/**
 * UIAutomator reports only the visible part of a React Native ScrollView.
 * A stop row may appear even when its lock badge is below the fold.
 */
export async function previewNodesWith(driver, testID, slug) {
  for (let attempt = 0; attempt <= 6; attempt += 1) {
    const nodes = parseDump((await driver.dump(`dump-walk-${slug}-${attempt}.xml`)).xml);
    if (findNode(nodes, { testID })) return nodes;
    if (attempt === 6) break;
    const viewport = requireId(nodes, 'scroll-preview');
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(viewport.bounds);
    assert.ok(bounds, `invalid scroll-preview bounds: ${viewport.bounds}`);
    const [, left, top, right, bottom] = bounds.map(Number);
    const x = Math.round((left + right) / 2);
    const height = bottom - top;
    assert.ok(height > 0, 'scroll-preview has no positive height');
    const startY = Math.round(top + height * 0.8);
    const endY = Math.round(top + height * 0.2);
    await driver.exec(['shell', 'input', 'swipe', String(x), String(startY), String(x), String(endY), '350']);
    await delay();
  }
  throw new Error(`missing testID ${testID} after scrolling the preview (last dump: dump-walk-${slug}-6.xml)`);
}

export async function assertNoReadyStart(driver, originLogPath, timeoutMs = DOWNLOAD_MS) {
  const deadline = Date.now() + timeoutMs;
  const started = `E2E stall start: ${HELD_FILE}`;
  const completed = `E2E stall complete: ${HELD_FILE}`;
  for (;;) {
    const nodes = parseDump((await driver.dump('dump-walk-download-held.xml')).xml);
    requireId(nodes, 'screen-Route preview');
    const events = fs.readFileSync(originLogPath, 'utf8').split(/\r?\n/);
    if (!events.includes(completed)) {
      assert.equal(findNode(nodes, { testID: 'btn-start', enabled: true }), undefined,
        'Start became enabled before the held package file was delivered');
    }
    if (events.includes(completed)) {
      assert.ok(events.includes(started), 'the held response completed without a start event');
      return;
    }
    if (Date.now() >= deadline) throw new Error(`the held package file did not complete; origin log: ${originLogPath}`);
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
    if (Date.now() >= deadline) {
      // Separate a lost manual tap from an engine launch without a player.
      let screen = 'UI dump unavailable';
      try {
        const nodes = parseDump((await driver.dump('dump-walk-audio-timeout.xml')).xml);
        const ids = ['screen-Run', 'run-paused', 'run-ended', 'run-preview',
          'btn-card-play', 'btn-bar-playpause', 'run-autoplay-suspended'];
        screen = ids.filter((id) => findNode(nodes, { testID: id })).join(', ') || 'no Run markers visible';
      } catch (error) {
        screen = error instanceof Error ? error.message : String(error);
      }
      throw new Error(`native audio player did not become ${expected ? 'active' : 'stopped'}; UI: ${screen}`);
    }
    await delay();
  }
}

// A nearby-guide hint rendered above the Run card in the failing Android
// artifact: its bounds covered the center of btn-card-play. UIAutomator
// still found the button, but Android delivered the tap to the hint instead.
// The Run surface now hides hints while the card is open; this guard also
// dismisses a hint if it was visible before the card finished rendering.
export async function dismissGuideHintBeforePlay(driver) {
  const deadline = Date.now() + SHORT_MS;
  let dismissed = false;
  for (;;) {
    const nodes = parseDump((await driver.dump('dump-walk-play-uncovered.xml')).xml);
    const hint = findNode(nodes, { testID: 'guide-hint-card' });
    if (!hint) return;
    if (!dismissed) {
      const button = findNode(nodes, { testID: 'btn-hint-dismiss' });
      assert.ok(button, 'nearby guide hint covers Play but has no dismiss button');
      await driver.tapNode(button);
      dismissed = true;
    }
    if (Date.now() >= deadline) throw new Error('nearby guide hint still covers the Play button after dismissal');
    await delay();
  }
}

// The fixture recording is six seconds long. Arm the physical observation
// before the one tap: waiting for adb input to finish can miss a short play.
// Only Android playback counts as success; an engine/UI bar alone never does.
export async function tapPlayAndWaitForAudio(driver) {
  await dismissGuideHintBeforePlay(driver);
  const node = await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
  const observation = waitForAudioActive(driver, true);
  try {
    await driver.tapNode(node);
  } catch (error) {
    void observation.catch(() => {});
    throw error;
  }
  await observation;
}

// Record the Android media surface on the CI emulator rather than running a
// second local AVD. The clip uses only the synthetic E2E guide and is emitted
// in bounded base64 chunks because the existing workflow uploads artifacts
// only on failure. The result doc records the exact tested APK SHA separately.
async function startMediaProofVideo(driver) {
  const remote = '/sdcard/kudy-apr08c-media.mp4';
  await driver.exec(['shell', 'rm', '-f', remote]);
  const child = spawn(driver.adbPath, [
    '-s', driver.serial, 'shell', 'screenrecord', '--size', '480x1040',
    '--bit-rate', '400000', '--time-limit', '45', remote,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errorOutput = '';
  child.stderr.on('data', (chunk) => { errorOutput += chunk.toString('utf8'); });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`screenrecord exited ${code}: ${errorOutput.trim()}`)));
  });
  void completed.catch(() => {});
  await delay();
  return async () => {
    await completed;
    const local = driver.artifactPath('apr08c-media-playback.mp4');
    await driver.exec(['pull', remote, local], { timeoutMs: 30000 });
    const bytes = fs.readFileSync(local);
    assert.ok(bytes.length > 10000 && bytes.subarray(0, 32).includes(Buffer.from('ftyp')),
      `Android video is absent or invalid (${bytes.length} bytes)`);
    assert.ok(bytes.length < 3000000, `Android video exceeds the bounded log transfer (${bytes.length} bytes)`);
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(`APR08C_VIDEO sha256=${sha} bytes=${bytes.length}`);
    if (process.env.CI) {
      const encoded = bytes.toString('base64');
      for (let offset = 0; offset < encoded.length; offset += 4096) {
        console.log(`APR08C_VIDEO_CHUNK ${offset / 4096} ${encoded.slice(offset, offset + 4096)}`);
      }
    }
  };
}

async function recordMediaServiceState(driver, label) {
  const services = (await driver.exec(['shell', 'dumpsys', 'activity', 'services'])).stdout;
  const sessions = (await driver.exec(['shell', 'dumpsys', 'media_session'])).stdout;
  const notifications = (await driver.exec(['shell', 'dumpsys', 'notification'])).stdout;
  fs.writeFileSync(driver.artifactPath(`apr08c-${label}-services.txt`), services);
  fs.writeFileSync(driver.artifactPath(`apr08c-${label}-sessions.txt`), sessions);
  fs.writeFileSync(driver.artifactPath(`apr08c-${label}-notifications.txt`), notifications);
  const { excerpt: serviceExcerpt, foreground } = assertMediaServiceState(services, label);
  const notificationLines = notifications.split(/\r?\n/).filter((line) => /by\.kudy\.app/.test(line)).slice(0, 8);
  console.log(`APR08C_${label}_SERVICE ${serviceExcerpt}`);
  console.log(`APR08C_${label}_FOREGROUND ${foreground}`);
  console.log(`APR08C_${label}_NOTIFICATIONS ${notificationLines.join(' | ') || '(absent)'}`);
  console.log(`APR08C_${label}_MEDIA_SESSION ${sessions.includes('by.kudy.app') ? 'package present' : 'package absent'}`);
  if (label === 'paused') {
    assert.ok(sessions.includes('by.kudy.app'), 'Android media session is absent during a paused audio session');
    assert.ok(notificationLines.some((line) => line.includes('FOREGROUND_SERVICE')),
      'Android foreground media notification is absent during a paused audio session');
  } else if (label === 'stopped') {
    assert.ok(!notificationLines.some((line) => line.includes('NotificationRecord') && line.includes('expo_audio_channel')),
      'Android media notification remains after Stop');
  }
}

export async function waitForRun(driver, slug, allowLocationSettings = true) {
  const deadline = Date.now() + 45000;
  for (;;) {
    const nodes = parseDump((await driver.dump(`dump-walk-${slug}.xml`)).xml);
    if (findNode(nodes, { testID: 'screen-Run' }) && findNode(nodes, { testID: 'run-map' })) return;
    const accuracyPrompt = findNode(nodes, { text: 'No thanks' });
    if (accuracyPrompt) {
      // Declining rejects Expo's pending watch with LocationSettingsUnsatisfiedException.
      const accept = allowLocationSettings
        ? findNode(nodes, { testID: 'android:id/button1' }) : accuracyPrompt;
      assert.ok(accept, 'location accuracy prompt has no positive button');
      await driver.tapNode(accept);
    }
    if (Date.now() >= deadline) throw new Error(`timeout waiting for Run map (${slug})`);
    await delay();
  }
}

export async function locationListeners(driver) {
  const { stdout } = await driver.exec(['shell', 'dumpsys', 'location']);
  const providerState = stdout.split('  Historical Aggregate Location Provider Data:')[0];
  assert.ok(providerState.includes('Location Providers:'), 'dumpsys location has no provider section');
  const direct = providerState.split(/\r?\n/).filter((line) => line.includes('by.kudy.app'));
  if (direct.length > 0) return direct;
  // Play Services owns the OS listener; AppOps attributes its active access to our app.
  const access = await driver.exec(['shell', 'cmd', 'appops', 'get', 'by.kudy.app', 'MONITOR_LOCATION']);
  return access.stdout.split(/\r?\n/).filter((line) => /\(running\)/.test(line));
}

export async function waitForLocationListeners(driver, present) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    const lines = await locationListeners(driver);
    if ((lines.length > 0) === present) return lines;
    if (Date.now() >= deadline) throw new Error(`location listeners ${present ? 'did not start' : 'did not stop'}; ${lines.join(' | ')}`);
    await delay();
  }
}

export async function backToExplore(driver) {
  for (let i = 0; i < 4; i += 1) {
    const nodes = parseDump((await driver.dump('dump-walk-back.xml')).xml);
    if (findNode(nodes, { testID: 'screen-Explore' })) return;
    await driver.back();
  }
  await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS });
}

export function sessionRow(nodes) {
  const rows = nodes.filter((node) => node.resourceId.startsWith('my-session-') &&
    !node.resourceId.startsWith('my-session-locale-'));
  assert.equal(rows.length, 1, `expected one live/history row, found ${rows.length}`);
  return rows[0].resourceId;
}

// MapLibre draws marker children into its Android surface. The points list
// exposes the same stop-card action to accessibility and uiautomator.
async function mapPointPath(driver, stopId) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    const nodes = parseDump((await driver.dump('dump-map-point.xml')).xml);
    if (findNode(nodes, { testID: 'run-map-points' })) return 'native';
    if (findNode(nodes, { testID: `run-marker-${stopId}` })) return 'schematic';
    if (Date.now() >= deadline) throw new Error(`map point ${stopId} unavailable in native and schematic views`);
    await delay();
  }
}

export async function tapMapPoint(driver, stopId) {
  const path = await mapPointPath(driver, stopId);
  console.log(`walk map point ${stopId}: ${path}`);
  if (path === 'native') await driver.tapSelector({ testID: 'run-map-points' });
  await driver.tapSelector({ testID: path === 'native' ? `run-point-${stopId}` : `run-marker-${stopId}` });
}

export async function visiblePointStatus(driver, stopId, predicate, slug, timeoutMs = SHORT_MS) {
  const deadline = Date.now() + timeoutMs;
  let pointsListOpened = false;
  let lastPath = '';
  for (;;) {
    const dump = await driver.dump(`dump-walk-${slug}.xml`);
    lastPath = dump.localPath;
    const nodes = parseDump(dump.xml);
    const pointsButton = findNode(nodes, { testID: 'run-map-points' });
    const nativeStatus = findNode(nodes, { testID: `run-point-status-${stopId}` });
    const schematicStatus = findNode(nodes, { testID: `run-status-${stopId}` });
    const status = nativeStatus ?? schematicStatus;
    if (status && predicate(status)) {
      if (pointsListOpened && pointsButton) await driver.tapSelector({ testID: 'run-map-points' });
      return status;
    }
    // The native map can finish loading after the first accessibility dump.
    // Re-evaluate the rendered path on every poll instead of latching onto the
    // schematic marker IDs from an earlier screen.
    if (pointsButton && !pointsListOpened) {
      await driver.tapSelector({ testID: 'run-map-points' });
      pointsListOpened = true;
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`timeout waiting for stop ${stopId} status (${slug}); last dump: ${lastPath}`);
    await delay();
  }
}

export async function startWalkAtLocation(driver, latitude, longitude) {
  // Seed before the watcher starts so a fresh AVD cannot supply a distant
  // default fix that makes the next fix look like an impossible GPS jump.
  await driver.geoFix(latitude, longitude);
  await driver.tapSelector({ testID: 'btn-start', enabled: true });
}

export async function waitForManualStart(driver) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    const nodes = parseDump((await driver.dump('dump-manual-start.xml')).xml);
    if (findNode(nodes, { text: 'No location access' })) {
      const close = findNode(nodes, { testID: 'android:id/button2', text: 'Close' });
      assert.ok(close, 'location-disabled notice has no Close button');
      await driver.tapNode(close);
    } else if (findNode(nodes, { testID: 'btn-start', enabled: true })) return;
    if (Date.now() >= deadline) throw new Error('timeout waiting for manual Start with location disabled');
    await delay();
  }
}

export async function runWalkSuite({ driver, url, runCase, coldStart, originLogPath }) {
  let rowId = null;
  await runCase('walk: Explore, Guides and preview show theme, languages and locks', 'walk-preview', driver, async () => {
    await coldStart(driver, url, { timeoutMs: 420000, caseSlug: 'walk-explore' });
    await driver.waitFor({ testID: `guide-card-${FREE}` }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'link-guides' });
    await driver.waitFor({ testID: 'screen-Guides' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: `guide-card-${PAID}` });
    let nodes = await nodesOn(driver, 'screen-Route preview', 'paid-preview');
    assert.equal(requireId(nodes, 'preview-locales').text, 'Тэкст: be, en; аўдыё: be, en');
    requireId(nodes, 'stop-e2e-stop-1');
    requireId(nodes, 'stop-locked-e2e-stop-1');
    // The upsell pushes stop 2's lock below the viewport.
    nodes = await previewNodesWith(driver, 'stop-locked-e2e-stop-2', 'paid-lock');
    requireId(nodes, 'stop-e2e-stop-2');
    await driver.tapSelector({ testID: 'btn-preview-back' });
    await driver.waitFor({ testID: 'screen-Guides' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: `guide-card-${FREE}` });
    await driver.waitFor({ testID: 'preview-theme' }, { timeoutMs: SHORT_MS });
    nodes = await nodesOn(driver, 'screen-Route preview', 'free-preview');
    assert.equal(requireId(nodes, 'preview-theme').text, 'E2E-прагулка');
    assert.equal(requireId(nodes, 'preview-locales').text, 'Тэкст: be, en; аўдыё: be, en');
    for (const stop of [1, 2, 3]) {
      nodes = await previewNodesWith(driver, `stop-e2e-stop-${stop}`, `free-stop-${stop}`);
      assert.equal(findNode(nodes, { testID: `stop-locked-e2e-stop-${stop}` }), undefined);
    }
    nodes = await previewNodesWith(driver, 'btn-download', 'free-download');
    requireId(nodes, 'btn-download');
  });

  await runCase('walk: Download becomes Start only after verified package delivery', 'walk-download', driver, async () => {
    await driver.tapSelector({ testID: 'btn-download' });
    // Observe the full held response, including its completion event.
    await assertNoReadyStart(driver, originLogPath);
    await driver.waitFor({ testID: 'btn-start', enabled: true },
      { timeoutMs: DOWNLOAD_MS, dumpBasename: 'dump-walk-start-ready.xml' });
  });

  await runCase('walk: GPS starts stop 1 and stop 3 out of order; pause and Back preserve the session', 'walk-run', driver, async () => {
    await startWalkAtLocation(driver, 53.9, 27.56);
    await waitForRun(driver, 'run-entry');
    await waitForLocationListeners(driver, true);
    await driver.geoFix(53.9, 27.56);
    await visiblePointStatus(driver, 'e2e-stop-1', (node) => /[Пп]раслух|[Пп]райгран|[Pp]layed/.test(node.text),
      'stop-1-played', DOWNLOAD_MS);
    // Replay the already heard stop 1 so stop 2 remains unheard for End.
    // Pause still exercises active audio rather than an idle session.
    await tapMapPoint(driver, 'e2e-stop-1');
    await tapPlayAndWaitForAudio(driver);
    await driver.tapSelector({ testID: 'btn-run-pause' });
    await driver.waitFor({ testID: 'run-paused' }, { timeoutMs: SHORT_MS });
    await waitForAudioActive(driver, false);
    await waitForLocationListeners(driver, false);
    await assertNoPlaying(driver, 1500, 'paused-no-audio');
    await driver.geoFix(53.902, 27.562);
    await assertNoPlaying(driver, 1500, 'paused-at-stop-3');
    await driver.tapSelector({ testID: 'btn-run-resume' });
    await waitForLocationListeners(driver, true);
    // The inspected stop-1 card covers the lower map, including marker 3.
    // Dismiss it before checking the out-of-order marker by testID.
    const resumedNodes = await nodesOn(driver, 'screen-Run', 'resumed');
    if (findNode(resumedNodes, { testID: 'btn-panel-close' })) await driver.tapSelector({ testID: 'btn-panel-close' });
    await mapPointPath(driver, 'e2e-stop-3');
    await driver.geoFix(53.902, 27.562);
    await visiblePointStatus(driver, 'e2e-stop-3', (node) => /[Пп]раслух|[Пп]райгран|[Pp]layed/.test(node.text),
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
    requireId(myNodes, `my-live-state-${rowId.slice('my-session-'.length)}`);
    assert.equal(findNode(myNodes, { testID: `my-history-state-${rowId.slice('my-session-'.length)}` }), undefined);
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
    requireId(historyNodes, `my-history-state-${rowId.slice('my-session-'.length)}`);
    assert.equal(findNode(historyNodes, { testID: `my-live-state-${rowId.slice('my-session-'.length)}` }), undefined);
  });

  await runCase('walk: no fresh position cannot autoplay; manual Play still works', 'walk-manual', driver, async () => {
    await driver.exec(['shell', 'cmd', 'location', 'set-location-enabled', 'false']);
    // The disposable CI emulator needs a real keyguard for lock-screen proof.
    const lockPin = '3728';
    let pinSet = false;
    try {
      await driver.exec(['shell', 'locksettings', 'set-pin', lockPin]);
      pinSet = true;
      await driver.launchDeepLink(`kudy:///route/${FREE}`);
      await waitForManualStart(driver);
      await driver.tapSelector({ testID: 'btn-start', enabled: true });
      await waitForRun(driver, 'no-location-entry', false);
      await assertNoPlaying(driver, 2500, 'no-fresh-position');
      await tapMapPoint(driver, 'e2e-stop-2');
      const finishVideo = await startMediaProofVideo(driver);
      try {
        await tapPlayAndWaitForAudio(driver);
        // The synthetic track lasts six seconds. A fresh UIAutomator dump can
        // outlast it, so pause through the Android media session immediately.
        await driver.exec(['shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE']);
        await waitForAudioActive(driver, false);
        await recordMediaServiceState(driver, 'paused');
        await driver.exec(['shell', 'cmd', 'statusbar', 'expand-notifications']);
        await driver.exec(['shell', 'input', 'swipe', '540', '30', '540', '1700', '450']);
        await delay();
        await driver.screenshot('apr08c-notification.png');
        await driver.exec(['shell', 'input', 'keyevent', '26']);
        await delay();
        await driver.exec(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await driver.screenshot('apr08c-lock-screen.png');
      } finally {
        await finishVideo();
      }
      await driver.exec(['shell', 'input', 'swipe', '540', '1800', '540', '350', '450']);
      await driver.exec(['shell', 'input', 'text', lockPin]);
      await driver.exec(['shell', 'input', 'keyevent', 'KEYCODE_ENTER']);
      await driver.exec(['shell', 'cmd', 'statusbar', 'collapse']);
      await driver.tapSelector({ testID: 'btn-run-pause' });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await recordMediaServiceState(driver, 'stopped');
    } finally {
      try {
        if (pinSet) await driver.exec(['shell', 'locksettings', 'clear', '--old', lockPin]);
      } finally {
        await driver.exec(['shell', 'cmd', 'location', 'set-location-enabled', 'true']);
      }
    }
  });

  await runCase('walk: incoming call interrupts audio without automatic resume', 'walk-call', driver, async () => {
    await driver.waitFor({ testID: 'run-paused' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-run-resume' });
    await tapMapPoint(driver, 'e2e-stop-2');
    await tapPlayAndWaitForAudio(driver);
    const number = '5550100'; // Synthetic number used only by the CI emulator.
    let callStarted = false;
    try {
      await driver.exec(['emu', 'gsm', 'call', number]);
      callStarted = true;
      await delay();
      await driver.exec(['emu', 'gsm', 'accept', number]);
      await waitForAudioActive(driver, false);
      const sessions = (await driver.exec(['shell', 'dumpsys', 'media_session'])).stdout;
      const audio = (await driver.exec(['shell', 'dumpsys', 'audio'])).stdout;
      fs.writeFileSync(driver.artifactPath('apr08c-call-sessions.txt'), sessions);
      fs.writeFileSync(driver.artifactPath('apr08c-call-audio.txt'), audio);
      const state = /package=by\.kudy\.app[\s\S]*?state=PlaybackState \{state=([A-Z]+)\(\d+\), position=(\d+)/.exec(sessions);
      console.log(`APR08C_CALL_MEDIA_SESSION ${state ? `${state[1]} position=${state[2]}` : '(absent)'}`);
      assert.ok(state, 'KUDY media session is absent during the simulated call');
      assert.equal(state[1], 'PAUSED', 'the simulated call did not pause KUDY audio');
      assert.ok(Number(state[2]) < 6000, 'audio reached its natural six-second end before call interruption was observed');
    } finally {
      if (callStarted) await driver.exec(['emu', 'gsm', 'cancel', number]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(await activeAudioPlayers(driver), false, 'audio resumed without user action after the call ended');
  });

  await runCase('walk: replacing track A with B preserves B media session', 'walk-replace', driver, async () => {
    await tapMapPoint(driver, 'e2e-stop-1');
    await tapPlayAndWaitForAudio(driver);
    await tapMapPoint(driver, 'e2e-stop-2');
    await tapPlayAndWaitForAudio(driver);
    // Hold B in Pause for longer than the old idle-stop grace period.
    // A late stopSelf from A must not destroy B's MediaSessionService.
    await driver.exec(['shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE']);
    await waitForAudioActive(driver, false);
    await recordMediaServiceState(driver, 'paused');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await recordMediaServiceState(driver, 'paused');
  });

  await runCase('walk: new playback remains active after an idle-stop boundary', 'walk-restart', driver, async () => {
    await driver.tapSelector({ testID: 'btn-run-pause' });
    await driver.waitFor({ testID: 'run-paused' }, { timeoutMs: SHORT_MS });
    await waitForAudioActive(driver, false);
    // Outlast the old 1000 ms stopSelf callback before activating a new source.
    // Device scheduling determines whether onDestroy already completed.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await driver.tapSelector({ testID: 'btn-run-resume' });
    await tapMapPoint(driver, 'e2e-stop-1');
    await tapPlayAndWaitForAudio(driver);
    await driver.exec(['shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE']);
    await waitForAudioActive(driver, false);
    await recordMediaServiceState(driver, 'paused');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await recordMediaServiceState(driver, 'paused');
  });

  await runCase('walk: rapid Play then Stop cannot resurrect the media service', 'walk-rapid-stop', driver, async () => {
    // The restart case left stop 1 selected. Switch stories rather than
    // toggling the same card closed.
    await tapMapPoint(driver, 'e2e-stop-2');
    await dismissGuideHintBeforePlay(driver);
    // Capture both node coordinates before Play; no UIAutomator dump may run
    // between taps, since the six-second fixture would mask the startup race.
    const play = await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
    const stop = await driver.waitFor({ testID: 'btn-run-pause' }, { timeoutMs: SHORT_MS });
    await driver.tapNode(play);
    await driver.tapNode(stop);
    await waitForAudioActive(driver, false);
    // Check twice: a late Android onCreate must not resurrect the service.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await recordMediaServiceState(driver, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await recordMediaServiceState(driver, 'stopped');
  });
}
