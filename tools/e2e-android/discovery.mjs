// G23.06: the Discovery and Nearby journey runs in the installed app over
// the G23.01 synthetic origin. Every assertion reads a fresh Android UI
// hierarchy; the runner supplies the same cold-start and failure artifacts
// as the other Android suites.
import assert from 'node:assert/strict';

import { findNode, parseDump } from './driver.mjs';
import { startWalkAtLocation, tapMapPoint, visiblePointStatus, waitForRun } from './walk.mjs';

const SHORT_MS = 30_000;
const DOWNLOAD_MS = 120_000;
const FREE = 'e2e-free-guide';
const PAID = 'e2e-paid-guide';
const OTHER = 'e2e-nearby-guide';
const MOMENT = 'moment-e2e-place-1';
const delay = () => new Promise((resolve) => setTimeout(resolve, 1_000));

async function nodesOn(driver, slug) {
  return parseDump((await driver.dump(`dump-discovery-${slug}.xml`)).xml);
}

function requireId(nodes, id) {
  const node = findNode(nodes, { testID: id });
  assert.ok(node, `missing testID ${id}`);
  return node;
}

async function waitForText(driver, id, expected, slug, timeoutMs = SHORT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = findNode(await nodesOn(driver, slug), { testID: id });
    if (node && expected.test(node.text)) return node;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${id} to match ${expected}`);
    await delay();
  }
}

async function waitForNearbyGuideHint(driver) {
  const deadline = Date.now() + 75_000;
  for (;;) {
    await driver.geoFix(53.903, 27.563);
    const nodes = await nodesOn(driver, 'hint');
    if (findNode(nodes, { testID: `guide-hint-row-${OTHER}` })) return;
    if (Date.now() >= deadline) throw new Error('nearby-guide hint did not appear near its fixture stop');
    await delay();
  }
}

async function waitForGone(driver, id, slug) {
  const deadline = Date.now() + SHORT_MS;
  for (;;) {
    if (!findNode(await nodesOn(driver, slug), { testID: id })) return;
    if (Date.now() >= deadline) throw new Error(`${id} remained visible`);
    await delay();
  }
}

async function scrollTo(driver, id, slug) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const node = findNode(await nodesOn(driver, slug), { testID: id });
    if (node) return node;
    await driver.exec(['shell', 'input', 'swipe', '540', '1780', '540', '560', '450']);
  }
  throw new Error(`${id} did not become visible after scrolling`);
}

async function waitForFeedbackRetry(driver) {
  const deadline = Date.now() + 45_000;
  for (;;) {
    await driver.background();
    await driver.foregroundApp('by.kudy.app');
    await driver.launchDeepLink(`kudy:///run/${FREE}`);
    await driver.launchDeepLink(`kudy:///feedback?kind=guide&id=${FREE}&version=1&locale=be`);
    const delivery = findNode(await nodesOn(driver, 'feedback-retry'), { testID: 'feedback-delivery' });
    if (delivery && /Адпраўлена|Sent/i.test(delivery.text)) return;
    if (Date.now() >= deadline) throw new Error('queued feedback was not sent after the origin recovered');
    await delay();
  }
}

