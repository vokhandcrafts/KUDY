// G23.02 acceptance criteria 4 and 5 (issue #660): keyboard-only navigation
// reaches and activates the main links with visible focus, and at 320, 390
// and 1440 px the pages hold no horizontal scroll with the primary actions
// visible. The journey runs over the paid guide — the web E2E city's only
// guide — and stays under the harness lockdown (criterion 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withE2ePage, assertCleanJourney, discoveryIndex } from '../test-browser/e2e-harness.mjs';
import { evaluateValue } from '../test-browser/cdp-browser.mjs';
import { be } from '../lib/i18n/be.ts';

// Focus facts of the active element: keyboard focus must be visible (the
// outline the UA focus ring draws — the site ships no outline reset) and the
// element must be a real link.
const FOCUS_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    href: el.getAttribute('href'),
    text: (el.textContent || '').trim().slice(0, 60),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    rect: { width: rect.width, height: rect.height, left: rect.left, right: rect.right },
  };
})()`;

test('G23.02: keyboard-only navigation reaches and activates the main links', async (t) => {
  await withE2ePage(t, async ({ browser, page, goto, press, waitForPath, pageErrors, blockedRequests }) => {
    await goto('/');
    // Tab from the document start through the header and the card list; the
    // guide card link must be reachable and every focused link visibly so.
    let reached = false;
    for (let tab = 0; tab < 12; tab += 1) {
      await press('Tab');
      const focus = await evaluateValue(browser, page, FOCUS_PROBE);
      if (!focus) continue;
      assert.notEqual(focus.outlineStyle, 'none', `focus outline must be visible on ${focus.href ?? focus.tag}`);
      assert.notEqual(focus.outlineWidth, '0px', `focus ring must have width on ${focus.href ?? focus.tag}`);
      if (focus.href === '/guides/e2e-paid-guide') {
        reached = true;
        break;
      }
    }
    assert.equal(reached, true, 'keyboard Tab must reach the guide card link');

    // Enter on the focused link navigates — the whole journey works without
    // a pointing device.
    await press('Enter');
    await waitForPath('/guides/e2e-paid-guide');
    const heading = await evaluateValue(browser, page, `document.querySelector('h1')?.textContent ?? null`);
    const offer = discoveryIndex().offers.find((entry) => entry.ref.kind === 'guide');
    assert.ok(offer, 'the served discovery must offer a guide');
    assert.equal(heading, offer.localized.title.be);

    assertCleanJourney({ pageErrors, blockedRequests });
  });
});

test('G23.02: 320/390/1440 px keep pages inside the viewport with primary actions visible', async (t) => {
  await withE2ePage(t, async ({ browser, page, goto, pageErrors, blockedRequests }) => {
    const setViewport = (width, height) =>
      browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page);
    const clearViewport = () => browser.send('Emulation.clearDeviceMetricsOverride', {}, page);

    // The primary action of each page class: the guide card on the catalog,
    // the first stop link on the guide, the audio player and the back link
    // on the free stop, the calm offer CTA on the locked stop.
    const pages = [
      { path: '/', primary: ['a[href^="/guides/e2e-paid-guide"]'] },
      { path: '/guides/e2e-paid-guide', primary: ['a[href="/guides/e2e-paid-guide/stops/e2e-stop-1"]'] },
      { path: '/guides/e2e-paid-guide/stops/e2e-stop-1', primary: ['audio', 'a[href="/guides/e2e-paid-guide"]'] },
      { path: '/guides/e2e-paid-guide/stops/e2e-stop-2', primary: ['aside a'] },
    ];

    try {
      for (const width of [320, 390, 1440]) {
        await setViewport(width, 800);
        for (const { path: pagePath, primary } of pages) {
          await goto(pagePath);
          const check = await evaluateValue(
            browser,
            page,
            `(() => {
              const selectors = ${JSON.stringify(primary)};
              const innerWidth = window.innerWidth;
              const horizontalScroll =
                document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth;
              const actions = selectors.map((selector) => {
                const el = document.querySelector(selector);
                if (!el) return { selector, present: false };
                const rect = el.getBoundingClientRect();
                return {
                  selector,
                  present: true,
                  visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 0.5,
                  right: rect.right,
                };
              });
              return { innerWidth, horizontalScroll, actions };
            })()`,
          );
          assert.equal(check.horizontalScroll, false, `${width}px ${pagePath}: no horizontal scroll`);
          for (const action of check.actions) {
            assert.equal(action.present, true, `${width}px ${pagePath}: ${action.selector} must exist`);
            assert.equal(action.visible, true, `${width}px ${pagePath}: ${action.selector} must be visible`);
          }
        }
      }
    } finally {
      await clearViewport();
    }

    assertCleanJourney({ pageErrors, blockedRequests });
  });
});
