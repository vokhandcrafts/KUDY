// G21.18 (issue #555) — web acceptance matrix, criterion 1–2 and the #534
// regression. The statically exported site (web/out, output:'export') is served
// by the shared tools/serve-static.mjs server and walked in headless Chromium
// through the shared web/test-browser/cdp-browser.mjs driver: all eight UI
// locales × {home, guide, map, privacy, app, 404} × {320, 390, 1440} for the
// home surface, 390 for the rest. Every page must answer with its document
// language (#534), a heading, an overflow-free layout and accessible names;
// the catalogue states (guide cards for the text locales be/en/uk, the
// localized empty catalogue for the five locales without demo text) and the
// localized text-unavailable page (noindex) are asserted per G21.17/G21.22.
// Screenshots land in web/ of this directory; results.json is the record.
//
// Usage (any cwd):
//   node --experimental-strip-types docs/testing/evidence/2026-10-07-g2118/web-matrix.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../../tools/serve-static.mjs';
import { findChromiumBinary, launchBrowser, evaluateValue, waitForExpression } from '../../../../web/test-browser/cdp-browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.join(HERE, '..', '..', '..', '..', 'web', 'out');

const LOCALES = ['be', 'en', 'uk', 'de', 'es', 'fr', 'cs', 'sv'];
const WIDTHS = [320, 390, 1440];
// The route under assertion and its text locales come from the served
// catalog (no restatement of the content identity here): whichever
// publication the export carries (the demo-route interim drop or the G23.02
// synthetic paid-guide city), the matrix walks that route.
const servedCatalog = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, 'content', 'catalog.json'), 'utf8'));
const ROUTE_ID = servedCatalog.routes[0].route_id;
const TEXT_LOCALES = servedCatalog.routes[0].locales ?? servedCatalog.routes[0].text_locales;

// The localized strings under assertion come from the shipped web i18n
// projections (no restatement in this script): one dynamic import per locale.
const strings = {};
for (const locale of LOCALES) {
  const mod = await import(`../../../../web/lib/i18n/${locale}.ts`);
  strings[locale] = mod[locale];
}
const { catalogEmpty, textUnavailableTitle } = strings.be;

const server = createStaticServer(SITE_ROOT);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// The export emits <page>.html files (Vercel cleanUrls serves /de → de.html);
// the local matrix requests those exact files — the same bytes production
// serves — because the local static server has no cleanUrls mapping.
const urlFor = (locale, rawRoute) => {
  const route = rawRoute.replace(/\/+$/, '');
  if (route === '404') return `${base}/404.html`;
  const prefix = locale === 'be' ? '' : `/${locale}`;
  if (route === '') return prefix === '' ? `${base}/index.html` : `${base}${prefix}.html`;
  return `${base}${prefix}/${route}.html`;
};
const expectedLang = (locale, route) => (route === '404' ? 'be' : locale);

const results = [];
let failingChecks = 0;

