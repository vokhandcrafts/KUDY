// The production page fetcher (G17.02): Playwright chromium — a real browser
// for JavaScript-rendered pages, docs/24_web_collection.md «Калектары → Паўзук
// па сайтах». Created lazily on the first network URL, so file://-only
// campaigns and tests never load playwright at all; tests drive the crawl
// pipeline through an injected fetchPage against local fixture servers
// (testkit.mjs) and the live suite covers this module when a browser is
// installed. Live runs stay manual; no credentials are ever stored here —
// an optional browser_user_data_dir reuses the author's own logged-in profile.
//
// G17.19: under the Tor transport (proxyUrl, transport.mjs) chromium starts
// with the SOCKS5 proxy and a host-resolver rule that forbids local DNS —
// hostnames resolve through the proxy, never via the local resolver (the
// canonical Tor recipe for chromium; 127.0.0.1 stays excluded so fixture
// servers and a local dispatcher keep working). Navigation-level failures
// (proxy connect, DNS) carry the tor-down hint; site-level failures
// (HTTP ≥ 400) mean the proxy worked and keep their plain message.
import fs from 'node:fs';
import { torDownDiagnostic } from './transport.mjs';

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
// diagnostic and count toward the crawl error series. The network-path guard
// (netguard.mjs) runs at address selection, before a URL is handed here; the
// browser resolves and connects itself, so a DNS rebinding between that
// lookup and the page's own connection stays uncovered (out of scope, G17.16).
// loadPlaywright is the module seam for the fake-start tests: the fake loader
// records the launch options a real chromium would receive.
export async function createBrowserFetchPage({
  userDataDir = null,
  proxyUrl = null,
  loadPlaywright: loadModule = loadPlaywright,
} = {}) {
  const playwright = await loadModule();
  const executable = playwright.chromium.executablePath();
  if (!fs.existsSync(executable)) {
    throw new Error(`chromium binary is missing at ${executable} — run: npx playwright install chromium`);
  }
  const launchOptions = { headless: true };
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
    launchOptions.args = ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
  }
  const context = userDataDir
    ? await playwright.chromium.launchPersistentContext(userDataDir, launchOptions)
    : await playwright.chromium.launch(launchOptions);
  return {
    async fetchPage(url) {
      const page = await context.newPage();
      try {
        let response;
        try {
          // 'load' — the document and its subresources are in; a JS page's own
          // fetches may continue, but the heuristic works on what a browser has
          // at load time rather than risk a never-idling SPA timeout.
          response = await page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT_MS });
        } catch (error) {
          if (proxyUrl) throw torDownDiagnostic(error);
          throw error;
        }
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
