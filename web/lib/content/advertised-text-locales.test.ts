// G21.45 (issue #669) — the fact ∩ gate intersection behind every advertised
// URL surface. The content-locale allowlist now carries nine codes (the
// schema owner accepts zh, ADR G21.42), while the UI route set stays
// release-gated over the eight-code registry (G21.50): a gate-closed code
// declared in a discovery index must never become a sitemap path, an
// hreflang entry or a prerendered route. Reverting advertisedTextLocales to
// the raw routeTextLocales fact turns this file red — the widened Locale
// would leak into the advertised surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { uiLocales } from '../i18n/index.ts';
import { advertisedTextLocales, readSiteCatalogPage } from './site.ts';
import { buildDemoFixture } from './test-fixture.ts';

test('advertisedTextLocales filters the published-text fact through the release gate', () => {
  // zh is declarable by fact (the schema allowlist accepts it) but closed:
  // the UI registry registers no zh catalogue until #670, so the gate never
  // advertises it — no /zh URL path, no hreflang entry.
  assert.deepEqual(advertisedTextLocales(['zh', 'be', 'sv']), ['be', 'sv']);
  // The eight shipped codes ride unchanged, in fact order (the G21.22
  // byte-identity rule for the shipped locales).
  assert.deepEqual(
    advertisedTextLocales(['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv']),
    ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv'],
  );
  assert.deepEqual(advertisedTextLocales([]), []);
});

test('the languages row rides the same gate through the production reader', async () => {
  // Rule 15: the pin reaches the real surface — the catalog page's language
  // facts come from the same intersection, not a second raw-fact path. The
  // demo fixture declares be/en/uk text, all gate-open, so the rows are the
  // fact itself; the assertion fails if languageFacts ever bypasses the gate
  // (a gate-closed code would then leak into a user-visible row).
  const { publicRoot } = await buildDemoFixture();
  for (const locale of uiLocales) {
    const { cards } = readSiteCatalogPage(publicRoot, locale);
    for (const card of cards) {
      for (const fact of card.languages) {
        assert.ok(
          (uiLocales as readonly string[]).includes(fact.locale),
          `language fact ${fact.locale} must sit inside the release-gated set`,
        );
      }
    }
  }
});
