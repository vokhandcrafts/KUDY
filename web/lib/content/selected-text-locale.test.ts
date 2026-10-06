// G21.22 (issue #554) — web_selected_text_locale: the web channel selects
// text by the actual published fact. A locale whose offers declare no text
// yields a valid localized empty catalogue; a published text locale renders
// its own words; declared-but-missing content still fails distinctly
// (implementation-rules 14: every rule ships with an isolating negative
// test). The demo fixture is the synthetic mixed-availability catalogue:
// text be/en/uk (audio be/en), no text de/es/fr/cs/sv.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SiteDataError, readSiteCatalogPage, readSiteGuidePage, readSiteStopPage, routeTextLocales } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

const { publicRoot } = await buildDemoFixture();

test('web_selected_text_locale: a locale without published text yields a valid localized empty catalogue', () => {
  for (const locale of ['fr', 'de', 'es', 'cs', 'sv'] as const) {
    const page = readSiteCatalogPage(publicRoot, locale);
    assert.deepEqual(page.cards, [], `${locale} has no declared text — no cards`);
    // The chrome stays complete: the map entry and its locale-prefixed href
    // are published even with an empty catalogue (criterion 1).
    assert.equal(page.mapHref, `/${locale}/map`);
  }
});

test('web_selected_text_locale: a published text locale renders its own words (uk)', () => {
  const catalog = readSiteCatalogPage(publicRoot, 'uk');
  assert.equal(catalog.cards.length, 1);
  assert.equal(catalog.cards[0]!.title, 'Демо-гід: сукняний двір');
  assert.equal(catalog.cards[0]!.href, '/uk/guides/demo-route-a1');
  const guide = readSiteGuidePage(publicRoot, 'uk', 'demo-route-a1');
  assert.equal(guide.title, 'Демо-гід: сукняний двір');
  assert.equal(guide.stops[0]!.name, 'Двір сукнарів (демо)');
  assert.equal(guide.stops[1]!.locked, true);
  const stop = readSiteStopPage(publicRoot, 'uk', 'demo-route-a1', 'stop-1');
  assert.match(stop.locked === false ? stop.transcript : '', /Демо-транскрипт/);
  // Audio is a separate fact (09 §8): the uk text has no uk audio — the
  // player lists the audio locales that actually exist on disk.
  assert.deepEqual(stop.locked === false ? stop.audio : [], [
    { locale: 'be', src: '/content/bundle/demo-route-a1/1/be/base/audio/story-1-base.m4a' },
    { locale: 'en', src: '/content/bundle/demo-route-a1/1/en/base/audio/story-1-base.m4a' },
  ]);
});

test('web_selected_text_locale: declared-but-missing text fails the build distinctly (criterion 2)', async () => {
  // A copy of the built fixture where the offer DECLARES fr text it does not
  // carry: the filter must not hide the corruption — the exact-localized read
  // throws unknown-locale and the build fails loudly.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-web-declared-'));
  fs.cpSync(publicRoot, tmp, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(tmp, 'catalog.json'), 'utf8'));
  const pointer: string = catalog.discovery_index.path; // discovery/<city>/<revision>/index.json
  const indexFile = path.join(tmp, ...pointer.split('/'));
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  index.offers[0].availability.text_locales.push('fr');
  fs.writeFileSync(indexFile, JSON.stringify(index));
  assert.throws(() => readSiteCatalogPage(tmp, 'fr'), (error: unknown) => {
    assert.ok(error instanceof SiteDataError);
    assert.equal(error.code, 'unknown-locale');
    assert.match(error.dataPath, /discovery:offers:demo-route-a1:fr/);
    return true;
  });
});

test('web_selected_text_locale: the unavailable-language gate reads the declared fact', () => {
  // The fact the guide/stop pages gate on: the offer's declared text locales.
  // A locale outside the list never reaches the content readers — the page
  // renders the localized unavailable state; the reader-level refusal stays
  // pinned so a silent content fallback cannot return.
  assert.deepEqual(routeTextLocales(publicRoot, 'demo-route-a1'), ['be', 'en', 'uk']);
  assert.throws(() => readSiteGuidePage(publicRoot, 'fr', 'demo-route-a1'), SiteDataError);
  assert.throws(() => readSiteStopPage(publicRoot, 'fr', 'demo-route-a1', 'stop-1'), SiteDataError);
});
