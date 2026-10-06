// G21.03 browser proof (issue #536): the real MapPage (production component
// graph, real locale strings) runs in a headless Chromium served by the
// fixture server in web/test-browser/. Aborting the provider requests with
// the CDP error reason InternetDisconnected — the protocol spelling of the
// issue's "internetdisconnected" — must leave an empty map marked only by
// data-map-error plus the localized accessible message, with the guide links
// usable; a subsequent successful initialization clears the message again
// and unmounting the live map leaves no page errors behind. The suite skips
// visibly when the host has no browser binary (implementation-rules 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromiumBinary, launchBrowser, evaluateValue, waitForExpression } from './test-browser/cdp-browser.mjs';
import { startMapHarnessServer } from './test-browser/map-harness-server.mjs';
import { be } from './lib/i18n/be.ts';
import { en } from './lib/i18n/en.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = HERE;

// One DOM collector for both scenarios; the raw-failure regex asserts the
// visitor never sees the provider URL or the exception text (criterion 3).
type CdpConsoleArgs = { value?: unknown; description?: string }[];

const COLLECTOR = `(() => {
  const container = document.querySelector('[data-map-error]');
  const message = document.querySelector('p[role="status"]');
  const guideLinks = Array.from(document.querySelectorAll('a[href^="/guides/"]'));
  // The dataset marker is part of the failure surface too: it must name the
  // failure without ever carrying the provider URL or an exception string.
  const failureText =
    (message ? message.textContent : '') +
    (container ? container.textContent : '') +
    (container ? container.dataset.mapError || '' : '');
  return {
    errorPresent: !!container,
    errorMarkerSet: container ? (container.dataset.mapError || '').length > 0 : false,
    messageFound: !!message,
    messageHidden: message ? message.hidden : null,
    messageText: message ? message.textContent : null,
    leaksRawFailure: /openfreemap|http|failed to fetch|typeerror/i.test(failureText),
    guideLinks: guideLinks.map((a) => {
      a.scrollIntoView({ block: 'center' });
      const rect = a.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        href: a.getAttribute('href'),
        visible: rect.width > 0 && rect.height > 0,
        hit: !!hit && (a === hit || a.contains(hit)),
      };
    }),
  };
})()`;

