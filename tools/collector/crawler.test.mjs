// Crawler suites (G17.02). Every network byte stays on 127.0.0.1: the pages
// are served by a local fixture server (testkit.startFixtureServer) and the
// crawl pipeline runs through the production fetchPage boundary with a plain
// GET injected (testkit.httpFetchPage) — the browser fetcher (netfetch.mjs)
// is covered separately by its live suite. The six tests named AC1…AC6 are
// the issue's acceptance criteria in order; the proof of AC1 is its revert:
// disabling the same-domain check makes the outside-host fetch assertions
// fail (docs/agent-tasks/collection/G17.02.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCampaign } from './campaign.mjs';
import { ERROR_SERIES_LIMIT, MIN_ARTICLE_PARAGRAPHS, createPoliteness, parseCrawlDetail } from './crawler.mjs';
import { createAuditWriter, fenceHosts, hostAllowed, serializeAuditLine } from './fence.mjs';
import { defaultHandlers, runCampaign } from './runloop.mjs';
import { countRows, enqueueStep, ensureCampaign, openStore, sha256Hex, stepStatusCounts } from './store.mjs';
import { articleHtml, campaignYaml, httpFetchPage, makeTempDir, openCampaignFixture, startFixtureServer, writeCampaignFile } from './testkit.mjs';

const FILLERS = [
  '<p>First filler paragraph with plain text.</p>',
  '<p>Second filler paragraph with plain text.</p>',
  '<p>Third filler paragraph with plain text.</p>',
];

// An article-shaped fixture page: every link gets its own paragraph, padded
// past the article heuristic's minimum so classification never misfires.
function articlePage(title, hrefs = []) {
  return articleHtml({
    title,
    body: [...hrefs.map(([href, text]) => `<p>Read the <a href="${href}">${text}</a> page.</p>`), ...FILLERS],
  });
}

// Shared arrangement: fixture server + campaign on it + a run() bound to the
// production pipeline with the test fetchPage. Default politeness is fast;
// the AC5 test overrides delay_s.
async function crawlSetup(routes, { overrides = {}, fetchPage = httpFetchPage } = {}) {
  const server = await startFixtureServer(routes);
  const dir = makeTempDir();
  const { file, source, parsed, db } = openCampaignFixture(
    dir,
    campaignYaml({
      seeds: `seeds:\n  - ${server.url('/start')}`,
      delay_s: 'delay_s: [0.05, 0.1]',
      youtube: 'youtube: []',
      ...overrides,
    })
  );
  const snapshotsRoot = path.join(dir, 'snapshots');
  const handlers = defaultHandlers({ fetchPage });
  const fx = {
    server,
    dir,
    db,
    handlers,
    snapshotsRoot,
    run: (campaign = parsed.campaign) =>
      runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), snapshotsRoot, handlers }),
    auditPath: (campaignId) => path.join(snapshotsRoot, campaignId.slice(0, 12), 'fence-audit.jsonl'),
    auditText: (campaignId) => fs.readFileSync(path.join(snapshotsRoot, campaignId.slice(0, 12), 'fence-audit.jsonl'), 'utf8'),
    recordUrls: () => db.prepare('SELECT url FROM raw_records ORDER BY url').all().map((row) => row.url),
  };
  return fx;
}

test('AC1: the audit log shows 0 fetches outside allowed hosts; denied URLs are logged, never fetched', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [
      ['/internal', 'an internal article'],
      ['https://portal.example/outside', 'an outside link'],
    ]),
    '/internal': articlePage('Internal', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/internal'), fx.server.url('/start')].sort());

  const audit = fx.auditText(run.campaignId);
  assert.ok(
    audit.includes('{"url": "https://portal.example/outside", "decision": "denied", "fetched": false}'),
    `denied line missing in:\n${audit}`
  );
  // The pilot criterion as a grep over every line: no denied URL was ever
  // fetched, and every fetched URL sits on the fixture host.
  for (const line of audit.trimEnd().split('\n').map((line) => JSON.parse(line))) {
    assert.ok(!(line.decision === 'denied' && line.fetched === true), `fence breach: ${line}`);
    if (line.fetched === true) {
      assert.ok(line.url.startsWith(`http://127.0.0.1:${fx.server.port}/`), `fetched outside the fence: ${line}`);
    }
  }
});

