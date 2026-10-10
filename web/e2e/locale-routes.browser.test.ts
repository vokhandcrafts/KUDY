// G23.02 acceptance criteria 2 and 3 (issue #660): the language switch keeps
// the visitor on the equivalent path, every published UI-locale route opens
// with the matching document language (#554), the /app fallback page renders
// the store row exactly as the app-links config states, the privacy page
// opens in each locale, and an unknown route lands on the exported not-found
// page. Facts come from the locale registry, the localePath mapping point
// and the served discovery tree — never hand-typed (implementation-rules 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withE2ePage, assertCleanJourney, discoveryIndex } from '../test-browser/e2e-harness.mjs';
import { evaluateValue } from '../test-browser/cdp-browser.mjs';
import { defaultUiLocale, getUiStrings, uiLocaleNativeName, uiLocales } from '../lib/i18n/index.ts';
import { appLinks } from '../lib/app-links.ts';
import { localePath } from '../lib/content/site.ts';

test('G23.02: the be ↔ en switch keeps the equivalent path and every locale route opens', async (t) => {
  await withE2ePage(t, async ({ browser, page, goto, pageErrors, blockedRequests }) => {
    // The switch row on a guide page: every UI locale's self-name, the
    // current one marked, the others pointing at the same path.
    await goto('/guides/e2e-paid-guide');
    const switchRow = await evaluateValue(
      browser,
      page,
      `(() => Array.from(document.querySelectorAll('header a, header strong')).map((el) => ({
        tag: el.tagName,
        href: el.getAttribute('href'),
        text: el.textContent,
        current: el.getAttribute('aria-current') === 'page',
      })))()`,
    );
    for (const locale of uiLocales) {
      const entry = switchRow.find((item) => item.text === uiLocaleNativeName(locale));
      assert.ok(entry, `the switch must name ${locale} by its self-name`);
      if (locale === defaultUiLocale) {
        assert.equal(entry.current, true, 'the current locale must be marked, not linked');
      } else {
        assert.equal(entry.current, false);
        assert.equal(entry.href, localePath(locale, '/guides/e2e-paid-guide'));
      }
    }

    // be ↔ en: the en chip lands on the equivalent en path with the en
    // content, and the be chip leads straight back. The expected title comes
    // from the served discovery offer — the fact the page renders.
    const offer = discoveryIndex().offers.find((entry) => entry.ref.kind === 'guide');
    assert.ok(offer, 'the served discovery must offer a guide');
    const enHref = switchRow.find((item) => item.text === uiLocaleNativeName('en')).href;
    await goto(enHref);
    const enPage = await evaluateValue(
      browser,
      page,
      `(() => ({
        lang: document.documentElement.lang,
        heading: document.querySelector('h1')?.textContent ?? null,
        backChipHref: Array.from(document.querySelectorAll('header a')).find((a) => a.textContent === ${JSON.stringify(uiLocaleNativeName('be'))})?.getAttribute('href') ?? null,
      }))()`,
    );
    assert.equal(enPage.lang, 'en');
    assert.equal(enPage.heading, offer.localized.title.en);
    assert.equal(enPage.backChipHref, '/guides/e2e-paid-guide');

    // Every published UI-locale route opens and declares its language. The
    // synthetic offer publishes text in be and en only (#554 fact), so the
    // other locales must show the localized empty-catalogue state — never
    // substituted content.
    for (const locale of uiLocales) {
      await goto(localePath(locale, '/'));
      const strings = getUiStrings(locale);
      const catalog = await evaluateValue(
        browser,
        page,
        `(() => ({
          lang: document.documentElement.lang,
          empty: document.body.textContent.includes(${JSON.stringify(strings.catalogEmpty)}),
          guideCardPresent: !!document.querySelector(${JSON.stringify(`a[href="${localePath(locale, '/guides/e2e-paid-guide')}"]`)}),
        }))()`,
      );
      assert.equal(catalog.lang, locale, `/${locale === defaultUiLocale ? '' : locale} must declare lang=${locale}`);
      if (locale === 'be' || locale === 'en') {
        assert.equal(catalog.guideCardPresent, true, `${locale} has published text — the guide card must render`);
        assert.equal(catalog.empty, false);
      } else {
        assert.equal(catalog.empty, true, `${locale} has no published text — the empty-catalogue state must render`);
        assert.equal(catalog.guideCardPresent, false, `${locale} must not render substituted content`);
      }
    }

    assertCleanJourney({ pageErrors, blockedRequests });
  });
});

test('G23.02: /app fallback, per-locale privacy and the not-found page', async (t) => {
  await withE2ePage(t, async ({ browser, page, goto, pageErrors, blockedRequests }) => {
    // /app: the CTA fallback target — the store row exactly as the config
    // states (a live store is a link, an unpublished one the «хутка» state).
    await goto('/app');
    const appStrings = getUiStrings(defaultUiLocale);
    const appPage = await evaluateValue(
      browser,
      page,
      `(() => ({
        lang: document.documentElement.lang,
        heading: document.querySelector('h1')?.textContent ?? null,
        text: document.body.textContent,
        storeLinks: Array.from(document.querySelectorAll('main a[href^="https://"]')).map((a) => a.getAttribute('href')),
      }))()`,
    );
    assert.equal(appPage.lang, 'be');
    assert.equal(appPage.heading, appStrings.appPageTitle);
    for (const store of ['appStore', 'playStore']) {
      const url = appLinks[store];
      if (url.kind === 'live') {
        assert.ok(appPage.storeLinks.includes(url.href), `a live ${store} URL must be a link`);
      } else {
        assert.ok(
          appPage.text.includes(appStrings.storeComingSoon),
          'an unpublished store renders the explicit coming-soon state',
        );
      }
    }

    // The privacy page opens in each locale and declares its language.
    for (const locale of uiLocales) {
      await goto(localePath(locale, '/privacy'));
      const privacy = await evaluateValue(
        browser,
        page,
        `(() => ({
          lang: document.documentElement.lang,
          heading: document.querySelector('h1')?.textContent ?? null,
          contactHref: document.querySelector('main a[href^="https://"]')?.getAttribute('href') ?? null,
        }))()`,
      );
      const strings = getUiStrings(locale);
      assert.equal(privacy.lang, locale, `privacy must open for ${locale}`);
      assert.equal(privacy.heading, strings.privacyTitle);
      assert.equal(privacy.contactHref, appLinks.supportIssuesUrl);
    }

    // An unknown route serves the exported not-found page — the shared 404
    // document with the default language and a way home, prefixed or not.
    for (const unknown of ['/never/anywhere', '/en/never/anywhere']) {
      await goto(unknown);
      const notFound = await evaluateValue(
        browser,
        page,
        `(() => ({
          lang: document.documentElement.lang,
          heading: document.querySelector('h1')?.textContent ?? null,
          homeHref: document.querySelector('main a')?.getAttribute('href') ?? null,
        }))()`,
      );
      const beStrings = getUiStrings('be');
      assert.equal(notFound.lang, defaultUiLocale, 'the global 404 declares the site default language');
      assert.equal(notFound.heading, beStrings.versionUnavailable);
      assert.equal(notFound.homeHref, '/');
    }

    assertCleanJourney({ pageErrors, blockedRequests });
  });
});
