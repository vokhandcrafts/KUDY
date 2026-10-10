// G23.02 acceptance criterion 1 (issue #660): the hand-checked purchase
// journey as a committed case over the real static export — catalog → guide
// page → free stop (audio element present and playable, duration > 0) →
// locked stop (no audio, no full transcript, calm offer visible). The web
// E2E city is the paid-guide package alone (run-e2e.mjs): its base stop is
// the free audio stop, its extended stop the locked one. Every asserted
// string, URL or preview is read from its single source — the served
// publication tree, the i18n modules or the app-links config — never
// paraphrased (implementation-rules 2). The harness lockdown applies to
// every step, so criterion 7 holds here too: any non-localhost request or
// page exception fails the case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withE2ePage, assertCleanJourney, webOutRoot, servedContent, discoveryIndex } from '../test-browser/e2e-harness.mjs';
import { evaluateValue } from '../test-browser/cdp-browser.mjs';
import { be } from '../lib/i18n/be.ts';
import { appLinks } from '../lib/app-links.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

function guideOffer() {
  const index = discoveryIndex();
  const offer = index.offers.find((entry) => entry.ref.kind === 'guide' && entry.ref.route_id === 'e2e-paid-guide');
  assert.ok(offer, 'the served discovery must offer the e2e-paid-guide route');
  return offer;
}

// The published preview facts of the locked stop, per locale.
function publishedPreview(locale) {
  const previews = servedContent('bundle', 'e2e-paid-guide', '1', locale, 'base', 'previews.json');
  const preview = previews.find((entry) => entry.stop_id === 'e2e-stop-2');
  assert.ok(preview, `published previews must carry the locked stop e2e-stop-2 (${locale})`);
  return { name: preview.name[locale], announce: preview.announce[locale] };
}

// The extended-layer transcript the public surface must never leak, read
// from the fixture source — the publication target carries no extended layer
// at all, which the tree walk at the end of the locked-stop step proves.
function extendedLeakCanary() {
  const file = path.join(REPO_ROOT, 'fixtures', 'e2e', 'paid-guide', 'be', 'extended', 'stops.json');
  const stories = JSON.parse(fs.readFileSync(file, 'utf8'));
  const story = stories.find((entry) => entry.story_id === 'story-paid-2');
  assert.ok(story, 'fixture source must carry the locked story story-paid-2');
  return story.transcript;
}

// The bundle audio URL scheme: the documented public layout (the CONTENT_ASSET_BASE
// mapping in web/lib/content/site.ts) over the served tree's own facts.
const audioSrc = (routeId, locale, storyId) =>
  `/content/bundle/${routeId}/1/${locale}/base/audio/${storyId}.m4a`;

