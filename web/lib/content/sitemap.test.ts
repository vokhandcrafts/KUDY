// G21.22 (issue #554) — sitemap_actual_translations: the sitemap derivation
// follows actual published text. Chrome routes are advertised in every UI
// locale; guide and stop pages only for the locales whose text is actually
// published; an untranslated guide variant never enters the sitemap; and
// while the site origin is unpublished nothing is emitted at all (no
// fabricated origin — the build-qr rule).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appLinks, type AppLinks } from '../app-links.ts';
import { buildSitemapEntries, sitemapPaths } from './sitemap.ts';
import { buildDemoFixture } from './test-fixture.ts';

// .example is the reserved test TLD (RFC 2606) — the synthetic origin a test
// config may carry, clearly distinct from any real domain.
const liveOriginLinks: AppLinks = { ...appLinks, siteOrigin: { kind: 'live', href: 'https://kudy-test.example' } };

const { publicRoot } = await buildDemoFixture();
const paths = sitemapPaths(publicRoot);

test('sitemap_actual_translations: chrome routes are advertised in every UI locale', () => {
  // The same localePath scheme the links serve: the default catalog sits at
  // the root, every other locale is a prefix (the home href carries the
  // trailing slash).
  const prefixes = ['', '/en', '/uk', '/de', '/es', '/fr', '/cs', '/sv'];
  const expected = prefixes.flatMap((prefix) =>
    prefix ? [`${prefix}/`, `${prefix}/map`, `${prefix}/app`, `${prefix}/privacy`] : ['/', '/map', '/app', '/privacy'],
  );
  const missing = expected.filter((path) => !paths.includes(path));
  assert.deepEqual(missing, []);
});

test('sitemap_actual_translations: guide and stop pages only for published text locales', () => {
  // The demo offer declares text be/en/uk — exactly those guide and stop
  // variants are advertised.
  assert.ok(paths.includes('/guides/demo-route-a1'));
  assert.ok(paths.includes('/en/guides/demo-route-a1'));
  assert.ok(paths.includes('/uk/guides/demo-route-a1'));
  assert.ok(paths.includes('/uk/guides/demo-route-a1/stops/stop-1'));
  assert.ok(paths.includes('/uk/guides/demo-route-a1/stops/stop-2'));
  for (const locale of ['de', 'es', 'fr', 'cs', 'sv']) {
    assert.ok(!paths.includes(`/${locale}/guides/demo-route-a1`), `${locale} guide variant must not be advertised`);
    assert.ok(!paths.includes(`/${locale}/guides/demo-route-a1/stops/stop-1`), `${locale} stop variant must not be advertised`);
  }
  // Nothing paid or private exists on the web channel; the count pins the
  // full derivation: 32 chrome + 3 guides + 6 stops.
  assert.equal(paths.length, 41);
});

test('sitemap_actual_translations: unpublished origin emits nothing (no fabricated origin)', () => {
  assert.deepEqual(buildSitemapEntries(publicRoot), []);
});

test('sitemap_actual_translations: a live origin absolutizes the same paths', () => {
  const entries = buildSitemapEntries(publicRoot, liveOriginLinks);
  assert.equal(entries.length, paths.length);
  assert.deepEqual(entries[0], { url: 'https://kudy-test.example/' });
  assert.ok(entries.some((entry) => entry.url === 'https://kudy-test.example/uk/guides/demo-route-a1'));
  assert.ok(!entries.some((entry) => entry.url.startsWith('https://kudy-test.example/fr/guides/')));
});
