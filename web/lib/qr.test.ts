// G10.02.a acceptance 3: the QR payloads round-trip — a generated asset
// decodes back to the exact URL the config/URL builder produced, and nothing
// is targeted while the site origin is unpublished (16 G10.02 / plan §3.4:
// a QR is only as real as the URL it encodes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';

import { appLinks, type AppLinks } from './app-links.ts';
import { routeQrTargets } from './qr.ts';
import { uiLocales } from './i18n/index.ts';
import { readSiteCatalogPage } from './content/site.ts';
import { buildDemoFixture } from './content/test-fixture.ts';

// .example is the reserved test TLD (RFC 2606) — the synthetic origin a test
// config may carry, clearly distinct from any real domain.
const liveOriginLinks: AppLinks = { ...appLinks, siteOrigin: { kind: 'live', href: 'https://kudy-test.example' } };

test('unpublished site origin: no QR target exists, nothing fabricated', () => {
  assert.deepEqual(routeQrTargets(appLinks, [{ route_id: 'demo-route-a1' }], uiLocales), []);
});

test('one target per route × UI locale, through the config and the URL builder', async () => {
  const { publicRoot } = await buildDemoFixture();
  const routes = readSiteCatalogPage(publicRoot, 'be').cards.map((card) => ({ route_id: card.route_id }));
  // G21.22: the QR targets follow the live UI locale set — all eight since
  // the route release stopped waiting for narration (an unavailable-language
  // QR lands on the localized unavailable state, never substituted content).
  assert.deepEqual(routeQrTargets(liveOriginLinks, routes, uiLocales), [
    { route_id: 'demo-route-a1', locale: 'be', url: 'https://kudy-test.example/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'en', url: 'https://kudy-test.example/en/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'uk', url: 'https://kudy-test.example/uk/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'de', url: 'https://kudy-test.example/de/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'es', url: 'https://kudy-test.example/es/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'fr', url: 'https://kudy-test.example/fr/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'cs', url: 'https://kudy-test.example/cs/guides/demo-route-a1' },
    { route_id: 'demo-route-a1', locale: 'sv', url: 'https://kudy-test.example/sv/guides/demo-route-a1' },
  ]);
});

test('every generated QR asset decodes back to the exact target URL', async () => {
  const targets = routeQrTargets(liveOriginLinks, [{ route_id: 'demo-route-a1' }], uiLocales);
  assert.equal(targets.length, 8);
  for (const target of targets) {
    // The same print parameters the build script writes (width, quiet zone).
    const png = await QRCode.toBuffer(target.url, { type: 'png', width: 1024, margin: 4, errorCorrectionLevel: 'M' });
    const image = PNG.sync.read(png);
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    assert.ok(decoded, `the QR PNG for ${target.url} must decode`);
    assert.equal(decoded.data, target.url);
  }
});