export async function runDiscoverySuite({ driver, url, runCase, coldStart, stopOrigin, startOrigin }) {
  await runCase('discovery: city offers, filters and previews', 'discovery-offers', driver, async () => {
    await coldStart(driver, url, { timeoutMs: 420_000, caseSlug: 'discovery-explore' });
    await driver.tapSelector({ testID: 'link-discovery' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    let nodes = await nodesOn(driver, 'offers');
    requireId(nodes, 'offer-card-offer-guide-e2e-free');
    assert.match(requireId(nodes, 'offer-card-offer-guide-e2e-paid').contentDesc, /Платна|Paid/i);
    requireId(nodes, 'offer-card-offer-place-e2e-1');
    requireId(nodes, 'offer-card-offer-collection-e2e-day');
    requireId(nodes, 'time-60');
    requireId(nodes, 'theme-theme-e2e-day');
    await driver.tapSelector({ testID: 'time-60' });
    nodes = await nodesOn(driver, 'time');
    requireId(nodes, 'offer-card-offer-guide-e2e-free');
    await driver.tapSelector({ testID: 'theme-theme-e2e-day' });
    nodes = await nodesOn(driver, 'empty');
    requireId(nodes, 'discovery-empty');
    requireId(nodes, 'discovery-alternatives');
    await driver.tapSelector({ testID: 'theme-theme-e2e-day' });
    await driver.tapSelector({ testID: 'time-none' });
    await driver.tapSelector({ testID: 'offer-card-offer-collection-e2e-day' });
    await driver.waitFor({ testID: 'screen-Collection' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-collection-back' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'offer-card-offer-place-e2e-1' });
    await driver.waitFor({ testID: 'screen-Place detail' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-place-back' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'offer-card-offer-guide-e2e-free' });
    await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-preview-back' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'offer-card-offer-guide-e2e-paid' });
    await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS });
    await driver.waitFor({ testID: 'preview-free-stop-count' }, { timeoutMs: SHORT_MS });
    nodes = await nodesOn(driver, 'paid-preview');
    requireId(nodes, 'preview-free-stop-count');
    assert.equal(findNode(nodes, { testID: 'screen-Run' }), undefined,
      'opening a paid offer started a walk');
    await driver.tapSelector({ testID: 'btn-preview-back' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-discovery-back' });
    await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS });
  });

  await runCase('discovery: published teaser is silent until explicit Play', 'discovery-moment', driver, async () => {
    await driver.tapSelector({ testID: 'link-discovery' });
    await driver.waitFor({ testID: 'offer-card-offer-guide-e2e-free' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'offer-card-offer-guide-e2e-free' });
    await scrollTo(driver, 'btn-download', 'free-download');
    await driver.tapSelector({ testID: 'btn-download' });
    await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: DOWNLOAD_MS });
    await driver.tapSelector({ testID: 'btn-preview-back' });
    await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'btn-discovery-back' });
    await driver.waitFor({ testID: 'screen-Explore' }, { timeoutMs: SHORT_MS });
    await driver.geoFix(53.9, 27.56);
    await driver.tapSelector({ testID: 'link-nearby' });
    await driver.waitFor({ testID: 'screen-Map' }, { timeoutMs: SHORT_MS });
    await driver.waitFor({ testID: 'nearby-card-offer-place-e2e-1' }, { timeoutMs: SHORT_MS });
    await driver.tapSelector({ testID: 'nearby-card-offer-place-e2e-1' });
    await driver.waitFor({ testID: 'screen-Place detail' }, { timeoutMs: SHORT_MS });
    const nodes = await nodesOn(driver, 'moment-before-play');
    requireId(nodes, `place-moment-${MOMENT}`);
    assert.equal(findNode(nodes, { testID: `place-moment-live-${MOMENT}` }), undefined,
      'the Moment began playing without an explicit tap');
    await driver.tapSelector({ testID: `place-moment-play-${MOMENT}` });
    await driver.waitFor({ testID: `place-moment-live-${MOMENT}` }, { timeoutMs: SHORT_MS });
  });

  await runCase('discovery: active walk Moment suspends guide automation; nearby guide opens only a preview',
    'discovery-active', driver, async () => {
      // The second free route's installed base supplies points for the hint.
      await driver.launchDeepLink(`kudy:///route/${OTHER}`);
      await scrollTo(driver, 'btn-download', 'nearby-download');
      await driver.tapSelector({ testID: 'btn-download' });
      await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: DOWNLOAD_MS });
      await driver.launchDeepLink(`kudy:///route/${FREE}`);
      await driver.waitFor({ testID: 'btn-start', enabled: true }, { timeoutMs: SHORT_MS });
      await startWalkAtLocation(driver, 53.9, 27.56);
      await waitForRun(driver, 'discovery-active-entry');
      await driver.launchDeepLink('kudy:///place/e2e-place-1');
      await driver.waitFor({ testID: `place-moment-play-${MOMENT}` }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: `place-moment-play-${MOMENT}` });
      await driver.waitFor({ testID: `place-moment-live-${MOMENT}` }, { timeoutMs: SHORT_MS });
      await driver.launchDeepLink(`kudy:///run/${FREE}`);
      await waitForRun(driver, 'discovery-return-to-run');
      await driver.waitFor({ testID: 'run-autoplay-suspended' }, { timeoutMs: SHORT_MS });
      await driver.waitFor({ testID: 'btn-run-continue-guide' }, { timeoutMs: SHORT_MS });
      await driver.geoFix(53.901, 27.561);
      const suspended = await nodesOn(driver, 'suspended-at-next-stop');
      requireId(suspended, 'run-autoplay-suspended');
      assert.equal(findNode(suspended, { testID: 'btn-bar-playpause' }), undefined,
        'the guide restarted while Moment had suspended autoplay');
      await driver.tapSelector({ testID: 'btn-run-continue-guide' });
      await driver.waitFor({ testID: 'run-map' }, { timeoutMs: SHORT_MS });
      assert.equal(findNode(await nodesOn(driver, 'guide-continued'), { testID: 'run-autoplay-suspended' }), undefined);
      await waitForNearbyGuideHint(driver);
      await driver.tapSelector({ testID: `guide-hint-row-${OTHER}` });
      await driver.waitFor({ testID: 'screen-Route preview' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-preview-back' });
      await waitForRun(driver, 'hint-return');
      assert.equal(findNode(await nodesOn(driver, 'hint-return-live'), { testID: 'run-ended' }), undefined,
        'preview navigation ended the active session');
      // End invites feedback only after a guide story was heard. A Moment
      // takeover alone does not credit the guide's heard list.
      await tapMapPoint(driver, 'e2e-stop-1');
      await driver.waitFor({ testID: 'btn-card-play' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-card-play' });
      await visiblePointStatus(driver, 'e2e-stop-1', (node) => /[Пп]раслух|[Пп]райгран|[Pp]layed/.test(node.text),
        'discovery-story-heard', DOWNLOAD_MS);
    });

  await runCase('discovery: feedback queues offline, retries, edits and deletes without a public list',
    'discovery-feedback', driver, async () => {
      await driver.tapSelector({ testID: 'btn-run-end' });
      await driver.waitFor({ testID: 'end-confirm-dialog' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-end-confirm-accept' });
      await driver.waitFor({ testID: 'run-feedback-invite' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'btn-run-invite-rate' });
      await driver.waitFor({ testID: 'screen-Feedback' }, { timeoutMs: SHORT_MS });
      await driver.tapSelector({ testID: 'feedback-star-4' });
      await stopOrigin();
      await driver.tapSelector({ testID: 'btn-feedback-send' });
      await waitForText(driver, 'feedback-delivery', /пры сетцы|pending/i, 'feedback-queued', 45_000);
      await startOrigin();
      await waitForFeedbackRetry(driver);
      await driver.tapSelector({ testID: 'feedback-star-5' });
      await driver.tapSelector({ testID: 'btn-feedback-send' });
      await waitForText(driver, 'feedback-delivery', /Адпраўлена|Sent/i, 'feedback-edited');
      await driver.waitFor({ testID: 'btn-feedback-delete', enabled: true }, { timeoutMs: SHORT_MS });
      // The long disclosure can leave Delete against the bottom edge while
      // the edited delivery line settles. Bring it into the scroll viewport
      // before tapping; an offscreen accessibility node is still findable.
      await driver.exec(['shell', 'input', 'swipe', '540', '1780', '540', '700', '450']);
      let deleteStarted = false;
      for (let attempt = 0; attempt < 2 && !deleteStarted; attempt += 1) {
        await driver.tapSelector({ testID: 'btn-feedback-delete', enabled: true });
        for (let poll = 0; poll < 4; poll += 1) {
          const delivery = findNode(await nodesOn(driver, 'delete-started'), { testID: 'feedback-delivery' });
          if (!delivery || !/Адпраўлена|Sent/i.test(delivery.text)) {
            deleteStarted = true;
            break;
          }
          await delay();
        }
      }
      assert.ok(deleteStarted, 'Delete tap left the sent feedback unchanged');
      await waitForGone(driver, 'feedback-delivery', 'feedback-deleted');
      await driver.tapSelector({ testID: 'btn-feedback-back' });
      await driver.launchDeepLink('kudy:///discovery');
      await driver.waitFor({ testID: 'screen-Discovery' }, { timeoutMs: SHORT_MS });
      assert.equal(findNode(await nodesOn(driver, 'no-public-score'), { testID: 'public-rating' }), undefined);
    });
}
