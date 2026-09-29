// Robots.txt gate suites (G17.15). The parser suites are pure; the gate and
// pipeline suites run the production transport (defaultFetchRobots — a plain
// global fetch) against the local fixture server: robots.txt is served by a
// route like any real host would serve it, so every network byte stays on
// 127.0.0.1. The five tests named AC1…AC5 are the issue's acceptance criteria
// in order; the proof of each is its revert — removing the crawlStep robots
// check turns them red (no robots request, the disallowed page fetched, no
// stop diagnostic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROBOTS_AGENT, parseRobotsTxt } from './robots.mjs';
import { articleHtml, articlePage, crawlSetup } from './testkit.mjs';

test('the collector crawl identity is the one constant the gate and the docs share', () => {
  assert.equal(ROBOTS_AGENT, 'KUDY-collector');
});

test('robots parser: longest matching pattern wins, the * wildcard and the $ anchor work', () => {
  const robots = parseRobotsTxt(
    [
      'User-agent: *',
      'Disallow: /secret',
      'Allow: /secret/public',
      'Disallow: /tmp/*',
      'Disallow: /page$',
    ].join('\n')
  );
  assert.equal(robots.allowed('/secret'), false);
  assert.equal(robots.allowed('/secret/deeper'), false, 'a prefix match blocks the subtree');
  assert.equal(robots.allowed('/secret/public'), true, 'the longer Allow pattern wins');
  assert.equal(robots.allowed('/tmp/x/y'), false, 'the * wildcard spans path parts');
  assert.equal(robots.allowed('/tmp'), true, 'the wildcard needs the literal /tmp/ prefix');
  assert.equal(robots.allowed('/page'), false, 'the $ anchor pins the end');
  assert.equal(robots.allowed('/page/2'), true);
  assert.equal(robots.allowed('/page?x=1'), true, 'the anchor covers the query too');
  assert.equal(robots.allowed('/anything/else'), true, 'unmatched paths are allowed');
});

test('robots parser: an equal-length Allow/Disallow tie resolves permissively', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /x\nAllow: /x');
  assert.equal(robots.allowed('/x'), true);
});

test('robots parser: an empty Disallow and a group without rules mean everything allowed', () => {
  assert.equal(parseRobotsTxt('User-agent: *\nDisallow:').allowed('/x'), true);
  assert.equal(parseRobotsTxt('User-agent: *\n# nothing but comments').allowed('/x'), true);
});

test('robots parser: the own-token group beats the * group; foreign groups and garbage bind nothing', () => {
  const own = parseRobotsTxt(
    ['User-agent: *', 'Disallow: /', '', 'User-agent: kudy-collector', 'Disallow: /only'].join('\n')
  );
  assert.equal(own.allowed('/only'), false, 'the own-token group wins over *');
  assert.equal(own.allowed('/'), true, 'the * group is not merged into the own group');
  assert.equal(parseRobotsTxt('User-agent: Googlebot\nDisallow: /').allowed('/'), true, 'another agent\'s group does not bind us');
  assert.equal(parseRobotsTxt('KUDY-collector\nnot a directive at all').allowed('/'), true, 'garbage text is no rules, not a crash');
});

