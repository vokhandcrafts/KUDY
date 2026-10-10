// G23.02 web E2E harness (issue #660): serves the static export (web/out)
// and drives one locked-down CDP page over it. The server resolves URLs
// with the web zone's own containment idiom (test-browser/map-harness-server
// .mjs containedPath — the web zone is closed, no tools import) and adds the
// two facts of a Next static export a generic server does not know: a clean
// URL resolves to its .html file, and an unknown URL serves the exported
// 404.html with a 404 status — the not-found page a visitor sees is what the
// suite asserts.
// The page lockdown is acceptance criterion 7: every non-localhost request
// fails through the CDP Fetch domain and is recorded, and an uncaught page
// exception is recorded too — both fail the case through assertCleanJourney,
// never silently. A suite that cannot run skips visibly from withE2ePage
// (implementation-rules 7): no web/out build, or no browser binary.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { findChromiumBinary, launchBrowser, evaluateValue } from './cdp-browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The static export the journeys run against; run-e2e.mjs produces it.
export function webOutRoot() {
  return path.resolve(HERE, '..', 'out');
}

export function webOutAvailable() {
  return fs.existsSync(path.join(webOutRoot(), 'index.html'));
}

// Readers of the served publication tree — the single source the journeys
// assert against. The discovery index resolves through the served catalog
// pointer, the same chain the site data layer uses (site.ts readSiteCatalog).
export function servedContent(...parts) {
  return JSON.parse(fs.readFileSync(path.join(webOutRoot(), 'content', ...parts), 'utf8'));
}

export function discoveryIndex() {
  const catalog = servedContent('catalog.json');
  return servedContent(...catalog.discovery_index.path.split('/'));
}

// Next's static export writes one .html file per page (no trailing-slash
// directories) plus the shared 404.html at the root. Every candidate is
// resolved through the containment check, so a tampered URL can never leave
// the export root (implementation-rules 3: the repo idiom, same spelling as
// map-harness-server.mjs containedPath).
function containedPath(root, relative) {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

const E2E_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

function resolveExportFile(root, pathname) {
  // Malformed percent-encoding is a plain 404, never a thrown error
  // (implementation-rules 14: corrupt input yields a diagnostic path).
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Root-relative names only: path.resolve treats a leading '/' as absolute
  // and the containment would never hold (the slice is what keeps the
  // request inside the export root).
  const relative = decoded.replace(/^\/+/, '');
  const trimmed = relative.replace(/\/+$/, '');
  const candidates = trimmed === '' ? ['index.html'] : [trimmed, `${trimmed}.html`, `${trimmed}/index.html`];
  for (const candidate of candidates) {
    if (candidate === '' || candidate.includes('\0')) continue;
    const file = containedPath(root, candidate);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return { file, status: 200 };
  }
  const notFound = containedPath(root, '404.html');
  return notFound && fs.existsSync(notFound) ? { file: notFound, status: 404 } : null;
}

export function startE2eSiteServer(outRoot = webOutRoot()) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const resolved = resolveExportFile(outRoot, pathname);
    if (!resolved) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found (no exported 404.html)');
      return;
    }
    response.writeHead(resolved.status, {
      'content-type': E2E_MIME[path.extname(resolved.file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(fs.readFileSync(resolved.file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

// One journey over one browser page. Every case in the suite runs through
// this wrapper: it owns the server/browser lifecycle, the network lockdown
// and the error collectors, so no test file restates any of it (jscpd gate).
// - goto(path): navigates and waits for the new document by pathname — the
//   readyState of the previous document must never satisfy the wait.
// - waitForPath(path): the same wait after an in-page activation (keyboard).
// - keys(presses): raw Tab/Enter key events through the Input domain.
export async function withE2ePage(t, run) {
  if (!webOutAvailable()) {
    t.skip('web/out static build is missing — run `npm run e2e:web` (it builds the synthetic origin and the site, then this suite)');
    return;
  }
  const chromium = findChromiumBinary();
  if (!chromium) {
    t.skip('no Chromium binary on this host (set KUDY_CHROMIUM to the browser path)');
    return;
  }
  const server = await startE2eSiteServer();
  const browser = await launchBrowser(chromium, [
    // AC1 drives the audio element like a visitor tap; headless Chromium
    // would otherwise reject play() by autoplay policy before it plays.
    '--autoplay-policy=no-user-gesture-required',
    // The host's Chromium may carry system extensions whose injected page
    // scripts would count as external requests under the lockdown — the
    // journey must assert the site's own behaviour, deterministically.
    '--disable-extensions',
  ]);
  try {
    const page = await browser.newPage();
    await browser.send('Page.enable', {}, page);
    await browser.send('Runtime.enable', {}, page);
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, page);

    const pageErrors = [];
    const blockedRequests = [];
    // A fast navigation can cancel a paused request before its resume is
    // delivered; Chromium then rejects the resume with Invalid
    // InterceptionId. Such a request never reached the network either way —
    // not a lockdown escape — so the recorded verdict stays authoritative
    // and the stale resume is dropped instead of failing the journey.
    const resumeFetch = (method, params) =>
      browser.send(method, params, page).catch((error) => {
        if (!/Invalid InterceptionId/.test(String(error?.message))) throw error;
      });
    browser.onEvent((method, params, sessionId) => {
      if (sessionId !== page) return;
      if (method === 'Fetch.requestPaused') {
        const url = new URL(params.request.url);
        const local = (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === String(server.port);
        if (local) {
          void resumeFetch('Fetch.continueRequest', { requestId: params.requestId });
        } else {
          // AC7: non-localhost is blocked by the client and recorded — the
          // case fails on the record, the page just sees a network error.
          blockedRequests.push(params.request.url);
          void resumeFetch('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
        }
      }
      if (method === 'Runtime.exceptionThrown') {
        const detail = params.exceptionDetails ?? {};
        pageErrors.push(detail.exception?.description ?? detail.text ?? 'unknown page exception');
      }
    });

    const atPath = async (pathname, deadline) => {
      for (;;) {
        try {
          const ok = await evaluateValue(
            browser,
            page,
            `document.readyState === 'complete' && location.pathname === ${JSON.stringify(pathname)}`,
          );
          if (ok) return;
        } catch {
          // the execution context is destroyed mid-navigation — keep polling
        }
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${pathname}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    const goto = async (pathname) => {
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.port}${pathname}` }, page);
      await atPath(pathname, Date.now() + 20000);
    };
    const waitForPath = (pathname) => atPath(pathname, Date.now() + 20000);
    const press = async (key) => {
      const spec = key === 'Tab'
        ? { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
        : { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' };
      await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...spec }, page);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec }, page);
    };

    await run({ browser, page, port: server.port, goto, waitForPath, press, pageErrors, blockedRequests });
  } finally {
    await browser.close();
    await server.close();
  }
}

// AC7 named end-of-case assertion: zero blocked external requests and zero
// uncaught page exceptions across the whole journey — with the exact URLs
// and exceptions as the failure evidence.
export function assertCleanJourney({ pageErrors, blockedRequests }) {
  assert.deepEqual(blockedRequests, [], 'non-localhost requests were attempted (all must stay on 127.0.0.1)');
  assert.deepEqual(pageErrors, [], 'uncaught page exceptions must never happen');
}