async function walk(browser, sid, { locale, route, width, height, shoot }) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 }, sid);
  const url = urlFor(locale, route);
  await browser.send('Page.navigate', { url }, sid);
  // Wait for THIS page to be the committed document: readyState alone also
  // reads true on the previous page mid-navigation.
  await waitForExpression(browser, sid, `document.readyState === "complete" && location.href === ${JSON.stringify(url)}`);
  const observed = await evaluateValue(browser, sid, `(() => {
    const doc = document.documentElement;
    const h1 = document.querySelector('h1');
    const controls = [...document.querySelectorAll('a,button')];
    return {
      lang: doc.getAttribute('lang'),
      title: document.title,
      h1: h1 ? h1.textContent.trim() : null,
      overflow: doc.scrollWidth - doc.clientWidth,
      guideLinks: [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h.includes('${ROUTE_ID}')).length,
      bodyText: document.body.innerText,
      imagesWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      unnamedControls: controls.filter((el) => ((el.getAttribute('aria-label') || el.textContent) || '').trim().length === 0).length,
      noindex: !!document.querySelector('meta[name="robots"][content*="noindex"]'),
    };
  })()`);
  if (shoot) {
    const tag = route === '' ? 'home' : route.replaceAll('/', '-').replace(/-$/, '');
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path.join(HERE, 'web', `${locale}-${tag}-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
  const checks = {
    langMatches: observed.lang === expectedLang(locale, route),
    hasHeading: !!observed.h1 && observed.h1.length > 0,
    overflowFree: observed.overflow <= 2,
    imagesNamed: observed.imagesWithoutAlt === 0,
    controlsNamed: observed.unnamedControls === 0,
  };
  const failed = Object.values(checks).filter((v) => !v).length;
  failingChecks += failed;
  return { checks, failed, observed };
}

const chromium = findChromiumBinary();
if (!chromium) {
  console.error('no Chromium binary on this host (set KUDY_CHROMIUM) — skipping visibly, implementation-rules 7');
  process.exit(2);
}
const browser = await launchBrowser(chromium);
try {
  const sid = await browser.newPage();
  await browser.send('Page.enable', {}, sid);

  // Home surface: all eight locales at all three widths, catalogue state and
  // one screenshot per locale per width.
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      const { checks, failed, observed } = await walk(browser, sid, {
        locale, route: '', width, height: width === 1440 ? 900 : 844, shoot: true,
      });
      const localizedEmpty = observed.bodyText.includes(strings[locale].catalogEmpty);
      const catalogState = TEXT_LOCALES.includes(locale)
        ? (observed.guideLinks > 0 && !localizedEmpty ? 'guide-card' : 'WRONG')
        : (localizedEmpty && observed.guideLinks === 0 ? 'empty-localized' : 'WRONG');
      results.push({ name: `home/${locale}/${width}`, ...checks, catalogState, observed: {
        lang: observed.lang, h1: observed.h1, overflow: observed.overflow,
        guideLinks: observed.guideLinks, imagesWithoutAlt: observed.imagesWithoutAlt,
        unnamedControls: observed.unnamedControls,
      } });
      if (failed > 0 || catalogState === 'WRONG') failingChecks += catalogState === 'WRONG' ? 1 : 0;
    }
  }

  // Guide page: rendered guide for the text locales; the localized
  // text-unavailable page with noindex for the other five (G21.22).
  for (const locale of LOCALES) {
    const { checks, failed, observed } = await walk(browser, sid, {
      locale, route: `guides/${ROUTE_ID}/`, width: 390, height: 844, shoot: true,
    });
    const unavailableShown = observed.bodyText.includes(strings[locale].textUnavailableTitle);
    const guideState = TEXT_LOCALES.includes(locale)
      ? (!unavailableShown && observed.guideLinks >= 0 ? 'guide-rendered' : 'WRONG')
      : (unavailableShown && observed.noindex ? 'unavailable-localized-noindex' : 'WRONG');
    results.push({ name: `guide/${locale}/390`, ...checks, guideState, noindex: observed.noindex });
    if (failed > 0 || guideState === 'WRONG') failingChecks += guideState === 'WRONG' ? 1 : 0;
  }

  // Map page: #535 attribution present in every locale; #536's localized
  // failure behavior is exercised by the committed web/city-map.browser.test.ts.
  for (const locale of LOCALES) {
    const { checks, failed, observed } = await walk(browser, sid, {
      locale, route: 'map/', width: 390, height: 844, shoot: true,
    });
    const attributionShown = /OpenStreetMap/.test(observed.bodyText);
    results.push({ name: `map/${locale}/390`, ...checks, mapAttributionPresent: attributionShown });
    if (failed > 0 || !attributionShown) failingChecks += attributionShown ? 0 : 1;
  }

  // Privacy and app surfaces (criterion 1), be/en/uk/de at 390.
  for (const route of ['privacy/', 'app/']) {
    for (const locale of ['be', 'en', 'uk', 'de']) {
      const { checks, failed } = await walk(browser, sid, {
        locale, route, width: 390, height: 844, shoot: true,
      });
      results.push({ name: `${route.replace('/', '')}/${locale}/390`, ...checks });
      if (failed > 0) failingChecks += failed;
    }
  }

  // The shared 404 keeps the default document language (G21.01/#534).
  {
    const { checks, failed } = await walk(browser, sid, { locale: 'be', route: '404', width: 390, height: 844, shoot: true });
    results.push({ name: '404/be/390', ...checks });
    if (failed > 0) failingChecks += failed;
  }

  // Keyboard focus and Back (criterion 2): the first Tab lands on a named
  // link; the browser Back returns from privacy to the home page.
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
  await browser.send('Page.navigate', { url: `${base}/index.html` }, sid);
  await waitForExpression(browser, sid, 'document.readyState === "complete"');
  for (const type of ['keyDown', 'keyUp']) {
    await browser.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sid);
  }
  const focus = await evaluateValue(browser, sid, `(() => {
    const el = document.activeElement;
    return { tag: el ? el.tagName : null, text: el ? (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40) : null };
  })()`);
  await browser.send('Page.navigate', { url: `${base}/privacy.html` }, sid);
  await waitForExpression(browser, sid, 'document.readyState === "complete"');
  await evaluateValue(browser, sid, 'history.back()');
  await waitForExpression(browser, sid, 'document.readyState === "complete" && location.pathname === "/index.html"', { timeoutMs: 10000 });
  const backLang = await evaluateValue(browser, sid, 'document.documentElement.getAttribute("lang")');
  const keyboardBack = { name: 'keyboard-back/be/390', tabFocus: focus, backLang, ok: focus.tag === 'A' && backLang === 'be' };
  results.push(keyboardBack);
  if (!keyboardBack.ok) failingChecks += 1;

  await browser.close();
} finally {
  server.close();
}

fs.writeFileSync(path.join(HERE, 'web', 'results.json'), JSON.stringify(results, null, 1));
// noindex:false on a rendered guide page is the expected value, so the generic
// scan covers the check booleans, the named map/attribution flag and the
// keyboard-back ok; state fields fail only on the explicit WRONG marker.
const isBad = (r) =>
  ['langMatches', 'hasHeading', 'overflowFree', 'imagesNamed', 'controlsNamed', 'mapAttributionPresent', 'ok'].some((k) => r[k] === false) ||
  r.catalogState === 'WRONG' || r.guideState === 'WRONG';
const bad = results.filter(isBad);
console.log(`entries: ${results.length}, failing checks: ${failingChecks}, bad entries: ${bad.length}`);
for (const r of bad) console.log('FAIL', r.name, JSON.stringify(r).slice(0, 240));
process.exit(failingChecks === 0 ? 0 : 1);