test('AC2: a page 4 hops from the seed is not fetched', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [['/h1', 'hop one']]),
    '/h1': articlePage('Hop one', [['/h2', 'hop two']]),
    '/h2': articlePage('Hop two', [['/h3', 'hop three']]),
    '/h3': articlePage('Hop three', [['/h4', 'hop four']]),
    '/h4': articlePage('Hop four', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/h1'), fx.server.url('/h2'), fx.server.url('/h3'), fx.server.url('/start')].sort());

  const hops = fx.db.prepare("SELECT ref, status FROM run_log WHERE kind = 'crawl' ORDER BY ref").all();
  assert.deepEqual(
    hops.map((row) => row.ref),
    [fx.server.url('/h1'), fx.server.url('/h2'), fx.server.url('/h3')],
    'the depth-4 page is not even queued'
  );
  const audit = fx.auditText(run.campaignId);
  assert.ok(audit.includes(`{"url": "${fx.server.url('/h4')}", "decision": "allowed", "fetched": false}`));
  assert.ok(!audit.includes(`"${fx.server.url('/h4')}", "decision": "allowed", "fetched": true`));
});

test('AC3: a nav-only page is marked skipped, an article page is snapshotted', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [['/nav', 'the menu'], ['/article', 'the article']]),
    '/nav': articleHtml({
      title: 'Site menu',
      body: ['<p>Choose a section: <a href="/start">home</a>.</p>'],
    }),
    '/article': articlePage('The article', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/article'), fx.server.url('/start')].sort());

  const nav = fx.db.prepare('SELECT status, detail FROM run_log WHERE ref = ?').get(fx.server.url('/nav'));
  assert.equal(nav.status, 'done');
  assert.match(nav.detail, /skipped: 1 paragraph\(s\) < 3 — not an article page/);
});

test('AC3: a page without any paragraph text is skipped by the heuristic, not failed as corrupt', async (t) => {
  const fx = await crawlSetup({
    '/start':
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <title>Site menu</title>\n</head>\n' +
      '<body>\n  <ul>\n    <li><a href="/nowhere">section</a></li>\n  </ul>\n</body>\n</html>\n',
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0);
  assert.equal(fx.recordUrls().length, 0, 'no snapshot for a nav-only page');
  const seed = fx.db.prepare("SELECT status, detail FROM run_log WHERE kind = 'seed'").get();
  assert.equal(seed.status, 'done');
  assert.match(seed.detail, /skipped: nav-only page — no paragraph text/);
});

test('AC4: N consecutive fetch failures stop the run with a diagnostic; the queue resumes', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [
      ['/a', 'first'],
      ['/b', 'second'],
      ['/c', 'third'],
      ['/d', 'fourth'],
    ]),
    // /a, /b, /c are absent → 404; /d exists.
    '/d': articlePage('Fourth', []),
  });
  t.after(() => fx.server.close());

  const first = await fx.run();
  assert.equal(first.done, 1, 'only the seed completed');
  assert.equal(first.failed, ERROR_SERIES_LIMIT);
  assert.match(first.stopped, new RegExp(`error series: ${ERROR_SERIES_LIMIT} consecutive fetch failures, last at ${fx.server.url('/c')} \\(HTTP 404\\)`));
  assert.deepEqual(stepStatusCounts(fx.db, first.campaignId), { done: 1, failed: 3, pending: 1 });

  // Resume, not restart: completed steps are not re-executed, failed steps are
  // not re-claimed, the one still pending is processed.
  const second = await fx.run();
  assert.equal(second.done, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.stopped, null);
  assert.deepEqual(stepStatusCounts(fx.db, first.campaignId), { done: 2, failed: 3 });
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/d'), fx.server.url('/start')].sort());
});