test('AC1: a robots-disallowed path is never fetched; the audit line carries the reason', async (t) => {
  const fx = await crawlSetup({
    '/robots.txt': 'User-agent: *\nDisallow: /secret',
    '/start': articlePage('Start', [['/secret', 'the forbidden page'], ['/open', 'the allowed page']]),
    '/secret': articlePage('Secret', []),
    '/open': articlePage('Open', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/open'), fx.server.url('/start')].sort());
  const secret = fx.db.prepare('SELECT status, detail FROM run_log WHERE ref = ?').get(fx.server.url('/secret'));
  assert.equal(secret.status, 'done', 'a discovered link\'s refusal is a skip, not a failure');
  assert.match(secret.detail, /skipped: robots\.txt of 127\.0\.0\.1 disallows \/secret — not fetched/);
  assert.ok(
    fx.auditText(run.campaignId).includes(
      `{"url": "${fx.server.url('/secret')}", "decision": "robots-denied", "fetched": false, "reason": "robots.txt of 127.0.0.1 disallows /secret"}`
    ),
    `robots-denied audit line missing in:\n${fx.auditText(run.campaignId)}`
  );
  assert.ok(fx.server.requests.every((r) => r.path !== '/secret'), 'the disallowed path was never requested');
});

test('AC2: missing robots.txt means everything allowed — and the gate really asked', async (t) => {
  const fx = await crawlSetup({
    '/start': articlePage('Start', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/start')]);
  // The 404 answer is read as «everything allowed» — removing the robots gate
  // removes the robots.txt request and turns this assert red.
  assert.deepEqual(fx.server.requests.map((r) => r.path), ['/robots.txt', '/start']);
});

test('AC3: robots.txt with a server error — the host is not visited this run, the audit carries the reason', async (t) => {
  const fx = await crawlSetup({
    '/robots.txt': { status: 500, body: 'boom' },
    '/start': articlePage('Start', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.done, 0);
  assert.equal(run.failed, 1, 'the seed refusal fails the seed step');
  const seed = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'seed'").get();
  assert.match(
    seed.error,
    /robots\.txt of 127\.0\.0\.1 unavailable \(HTTP 500\) — host is not visited this run — seed not fetched/
  );
  assert.equal(fx.recordUrls().length, 0, 'nothing was collected');
  assert.deepEqual(fx.server.requests.map((r) => r.path), ['/robots.txt'], 'no page request reached the host');
  assert.ok(
    fx.auditText(run.campaignId).includes(
      `{"url": "${fx.server.url('/start')}", "decision": "robots-denied", "fetched": false, "reason": "robots.txt of 127.0.0.1 unavailable (HTTP 500) — host is not visited this run"}`
    ),
    `robots-denied audit line missing in:\n${fx.auditText(run.campaignId)}`
  );
});

test('AC4: a campaign whose every seed is robots-blocked stops with a readable diagnostic', async (t) => {
  const fx = await crawlSetup(
    {
      '/robots.txt': 'User-agent: *\nDisallow: /',
      '/one': articlePage('One', []),
      '/two': articlePage('Two', []),
    },
    { overrides: { seeds: (url) => `seeds:\n  - ${url('/one')}\n  - ${url('/two')}` } }
  );
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.done, 0);
  assert.equal(run.failed, 2);
  assert.match(run.stopped, /all 2 http\(s\) seed\(s\) refused by robots\.txt — run stopped, nothing collected/);
  const seeds = fx.db.prepare("SELECT ref, error FROM run_log WHERE kind = 'seed' ORDER BY ref").all();
  assert.deepEqual(seeds.map((row) => row.ref), [fx.server.url('/one'), fx.server.url('/two')]);
  const expectedPaths = ['/one', '/two'];
  for (const [row, pathName] of seeds.map((row, i) => [row, expectedPaths[i]])) {
    assert.match(row.error, new RegExp(`robots\\.txt of 127\\.0\\.0\\.1 disallows ${pathName} — seed not fetched`));
  }
  assert.equal(fx.recordUrls().length, 0, 'an empty run, reported as stopped — never as a success');
  assert.deepEqual(fx.server.requests.map((r) => r.path), ['/robots.txt'], 'no page fetch reached the host');
});

test('a redirect onto a same-host robots-disallowed path is a breach — content discarded, audit says fetched', async (t) => {
  const fx = await crawlSetup(
    {
      '/robots.txt': 'User-agent: *\nDisallow: /secret',
      '/secret': articlePage('Secret', []),
    },
    // The fetcher plays a browser that followed the seed's redirect onto the
    // robots-disallowed path of the same host: the bytes are downloaded, so
    // the finalUrl re-check must discard them and audit the breach.
    { fetchPage: async (url) => ({ html: articleHtml(), finalUrl: url.replace(/\/start$/, '/secret') }) }
  );
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.done, 0);
  assert.equal(run.failed, 1);
  const seed = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'seed'").get();
  assert.match(
    seed.error,
    /redirected to .*\/secret — robots\.txt of 127\.0\.0\.1 disallows \/secret — content discarded/
  );
  assert.equal(fx.recordUrls().length, 0, 'the redirected content is not snapshotted');
  assert.ok(
    fx.auditText(run.campaignId).includes(
      `{"url": "${fx.server.url('/secret')}", "decision": "robots-denied", "fetched": true, "reason": "robots.txt of 127.0.0.1 disallows /secret"}`
    ),
    `robots-denied fetched:true audit line missing in:\n${fx.auditText(run.campaignId)}`
  );
});

test('AC5: robots.txt is fetched once per host per run — the cache spans the run', async (t) => {
  const fx = await crawlSetup({
    '/robots.txt': 'User-agent: *\nDisallow: /none',
    '/start': articlePage('Start', [['/second', 'the next page']]),
    '/second': articlePage('Second', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/second'), fx.server.url('/start')].sort());
  assert.equal(
    fx.server.requests.filter((r) => r.path === '/robots.txt').length,
    1,
    'one robots.txt request for two page fetches of the same host'
  );
});

test('a robots refusal never feeds the error series — three refusals do not stop the run', async (t) => {
  const fx = await crawlSetup({
    '/robots.txt': 'User-agent: *\nDisallow: /s1\nDisallow: /s2\nDisallow: /s3',
    '/start': articlePage('Start', [['/s1', 'one'], ['/s2', 'two'], ['/s3', 'three'], ['/real', 'the real page']]),
    '/s1': articlePage('S1', []),
    '/s2': articlePage('S2', []),
    '/s3': articlePage('S3', []),
    '/real': articlePage('Real', []),
  });
  t.after(() => fx.server.close());

  const run = await fx.run();
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.equal(run.stopped, null);
  assert.deepEqual(fx.recordUrls(), [fx.server.url('/real'), fx.server.url('/start')].sort());
  for (const ref of ['/s1', '/s2', '/s3']) {
    const step = fx.db.prepare('SELECT status, detail FROM run_log WHERE ref = ?').get(fx.server.url(ref));
    assert.equal(step.status, 'done');
    assert.match(step.detail, /skipped: robots\.txt of 127\.0\.0\.1 disallows/);
  }
});
