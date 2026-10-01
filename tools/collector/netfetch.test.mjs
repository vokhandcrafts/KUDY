// Suites for the browser fetcher (netfetch.mjs). The live tests run real
// chromium against the local fixture server — still no external network — and
// skip with a visible reason when the browser binary is not installed (CI
// installs the playwright npm package but not the browser; implementation-rules
// 7). The G17.19 fake-start tests pin the launch options through the module
// seam (a fake playwright loader) and need no browser at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBrowserFetchPage } from './netfetch.mjs';
import { TOR_SOCKS5_PROXY } from './transport.mjs';
import { articleHtml, makeTempDir, skipWithoutBrowser, startFixtureServer } from './testkit.mjs';

test('live: the browser fetcher downloads a fixture page through chromium', async (t) => {
  if (!(await skipWithoutBrowser(t))) return;
  const server = await startFixtureServer({ '/live': articleHtml() });
  t.after(() => server.close());
  const fetcher = await createBrowserFetchPage();
  t.after(() => fetcher.close());

  const { html, finalUrl } = await fetcher.fetchPage(server.url('/live'));
  assert.match(html, /<title>Gdansk shipyard turns into a museum<\/title>/);
  assert.equal(finalUrl, server.url('/live'));
});

test('live: HTTP 404 rejects with a named diagnostic', async (t) => {
  if (!(await skipWithoutBrowser(t))) return;
  const server = await startFixtureServer({});
  t.after(() => server.close());
  const fetcher = await createBrowserFetchPage();
  t.after(() => fetcher.close());

  await assert.rejects(fetcher.fetchPage(server.url('/absent')), /HTTP 404/);
});

test('live: a campaign browser_user_data_dir launches a persistent context', async (t) => {
  if (!(await skipWithoutBrowser(t))) return;
  const server = await startFixtureServer({ '/live': articleHtml() });
  t.after(() => server.close());
  const dir = makeTempDir();
  const profile = path.join(dir, 'profile');
  const fetcher = await createBrowserFetchPage({ userDataDir: profile });
  t.after(() => fetcher.close());

  const { html } = await fetcher.fetchPage(server.url('/live'));
  assert.match(html, /Gdansk shipyard/);
  assert.ok(fs.existsSync(profile), 'chromium created the user-data dir — the login session would persist there');
});

// G17.19: the tor transport's launch options, pinned through the module seam
// — a fake playwright loader records exactly the options a real chromium
// launch would receive (criterion 3's fake browser start; no browser needed).
function fakePlaywright(recorder) {
  const marker = path.join(makeTempDir(), 'chromium-bin');
  fs.writeFileSync(marker, '');
  const context = {
    newPage: async () => ({ goto: async () => ({ status: () => 200, url: () => 'http://fixture/ok', text: () => '' }), close: async () => {} }),
    close: async () => {},
  };
  return {
    marker,
    playwright: {
      chromium: {
        executablePath: () => marker,
        launch: async (options) => {
          recorder.push({ kind: 'launch', options });
          return context;
        },
        launchPersistentContext: async (userDataDir, options) => {
          recorder.push({ kind: 'persistent', userDataDir, options });
          return context;
        },
      },
    },
  };
}

test('AC3 (G17.19): the tor transport starts the browser with the SOCKS5 proxy and DNS through it', async () => {
  const recorder = [];
  const { playwright } = fakePlaywright(recorder);
  const fetcher = await createBrowserFetchPage({
    proxyUrl: TOR_SOCKS5_PROXY,
    loadPlaywright: async () => playwright,
  });

  assert.equal(recorder[0].kind, 'launch');
  assert.deepEqual(recorder[0].options.proxy, { server: 'socks5://127.0.0.1:9050' });
  assert.ok(
    recorder[0].options.args.some((arg) => arg.startsWith('--host-resolver-rules=MAP * ~NOTFOUND')),
    'local DNS is forbidden — hostnames resolve through the proxy'
  );
  await fetcher.close();
});

test('AC3 (G17.19): the tor proxy options ride the persistent context too (login profile + Tor)', async () => {
  const recorder = [];
  const { playwright, marker } = fakePlaywright(recorder);
  const fetcher = await createBrowserFetchPage({
    userDataDir: path.join(makeTempDir(), 'profile'),
    proxyUrl: TOR_SOCKS5_PROXY,
    loadPlaywright: async () => playwright,
  });

  assert.equal(recorder[0].kind, 'persistent');
  assert.deepEqual(recorder[0].options.proxy, { server: 'socks5://127.0.0.1:9050' });
  assert.ok(fs.existsSync(marker));
  await fetcher.close();
});

test('AC2 (G17.19): the direct transport starts the browser without any proxy options', async () => {
  const recorder = [];
  const { playwright } = fakePlaywright(recorder);
  const fetcher = await createBrowserFetchPage({ loadPlaywright: async () => playwright });

  assert.deepEqual(recorder[0].options, { headless: true }, 'no proxy key, no resolver rules — today\'s behavior');
  await fetcher.close();
});

test('AC6 (G17.19): a navigation failure under tor carries the tor-down hint', async () => {
  const recorder = [];
  const { playwright } = fakePlaywright(recorder);
  // The fake page's navigation rejects like a dead SOCKS5 target would.
  playwright.chromium.launch = async () => ({
    newPage: async () => ({ goto: async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED'); }, close: async () => {} }),
    close: async () => {},
  });
  const fetcher = await createBrowserFetchPage({
    proxyUrl: TOR_SOCKS5_PROXY,
    loadPlaywright: async () => playwright,
  });

  await assert.rejects(fetcher.fetchPage('http://news.example/page'), /net::ERR_PROXY_CONNECTION_FAILED.*tor daemon/s);
});
