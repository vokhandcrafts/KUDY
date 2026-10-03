// G21.02 map attribution browser regressions, two strictly separated modes.
//
// Default — deterministic local checks: the static export (web/out) is served
// from 127.0.0.1 and every external request is aborted, so no tile or style
// provider is contacted and the style fetch failure is expected (the page
// reports data-map-error; the MapLibre legal controls exist regardless). The
// assertions cover the stylesheet actually reaching the page (map_css_loaded),
// the computed control positioning and the attribution bounds staying inside
// the map container and clear of the page content at 320/390/1440px
// (map_attribution_bounds).
//
// --live — real-provider proof: needs external network, waits for the fitted
// map (data-map-ready) and asserts the retained provider/license credits and
// accessible links. A failed network ends the run non-zero and must be
// recorded as a limitation, never presented as live proof (G21.02 acceptance
// 3/4).
//
// Usage: node tools/web/map-attribution-regression.mjs [--live] [--shots <dir>]
// Requires a current static export: `npm run build` in web/. Playwright
// resolves from the root node_modules; the chromium binary comes from
// `npx playwright install chromium` (not wired into the standard runner —
// see the collector's loadPlaywright seam for the same pattern).
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../serve-static.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(TOOL_ROOT, '..', '..');
const OUT_DIR = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : join(REPO_ROOT, 'web', 'out');
const SHOTS_DIR = process.argv.includes('--shots')
  ? resolve(process.argv[process.argv.indexOf('--shots') + 1])
  : null;
const LIVE = process.argv.includes('--live');
const WIDTHS = [320, 390, 1440];

const playwright = await import('playwright').catch(() => null);
assert.ok(playwright, 'playwright is not installed — the browser regression needs: npm install && npx playwright install chromium');
const executable = playwright.chromium.executablePath();
assert.ok(existsSync(executable), `chromium binary is missing at ${executable} — run: npx playwright install chromium`);
assert.ok(existsSync(join(OUT_DIR, 'map.html')), `web/out/map.html is missing (${OUT_DIR}) — run \`npm run build\` in web/ first`);

if (SHOTS_DIR) await mkdir(SHOTS_DIR, { recursive: true });
const server = createStaticServer(OUT_DIR);
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await playwright.chromium.launch();
const failures = [];
const summary = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  let blockedExternal = 0;
  if (!LIVE) {
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith(base)) return route.continue();
      blockedExternal += 1;
      return route.abort();
    });
  }
  try {
    await page.goto(`${base}/map.html`, { waitUntil: 'load' });
    await page.waitForSelector('[role="region"]', { timeout: 20000 });
    if (LIVE) {
      await page.waitForSelector('[data-map-ready="fitted"]', { timeout: 60000 });
    } else {
      // The style fetch is aborted by design; wait for the reported failure so
      // the control layout below is observed in the settled state.
      await page.waitForSelector('[role="region"][data-map-error]', { timeout: 20000 });
    }
    await page.waitForTimeout(500);

    const probe = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const inside = (inner, outer, tolerance = 1) =>
        inner && outer &&
        inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
        inner.x + inner.w <= outer.x + outer.w + tolerance &&
        inner.y + inner.h <= outer.y + outer.h + tolerance;
      const disjoint = (a, b, tolerance = 1) =>
        !a || !b || a.x + a.w <= b.x + tolerance || b.x + b.w <= a.x + tolerance ||
        a.y + a.h <= b.y + tolerance || b.y + b.h <= a.y + tolerance;
      const container = document.querySelector('[role="region"]');
      const attrib = document.querySelector('.maplibregl-ctrl-attrib');
      const bottomRight = document.querySelector('.maplibregl-ctrl-bottom-right');
      const cssLoaded = [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => rule.selectorText?.includes('maplibregl-ctrl-attrib'));
        } catch {
          return false;
        }
      });
      const anchor = bottomRight ? getComputedStyle(bottomRight) : null;
      const paragraphs = [...document.querySelectorAll('p')];
      const osmPara = paragraphs.find((p) => p.querySelector('a[href*="openstreetmap.org/copyright"]'));
      const routesList = [...document.querySelectorAll('ul')].at(-1);
      return {
        mapReady: container?.dataset.mapReady ?? null,
        mapError: container?.dataset.mapError ?? null,
        cssLoaded,
        anchored: Boolean(anchor) && anchor.position === 'absolute' && anchor.bottom === '0px' && anchor.right === '0px',
        attribRect: rect(attrib),
        containerRect: rect(container),
        attribInsideContainer: inside(rect(attrib), rect(container)),
        clearOfHeading: disjoint(rect(attrib), rect(document.querySelector('h1'))),
        clearOfOsmParagraph: disjoint(rect(attrib), rect(osmPara)),
        clearOfRoutesList: disjoint(rect(attrib), rect(routesList)),
        attributionText: attrib ? attrib.textContent.trim().replace(/\s+/g, ' ') : null,
        attributionLinks: attrib ? [...attrib.querySelectorAll('a')].map((a) => a.href) : [],
      };
    });

    // map_css_loaded: the pinned stylesheet reached the page through the build.
    assert.ok(probe.cssLoaded, 'no loaded stylesheet defines the MapLibre attribution rules (map_css_loaded)');
    // Required computed positioning: the legal-controls anchor is absolutely
    // positioned bottom-right inside the map container.
    assert.ok(probe.anchored, 'the attribution anchor is not absolutely positioned bottom-right in the map container');
    // map_attribution_bounds: the attribution stays inside the map container
    // and clear of the page content at every width.
    assert.ok(probe.attribRect, 'the attribution control is not in the DOM');
    assert.ok(probe.attribInsideContainer, `attribution bounds ${JSON.stringify(probe.attribRect)} leave the map container ${JSON.stringify(probe.containerRect)}`);
    assert.ok(probe.clearOfHeading, 'attribution overlaps the page heading');
    assert.ok(probe.clearOfOsmParagraph, 'attribution overlaps the server-side ODbL attribution paragraph');
    assert.ok(probe.clearOfRoutesList, 'attribution overlaps the routes list');
    if (LIVE) {
      assert.equal(probe.mapReady, 'fitted', 'the real provider style did not load and fit (no live proof)');
      assert.match(probe.attributionText ?? '', /OpenFreeMap/, 'the OpenFreeMap credit is missing from the loaded map');
      assert.match(probe.attributionText ?? '', /OpenStreetMap/, 'the OpenStreetMap credit is missing from the loaded map');
      assert.ok(
        probe.attributionLinks.some((href) => href.startsWith('https://www.openstreetmap.org/copyright')),
        'the accessible OSM copyright link is missing from the attribution control',
      );
    } else {
      assert.ok(blockedExternal >= 1, 'no external request was seen — the deterministic run did not exercise the provider boundary');
    }
    summary.push({ mode: LIVE ? 'live' : 'deterministic', width, ok: true, probe });
  } catch (error) {
    failures.push({ width, message: error instanceof Error ? error.message : String(error) });
    summary.push({ mode: LIVE ? 'live' : 'deterministic', width, ok: false });
  }
  if (SHOTS_DIR) {
    await page.screenshot({ path: join(SHOTS_DIR, `map-attribution-${LIVE ? 'live' : 'local'}-${width}.png`), fullPage: true });
  }
  await page.close();
}

await browser.close();
server.close();
console.log(JSON.stringify({ mode: LIVE ? 'live' : 'deterministic', widths: WIDTHS, failures, summary }, null, 2));
if (failures.length > 0) {
  console.error(`map-attribution regression failed: ${failures.map((f) => `${f.width}px — ${f.message}`).join('; ')}`);
  process.exitCode = 1;
}