test('AC5: timestamps of two consecutive requests to the same host differ by at least the minimum delay', async (t) => {
  const fx = await crawlSetup(
    {
      '/start': articlePage('Start', [['/second', 'the next page']]),
      '/second': articlePage('Second', []),
    },
    { overrides: { delay_s: 'delay_s: [0.25, 0.4]' } }
  );
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.equal(fx.server.requests.length, 2);
  const gap = fx.server.requests[1].at - fx.server.requests[0].at;
  assert.ok(gap >= 250, `second request arrived after ${gap}ms, minimum is 250ms`);
});

test('AC6: every fetched article page produces a raw_records row through the G17.01.b snapshot writer', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [['/second', 'the next page']]),
    '/second': articlePage('Second', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  const rows = fx.db.prepare('SELECT * FROM raw_records ORDER BY url').all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.source_type, 'web');
    assert.equal(row.rights, 'research_only', 'news/web sources are research_only per docs/24');
    assert.equal(row.city, 'gdansk');
    assert.deepEqual(JSON.parse(row.topics), ['history']);
    assert.equal(row.status, 'raw');
    assert.ok(row.content_hash);
    assert.ok(row.snapshot_path);
    assert.ok(fs.existsSync(path.join(row.snapshot_path, 'snapshot.html')));
    assert.ok(fs.existsSync(path.join(row.snapshot_path, 'text.md')));
    const metadata = JSON.parse(fs.readFileSync(path.join(row.snapshot_path, 'metadata.json'), 'utf8'));
    assert.equal(metadata.author, 'Jan Kowalski');
  }
  // The discovered link was persisted by the snapshot writer (links table) —
  // the G17.01.b path, not a crawl-side side channel. The temporary database
  // holds only this campaign, so an unfiltered count is the campaign's count.
  assert.equal(countRows(fx.db, 'links'), 1);
});

test('a redirect outside the fence is audited as a breach and its content discarded', async (t) => {
  const dir = makeTempDir();
  const file = writeCampaignFile(dir, campaignYaml({ seeds: 'seeds:\n  - https://news.example/start', youtube: 'youtube: []' }));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  // The fake fetcher plays the browser: the fetch itself succeeds, but the
  // response URL is another host — the redirect re-check must refuse it.
  const handlers = defaultHandlers({
    fetchPage: async () => ({ html: articleHtml(), finalUrl: 'https://portal.example/redirected' }),
  });
  const run = await runCampaign(db, parsed.campaign, {
    sourcePath: file,
    contentHash: sha256Hex(source),
    snapshotsRoot: path.join(dir, 'snapshots'),
    handlers,
  });
  assert.equal(run.done, 0);
  assert.equal(run.failed, 1);
  const step = db.prepare("SELECT error FROM run_log WHERE kind = 'seed'").get();
  assert.match(step.error, /redirected outside the fence to https:\/\/portal\.example\/redirected/);
  assert.equal(countRows(db, 'raw_records', run.campaignId), 0, 'the redirected content is not snapshotted');
  const audit = fs
    .readFileSync(path.join(dir, 'snapshots', run.campaignId.slice(0, 12), 'fence-audit.jsonl'), 'utf8');
  assert.ok(audit.includes('{"url": "https://portal.example/redirected", "decision": "denied", "fetched": true}'));
});

test('a discovered URL that is already registered is skipped without refetching', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', [['/loop', 'the loop page']]),
    '/loop': articlePage('Loop', [['/start', 'back to the seed']]),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/loop'), fx.server.url('/start')].sort());
  assert.equal(fx.server.requests.length, 2, '/start was fetched once — by its seed step, not again');
  const back = fx.db.prepare("SELECT status, detail FROM run_log WHERE kind = 'crawl' AND ref = ?").get(fx.server.url('/start'));
  assert.equal(back.status, 'done');
  assert.match(back.detail, /skipped: URL already registered/);
  assert.ok(fx.auditText(run.campaignId).includes(`{"url": "${fx.server.url('/start')}", "decision": "allowed", "fetched": false}`));
});