test('G23.02: catalog → guide → free stop with playable audio → locked stop with calm offer only', async (t) => {
  await withE2ePage(t, async ({ browser, page, goto, pageErrors, blockedRequests }) => {
    const offer = guideOffer();

    // Catalog (be): the synthetic guide is a real card — no placeholders.
    await goto('/');
    const catalog = await evaluateValue(
      browser,
      page,
      `(() => {
        const links = Array.from(document.querySelectorAll('a[href^="/guides/"]'));
        return {
          title: document.querySelector('h1')?.textContent ?? null,
          guideLinks: links.map((a) => ({ href: a.getAttribute('href'), text: a.textContent })),
        };
      })()`,
    );
    assert.equal(catalog.title, be.catalogTitle);
    assert.ok(
      catalog.guideLinks.some((link) => link.href === '/guides/e2e-paid-guide' && link.text === offer.localized.title.be),
      `catalog must offer the guide card, saw: ${JSON.stringify(catalog.guideLinks)}`,
    );

    // Guide page: title, summary and the two stop rows — the free stop and
    // the locked row (padlock + name) in position order.
    await goto('/guides/e2e-paid-guide');
    const guide = await evaluateValue(
      browser,
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('main li'));
        return {
          heading: document.querySelector('h1')?.textContent ?? null,
          summary: document.querySelector('main li p, main > p')?.textContent ?? null,
          stopLinks: rows.map((row) => ({
            href: row.querySelector('a')?.getAttribute('href') ?? null,
            lockedLabel: row.querySelector('[aria-label]')?.getAttribute('aria-label') ?? null,
            lockedName: row.querySelector('strong')?.textContent ?? null,
          })),
        };
      })()`,
    );
    const preview = publishedPreview('be');
    // The base stop's display name comes from its place projection (site.ts
    // siteStopRows) — the served projection is the fact to compare against.
    const freePlace = servedContent('places', 'e2e-place-4', 'public.json');
    assert.equal(guide.heading, offer.localized.title.be);
    assert.equal(guide.summary, offer.localized.summary.be);
    assert.deepEqual(guide.stopLinks, [
      { href: '/guides/e2e-paid-guide/stops/e2e-stop-1', lockedLabel: null, lockedName: freePlace.name.be },
      { href: '/guides/e2e-paid-guide/stops/e2e-stop-2', lockedLabel: be.lockedLabel, lockedName: preview.name },
    ]);

    // Free stop: transcript plus a real audio track per bundle locale with
    // audio — be first (sorted), then en. The be track must actually load
    // (duration > 0) and play like a visitor's tap would.
    await goto('/guides/e2e-paid-guide/stops/e2e-stop-1');
    const stories = servedContent('bundle', 'e2e-paid-guide', '1', 'be', 'base', 'stops.json');
    const story = stories.find((entry) => entry.story_id === 'story-paid-1');
    assert.ok(story, 'served stops.json must carry story-paid-1');
    const freeStop = await evaluateValue(
      browser,
      page,
      `(async () => {
        const tracks = Array.from(document.querySelectorAll('audio')).map((a) => a.getAttribute('src'));
        const first = document.querySelector('audio');
        if (!first) return { tracks, playback: null };
        first.preload = 'metadata';
        first.load();
        const loaded = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), 10000);
          first.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve('ok'); }, { once: true });
          first.addEventListener('error', () => { clearTimeout(timer); resolve('error'); }, { once: true });
        });
        if (loaded !== 'ok') return { tracks, playback: { loaded } };
        try {
          await first.play();
          return { tracks, playback: { loaded, duration: first.duration, playing: !first.paused } };
        } catch (error) {
          return { tracks, playback: { loaded, duration: first.duration, playError: String(error) } };
        }
      })()`,
    );
    assert.deepEqual(freeStop.tracks, [
      audioSrc('e2e-paid-guide', 'be', 'story-paid-1'),
      audioSrc('e2e-paid-guide', 'en', 'story-paid-1'),
    ]);
    assert.equal(freeStop.playback.loaded, 'ok');
    assert.ok(freeStop.playback.duration > 0, `audio duration must be positive, got ${freeStop.playback.duration}`);
    assert.equal(freeStop.playback.playing, true, `audio must play, got ${JSON.stringify(freeStop.playback)}`);
    const freeStopText = await evaluateValue(
      browser,
      page,
      `(() => ({
        storyHeading: Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === '${be.storyTextHeading}'),
        transcriptFirstParagraph: document.body.textContent.includes(${JSON.stringify(story.transcript.split(/\n{2,}/)[0])}),
      }))()`,
    );
    assert.equal(freeStopText.storyHeading, true);
    assert.equal(freeStopText.transcriptFirstParagraph, true);

    // Locked stop: the page carries the public preview only — no audio
    // element, no transcript, no extended layer anywhere in the served tree,
    // and the calm offer owns the transition.
    await goto('/guides/e2e-paid-guide/stops/e2e-stop-2');
    const lockedStop = await evaluateValue(
      browser,
      page,
      `(() => {
        const marker = document.querySelector('span[aria-label]');
        const aside = document.querySelector('aside');
        return {
          heading: document.querySelector('h1')?.textContent ?? null,
          audioCount: document.querySelectorAll('audio').length,
          lockedLabel: marker?.getAttribute('aria-label') ?? null,
          bodyText: document.body.textContent,
          announceShown: document.body.textContent.includes(${JSON.stringify(preview.announce)}),
          calmOfferPresent: !!aside,
          calmOfferVisible: aside ? aside.getBoundingClientRect().width > 0 && aside.getBoundingClientRect().height > 0 : false,
          calmOfferCtaHref: aside?.querySelector('a')?.getAttribute('href') ?? null,
          storyHeadingAbsent: !Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === '${be.storyTextHeading}'),
        };
      })()`,
    );
    assert.equal(lockedStop.heading, preview.name);
    assert.equal(lockedStop.audioCount, 0, 'a locked stop must render no audio element');
    assert.equal(lockedStop.lockedLabel, be.lockedLabel);
    assert.equal(lockedStop.announceShown, true);
    assert.equal(lockedStop.storyHeadingAbsent, true);
    assert.equal(lockedStop.calmOfferPresent, true);
    assert.equal(lockedStop.calmOfferVisible, true);
    assert.equal(lockedStop.calmOfferCtaHref, appLinks.fallbackPath);
    assert.equal(
      lockedStop.bodyText.includes(extendedLeakCanary()),
      false,
      'the locked stop page must never leak the extended-layer transcript',
    );
    const extendedDirs = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'extended') extendedDirs.push(path.join(dir, entry.name));
        else if (entry.isDirectory()) walk(path.join(dir, entry.name));
      }
    };
    walk(path.join(webOutRoot(), 'content', 'bundle'));
    assert.deepEqual(extendedDirs, [], 'the public export must carry no extended layer');

    assertCleanJourney({ pageErrors, blockedRequests });
  });
});