test('G21.03: aborted map requests show the localized failure message; a good load clears it; unmount stays clean', async (t) => {
  const chromium = findChromiumBinary();
  if (!chromium) {
    t.skip('no Chromium binary on this host (set KUDY_CHROMIUM to the browser path)');
    return;
  }
  if (!fs.existsSync(path.join(WEB_ROOT, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.js'))) {
    t.skip('web dependencies are not installed (cd web && npm ci)');
    return;
  }
  const server = await startMapHarnessServer();
  const browser = await launchBrowser(chromium);
  try {
    const page = await browser.newPage();
    await browser.send('Page.enable', {}, page);
    await browser.send('Runtime.enable', {}, page);

    const consoleErrors: string[] = [];
    let providerMode = 'fail';
    browser.onEvent((method: string, params: { type?: string; args?: CdpConsoleArgs; requestId?: string }, sessionId?: string) => {
      if (sessionId !== page) return;
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push(
          params.args!.map((arg) => String(arg.value ?? arg.description ?? '')).join(' '),
        );
      }
      if (method === 'Fetch.requestPaused') {
        // Fire-and-forget: the driver rejects the command if the socket
        // closes during cleanup. The test does not await it.
        if (providerMode === 'fail') {
          void browser.send(
            'Fetch.failRequest',
            { requestId: params.requestId, errorReason: 'InternetDisconnected' },
            sessionId,
          ).catch(() => {});
        } else {
          void browser.send(
            'Fetch.fulfillRequest',
            {
              requestId: params.requestId,
              responseCode: 200,
              // The style request is cross-origin from the harness page, so
              // the fulfilled response must carry a CORS allow header —
              // without it the page fetch rejects before the JSON lands.
              responseHeaders: [
                { name: 'content-type', value: 'application/json' },
                { name: 'access-control-allow-origin', value: '*' },
              ],
              body: Buffer.from(server.styleBody, 'utf8').toString('base64'),
            },
            sessionId,
          ).catch(() => {});
        }
      }
    });

    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/` }, page);
    await waitForExpression(browser, page, "document.readyState === 'complete' && !!window.__mapHarness");
    // The success/recovery scenarios need a working WebGL2 context; on hosts
    // where software GL is unavailable the live-browser suite skips with the
    // limitation named (implementation-rules 7) instead of failing on the
    // environment.
    const webgl2 = await evaluateValue(browser, page, "!!document.createElement('canvas').getContext('webgl2')");
    if (!webgl2) {
      t.skip('WebGL2 is unavailable in this Chromium build (software GL required for MapLibre)');
      return;
    }
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://tiles.openfreemap.org/*' }] }, page);

    // Criterion 1: the aborted provider request reproduces the empty map —
    // only data-map-error marks it, no tile content, no raw failure text.
    await evaluateValue(browser, page, "window.__mapHarness.mount('be')");
    await waitForExpression(browser, page, "!!document.querySelector('[data-map-error]')");
    const beFailure = await evaluateValue(browser, page, COLLECTOR);
    assert.equal(beFailure.messageFound, true);
    assert.equal(beFailure.messageHidden, false);
    assert.equal(beFailure.messageText, be.mapError);
    assert.equal(beFailure.errorMarkerSet, true);
    assert.equal(beFailure.leaksRawFailure, false);
    assert.ok(beFailure.guideLinks.length >= 2);
    for (const link of beFailure.guideLinks) {
      assert.equal(link.visible, true, `guide link ${link.href} must stay visible`);
      assert.equal(link.hit, true, `guide link ${link.href} must stay usable (not covered)`);
    }

    // Criterion 2 (localized): the en page shows the en message.
    await evaluateValue(browser, page, 'window.__mapHarness.unmount()');
    await evaluateValue(browser, page, "window.__mapHarness.mount('en')");
    await waitForExpression(browser, page, "!!document.querySelector('[data-map-error]')");
    const enFailure = await evaluateValue(browser, page, COLLECTOR);
    assert.equal(enFailure.messageText, en.mapError);
    assert.equal(enFailure.leaksRawFailure, false);

    // Criterion 3 (recovery): the provider works again — the next
    // initialization loads, clears message and marker, and the guide links
    // stay usable.
    providerMode = 'local-style';
    await evaluateValue(browser, page, 'window.__mapHarness.unmount()');
    await evaluateValue(browser, page, "window.__mapHarness.mount('be')");
    await waitForExpression(
      browser,
      page,
      `document.querySelector('div[role="region"]')?.dataset.mapReady === 'fitted'`,
      { timeoutMs: 30000 },
    );
    const success = await evaluateValue(browser, page, COLLECTOR);
    assert.equal(success.errorPresent, false);
    assert.equal(success.messageHidden, true);
    assert.equal(success.messageText, be.mapError);
    assert.equal(success.leaksRawFailure, false);
    for (const link of success.guideLinks) {
      assert.equal(link.visible, true, `guide link ${link.href} must stay visible`);
      assert.equal(link.hit, true, `guide link ${link.href} must stay usable (not covered)`);
    }

    // Criterion 2 (cleanup): removing the live map leaves no errors behind.
    const consoleErrorsBeforeUnmount = consoleErrors.length;
    await evaluateValue(browser, page, 'window.__mapHarness.unmount()');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(await evaluateValue(browser, page, 'window.__pageErrors'), []);
    assert.deepEqual(consoleErrors.slice(consoleErrorsBeforeUnmount), []);
  } finally {
    await browser.close();
    await server.close();
  }
});
