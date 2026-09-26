// G10.02.a acceptance 4: card metadata for the demo route — one locked stop
// in the fixture — carries only public fields, checked verbatim against the
// locked-preview fixtures (16 G10.02: «метададзеныя не раскрываюць private»).
// The extended narration must not reach a card in any form, and the card
// image exists only against a live site origin — never a fabricated one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appLinks, type AppLinks } from '../app-links.ts';
import { cardImage, guideCardMeta, stopCardMeta } from './cards.ts';
import { readSiteCatalogPage, readSiteGuidePage, readSiteStopPage } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const { publicRoot } = await buildDemoFixture();

// .example is the reserved test TLD (RFC 2606) — the synthetic origin a test
// config may carry, clearly distinct from any real domain.
const liveOriginLinks: AppLinks = { ...appLinks, siteOrigin: { kind: 'live', href: 'https://kudy-test.example' } };

test('the guide card is built from the public fields only', () => {
  const guide = readSiteGuidePage(publicRoot, 'be', 'demo-route-a1');
  const meta = guideCardMeta(guide);
  assert.equal(meta.title, guide.title);
  assert.equal(meta.description, guide.summary);
  // The fixture route has no cover, and the real origin is unpublished —
  // nothing image-like may be invented.
  assert.equal(guide.cover, null);
  assert.equal(meta.image, null);
  assert.equal(meta.card, 'summary');
});

test('the locked stop card description is the preview announce, verbatim', () => {
  const locked = readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-2');
  assert.equal(locked.locked, true);
  if (locked.locked) {
    const meta = stopCardMeta(locked);
    assert.equal(meta.title, 'Млынавая калона (дэма)');
    assert.equal(meta.description, 'За паваротам — апошняя калона старога млына і гісторыя пра яе вяртуна.');
  }
  const lockedEn = readSiteStopPage(publicRoot, 'en', 'demo-route-a1', 'stop-2');
  assert.equal(lockedEn.locked, true);
  if (lockedEn.locked) {
    assert.equal(stopCardMeta(lockedEn).description,
      'Around the bend stands the last column of the old mill; a story about its weathervane.');
  }
});

test('the free stop card description is the public route summary', () => {
  const free = readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-1');
  assert.equal(free.locked, false);
  if (!free.locked) {
    // The summary the catalog page shows is the same public field the card uses.
    const summary = readSiteCatalogPage(publicRoot, 'be').cards[0]!.summary;
    assert.ok(summary.length > 0);
    assert.equal(stopCardMeta(free).description, summary);
  }
});

test('no extended narration reaches any card, in any locale', () => {
  const extended = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'fixtures', 'content', 'demo-route', 'be', 'extended', 'stops.json'), 'utf8'),
  )[0];
  const metas = [
    guideCardMeta(readSiteGuidePage(publicRoot, 'be', 'demo-route-a1')),
    guideCardMeta(readSiteGuidePage(publicRoot, 'en', 'demo-route-a1')),
    stopCardMeta(readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-1')),
    stopCardMeta(readSiteStopPage(publicRoot, 'be', 'demo-route-a1', 'stop-2')),
    stopCardMeta(readSiteStopPage(publicRoot, 'en', 'demo-route-a1', 'stop-2')),
  ];
  const rendered = JSON.stringify(metas);
  assert.ok(extended.text.length > 40);
  assert.ok(!rendered.includes(extended.text));
  assert.ok(!rendered.includes(extended.transcript));
});

test('card images exist only against a live site origin', () => {
  assert.equal(cardImage(appLinks, 'cover.jpg'), null, 'unpublished origin: no image, nothing fabricated');
  assert.equal(
    cardImage(liveOriginLinks, 'covers/main.jpg'),
    'https://kudy-test.example/covers/main.jpg',
    'live origin: the cover absolutizes against the config origin',
  );
  assert.equal(cardImage(liveOriginLinks, null), null);
});
