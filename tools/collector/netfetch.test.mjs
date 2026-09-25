// Live suite for the browser fetcher (netfetch.mjs): real chromium against
// the local fixture server — still no external network. Skips with a visible
// reason when the browser binary is not installed (CI installs the playwright
// npm package but not the browser; implementation-rules 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBrowserFetchPage } from './netfetch.mjs';
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
