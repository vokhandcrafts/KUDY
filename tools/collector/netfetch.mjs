// The production page fetcher (G17.02): Playwright chromium — a real browser
// for JavaScript-rendered pages, docs/24_web_collection.md «Калектары → Паўзук
// па сайтах». Created lazily on the first network URL, so file://-only
// campaigns and tests never load playwright at all; tests drive the crawl
// pipeline through an injected fetchPage against local fixture servers
// (testkit.mjs) and the live suite covers this module when a browser is
// installed. Live runs stay manual; no credentials are ever stored here —
// an optional browser_user_data_dir reuses the author's own logged-in profile.
import fs from 'node:fs';

const GOTO_TIMEOUT_MS = 30_000;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'playwright is not installed — the browser fetcher needs: npm install && npx playwright install chromium (file:// campaigns work without it)'
    );
  }
}

// Returns { fetchPage, close }. fetchPage(url) resolves { html, finalUrl } —
// finalUrl is the post-redirect URL, which the crawler re-checks against the
// fence; fetch failures (navigation error, HTTP ≥ 400) reject with a named
// diagnostic and count toward the crawl error series.
export async function createBrowserFetchPage({ userDataDir = null } = {}) {
  const playwright = await loadPlaywright();
  const executable = playwright.chromium.executablePath();
  if (!fs.existsSync(executable)) {
    throw new Error(`chromium binary is missing at ${executable} — run: npx playwright install chromium`);
  }
  const context = userDataDir
    ? await playwright.chromium.launchPersistentContext(userDataDir, { headless: true })
    : await playwright.chromium.launch({ headless: true });
  return {
    async fetchPage(url) {
      const page = await context.newPage();
      try {
        // 'load' — the document and its subresources are in; a JS page's own
        // fetches may continue, but the heuristic works on what a browser has
        // at load time rather than risk a never-idling SPA timeout.
        const response = await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
        if (!response) throw new Error('navigation produced no response');
        if (response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
        return { html: await page.content(), finalUrl: response.url() };
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close();
    },
  };
}