test('a crawl step with corrupt detail fails with a diagnostic, not a crash', async (t) => {
  const dir = makeTempDir();
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  const file = writeCampaignFile(dir, campaignYaml({ seeds: `seeds:\n  - file://${page}` }));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  const first = await runCampaign(db, parsed.campaign, {
    sourcePath: file,
    contentHash: sha256Hex(source),
    snapshotsRoot: path.join(dir, 'snapshots'),
  });
  assert.equal(first.failed, 0);

  enqueueStep(db, first.campaignId, 'crawl', 'https://news.example/broken', new Date().toISOString(), 'not-json{');
  const second = await runCampaign(db, parsed.campaign, {
    sourcePath: file,
    contentHash: sha256Hex(source),
    snapshotsRoot: path.join(dir, 'snapshots'),
  });
  assert.equal(second.failed, 1);
  const step = db.prepare("SELECT error FROM run_log WHERE kind = 'crawl'").get();
  assert.match(step.error, /crawl step https:\/\/news\.example\/broken: corrupt detail/);
});

test('fence: exact-host allow, subdomain refusal, extra_domains widening, garbage refusal', () => {
  const campaign = { seeds: ['https://news.example/a'], fence: { extra_domains: ['commons.wikimedia.org'] } };
  const hosts = fenceHosts(campaign);
  assert.ok(hostAllowed('https://news.example/a', hosts));
  assert.ok(hostAllowed('http://news.example:8080/b', hosts), 'the fence compares hostnames, not ports');
  assert.equal(hostAllowed('https://sub.news.example/a', hosts), false, 'a subdomain is a different host — fail closed');
  assert.ok(hostAllowed('https://commons.wikimedia.org/wiki/Gdansk', hosts));
  assert.equal(hostAllowed('https://portal.example/a', hosts), false);
  assert.equal(hostAllowed('not a url', hosts), false);
});

test('fence audit lines are literal-grep friendly: pinned order, single space, JSON-escaped url', () => {
  assert.equal(
    serializeAuditLine({ url: 'https://a.example/x', decision: 'denied', fetched: false }),
    '{"url": "https://a.example/x", "decision": "denied", "fetched": false}'
  );
  const parsed = JSON.parse(serializeAuditLine({ url: 'https://a.example/"quoted", path', decision: 'allowed', fetched: true }));
  assert.deepEqual(Object.keys(parsed), ['url', 'decision', 'fetched']);
  assert.equal(parsed.url, 'https://a.example/"quoted", path');
});

test('fence audit writer appends one JSONL line per event', () => {
  const file = path.join(makeTempDir(), 'nested', 'fence-audit.jsonl');
  const audit = createAuditWriter(file);
  audit({ url: 'https://a.example/1', decision: 'allowed', fetched: true });
  audit({ url: 'https://b.example/2', decision: 'denied', fetched: false });
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '{"url": "https://a.example/1", "decision": "allowed", "fetched": true}\n' +
      '{"url": "https://b.example/2", "decision": "denied", "fetched": false}\n'
  );
});

test('politeness: the same host waits, a different host does not', async () => {
  const waits = [];
  // Controlled clock: request starts at t=0 and t=100 — the wait is derived
  // from the recorded start, not from wall-clock gaps between the calls.
  let tick = 0;
  const gate = createPoliteness([1, 2], {
    sleep: async (ms) => waits.push(ms),
    now: () => (tick++ < 2 ? tick * 100 : 10 ** 12),
  });
  await gate('a.example');
  await gate('a.example');
  assert.equal(waits.length, 1, 'the second same-host request waited');
  assert.ok(waits[0] > 900 && waits[0] <= 2000, `wait ${waits[0]}ms is inside [1, 2]s`);
  await gate('b.example');
  assert.equal(waits.length, 1, 'another host is not delayed');
});

test('crawl detail: valid and corrupt work orders', () => {
  const step = { ref: 'https://news.example/x', detail: '{"depth": 2}' };
  assert.deepEqual(parseCrawlDetail(step), { depth: 2 });
  for (const detail of ['not-json{', '{"depth": "two"}', '{"depth": -1}', '{"no_depth": 1}', 'null']) {
    assert.throws(() => parseCrawlDetail({ ref: 'https://news.example/x', detail }), /corrupt detail/, detail);
  }
});

test('the article heuristic threshold is what the diagnostics quote', () => {
  assert.equal(MIN_ARTICLE_PARAGRAPHS, 3);
  assert.equal(ERROR_SERIES_LIMIT, 3);
});
