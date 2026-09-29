// Net-guard suites (G17.16). The unit half pins the refused address space —
// every range the issue names (127.0.0.1, ::1, 10/8, 172.16–31, 192.168/16,
// 169.254/16, 0.0.0.0, fd00::/8) plus the neighbouring reserved blocks, with
// the boundary addresses on the public side. The integration half drives the
// production run loop with campaigns whose seeds point inward: the guard
// refuses before the fetcher is called, the step journal carries the reasons,
// and the run continues. No test touches the network — the resolver is the
// injection seam, and IP literals never resolve at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyAddress, createNetGuard } from './netguard.mjs';
import { defaultHandlers, runCampaign } from './runloop.mjs';
import { countRows, sha256Hex, stepStatusCounts } from './store.mjs';
import { articleHtml, articlePage, campaignYaml, makeTempDir, openCampaignFixture } from './testkit.mjs';

test('classifyAddress refuses the private and reserved ranges by name', () => {
  const cases = [
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['10.0.0.1', 'private (RFC1918)'],
    ['10.255.255.255', 'private (RFC1918)'],
    ['172.16.0.1', 'private (RFC1918)'],
    ['172.31.255.255', 'private (RFC1918)'],
    ['192.168.0.1', 'private (RFC1918)'],
    ['192.168.100.200', 'private (RFC1918)'],
    ['169.254.1.1', 'link-local'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['100.64.0.1', 'reserved'],
    ['198.18.0.9', 'reserved'],
    ['192.0.2.1', 'documentation'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fd00::1', 'unique-local (ULA)'],
    ['fdab:1234::9', 'unique-local (ULA)'],
    ['fc00::', 'unique-local (ULA)'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    // An IPv4-mapped literal is judged by its embedded IPv4 address — the
    // dotted-quad form through the explicit unwrap, the hex form through
    // BlockList's own normalization of mapped addresses.
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:10.1.2.3', 'private (RFC1918)'],
    ['::ffff:7f00:1', 'loopback'],
    // Fail closed on what net cannot parse; a zoned link-local literal is
    // still recognized and named.
    ['fe80::1%eth0', 'link-local'],
    ['not-an-ip', 'unparseable'],
  ];
  for (const [address, reason] of cases) {
    assert.equal(classifyAddress(address), reason, address);
  }
});

test('classifyAddress passes public addresses, boundaries included', () => {
  // The edges of the refused blocks: 172.15/172.32 around the RFC1918
  // 172.16–31 range, 100.63/100.128 around CGNAT 100.64/10.
  const addresses = [
    '93.184.216.34',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '2a00:1450:4001:81b::200e',
  ];
  for (const address of addresses) {
    assert.equal(classifyAddress(address), null, address);
  }
});

test('the guard refuses non-http(s) schemes before resolving anything', async () => {
  const guard = createNetGuard({
    resolve: async () => {
      throw new Error('the resolver must not be called');
    },
  });
  await assert.rejects(() => guard('ftp://files.example/doc.pdf'), /'ftp' is not http\/https — refusing to fetch/);
  await assert.rejects(() => guard('file:///tmp/page.html'), /'file' is not http\/https — refusing to fetch/);
});

test('the guard refuses private literals without touching the resolver', async () => {
  const hosts = ['127.0.0.1', '[::1]', '10.9.8.7', '192.168.1.1', '172.20.0.9', '169.254.169.254', '0.0.0.0', '[fd00::1]'];
  for (const host of hosts) {
    const guard = createNetGuard({
      resolve: async () => {
        throw new Error('the resolver must not be called');
      },
    });
    await assert.rejects(() => guard(`http://${host}/page`), /request not made/, host);
  }
});

test('the guard refuses a host whose resolution touches a private address, even next to public ones', async () => {
  const guard = createNetGuard({
    resolve: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ],
  });
  await assert.rejects(
    () => guard('https://sneaky.example/page'),
    /sneaky\.example resolved to 10\.0\.0\.5, a private \(RFC1918\) address — request not made/
  );
});

test('an unresolvable host is a readable diagnostic, not a crash', async () => {
  const guard = createNetGuard({
    resolve: async () => {
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    },
  });
  await assert.rejects(
    () => guard('https://missing.example/page'),
    /missing\.example did not resolve \(ENOTFOUND\) — request not made/
  );
});

test('a public address passes and the request may proceed', async () => {
  const guard = createNetGuard({ resolve: async () => [{ address: '93.184.216.34', family: 4 }] });
  await assert.doesNotReject(() => guard('https://news.example/gdansk'));
  await assert.doesNotReject(() => guard('http://93.184.216.34/page'));
});

test('an unparseable URL is refused', async () => {
  const guard = createNetGuard({ resolve: async () => [{ address: '93.184.216.34', family: 4 }] });
  await assert.rejects(() => guard('not a url at all'), /does not parse/);
});

// The campaign-driven half: runCampaign with the production handlers, only
// the resolver replaced (tests never touch the network) and the fetcher
// replaced by a spy. The seed YAML is the only arranged difference between
// these suites and the passing baseline (implementation-rules 14).
function campaignSetup(yamlText) {
  const dir = makeTempDir();
  const { file, source, parsed, db } = openCampaignFixture(dir, yamlText);
  return { dir, db, file, source, campaign: parsed.campaign, snapshotsRoot: path.join(dir, 'snapshots') };
}

const publicResolve = async () => [{ address: '93.184.216.34', family: 4 }];

test('a campaign with loopback and private seeds: no request is made, the run continues', async () => {
  const fx = campaignSetup(
    campaignYaml({ seeds: 'seeds:\n  - http://127.0.0.1/start\n  - http://10.1.2.3/mid' })
  );
  let fetchCalls = 0;
  const handlers = defaultHandlers({
    fetchPage: async () => {
      fetchCalls += 1;
      throw new Error('the guard must stand before any fetch');
    },
  });
  const run = await runCampaign(fx.db, fx.campaign, {
    sourcePath: fx.file,
    contentHash: sha256Hex(fx.source),
    snapshotsRoot: fx.snapshotsRoot,
    handlers,
  });
  assert.equal(fetchCalls, 0, 'the fetcher was never reached');
  assert.equal(run.stopped, null, 'two refusals do not reach the error-series stop');
  assert.deepEqual(stepStatusCounts(fx.db, run.campaignId), { failed: 2 });
  const errors = fx.db.prepare("SELECT ref, error FROM run_log WHERE status = 'failed'").all();
  assert.match(errors.find((row) => row.ref === 'http://127.0.0.1/start').error, /crawl http:\/\/127\.0\.0\.1\/start: net guard: 127\.0\.0\.1 is a loopback address — request not made/);
  assert.match(errors.find((row) => row.ref === 'http://10.1.2.3/mid').error, /crawl http:\/\/10\.1\.2\.3\/mid: net guard: 10\.1\.2\.3 is a private \(RFC1918\) address — request not made/);
  assert.equal(countRows(fx.db, 'raw_records'), 0, 'nothing was snapshotted');
  assert.equal(
    fs.existsSync(path.join(fx.snapshotsRoot, run.campaignId.slice(0, 12), 'fence-audit.jsonl')),
    false,
    'the fence audit records fence decisions — a guard refusal is not one'
  );
});

test('an unresolvable seed fails with a readable diagnostic; a public seed still collects as before', async () => {
  const fx = campaignSetup(
    campaignYaml({ seeds: 'seeds:\n  - https://missing.example/start\n  - https://news.example/second' })
  );
  const fetched = [];
  const handlers = defaultHandlers({
    fetchPage: async (url) => {
      fetched.push(url);
      // A linkless page: the public seed collects and the queue drains
      // without discovering further hosts.
      return { html: articlePage('Second', []), finalUrl: url };
    },
    netGuard: createNetGuard({
      resolve: async (host) => {
        if (host === 'missing.example') {
          const error = new Error('getaddrinfo ENOTFOUND');
          error.code = 'ENOTFOUND';
          throw error;
        }
        return publicResolve();
      },
    }),
  });
  const run = await runCampaign(fx.db, fx.campaign, {
    sourcePath: fx.file,
    contentHash: sha256Hex(fx.source),
    snapshotsRoot: fx.snapshotsRoot,
    handlers,
  });
  assert.equal(run.failed, 1);
  assert.deepEqual(fetched, ['https://news.example/second'], 'the public seed fetched exactly as before');
  const missing = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'seed' AND ref = 'https://missing.example/start'").get();
  assert.match(missing.error, /crawl https:\/\/missing\.example\/start: net guard: missing\.example did not resolve \(ENOTFOUND\) — request not made/);
  assert.equal(countRows(fx.db, 'raw_records'), 1, 'the public seed is snapshotted');
});

test('a discovered link to a non-http scheme inside the fence is refused at execution', async () => {
  const fx = campaignSetup(
    campaignYaml({ seeds: 'seeds:\n  - https://news.example/start', extra_domains: 'extra_domains: [files.example]' })
  );
  const startPage = articleHtml({
    body: [
      '<p>Grab the <a href="ftp://files.example/doc.pdf">document</a> file.</p>',
      '<p>Second filler paragraph with plain text.</p>',
      '<p>Third filler paragraph with plain text.</p>',
    ],
  });
  const handlers = defaultHandlers({
    fetchPage: async (url) => ({ html: startPage, finalUrl: url }),
    netGuard: createNetGuard({ resolve: publicResolve }),
  });
  const run = await runCampaign(fx.db, fx.campaign, {
    sourcePath: fx.file,
    contentHash: sha256Hex(fx.source),
    snapshotsRoot: fx.snapshotsRoot,
    handlers,
  });
  // The seed collects; the ftp link passed the fence (its hostname is an
  // extra domain) and reached the queue — the guard refuses it at execution.
  assert.deepEqual(stepStatusCounts(fx.db, run.campaignId), { done: 1, failed: 1 });
  const crawl = fx.db.prepare("SELECT error FROM run_log WHERE kind = 'crawl'").get();
  assert.match(crawl.error, /crawl ftp:\/\/files\.example\/doc\.pdf: net guard: 'ftp' is not http\/https — refusing to fetch/);
  assert.equal(countRows(fx.db, 'raw_records'), 1, 'only the seed page is stored');
});

test('a file:// seed keeps the fixture boundary — the guard is never consulted', async () => {
  const dir = makeTempDir();
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  const fx = campaignSetup(campaignYaml({ seeds: `seeds:\n  - ${pathToFileURL(page).href}` }));
  const handlers = defaultHandlers({
    netGuard: async () => {
      throw new Error('the guard must not see file:// fixtures');
    },
  });
  const run = await runCampaign(fx.db, fx.campaign, {
    sourcePath: fx.file,
    contentHash: sha256Hex(fx.source),
    snapshotsRoot: fx.snapshotsRoot,
    handlers,
  });
  assert.equal(run.failed, 0, run.stopped ?? '');
  assert.equal(countRows(fx.db, 'raw_records'), 1, 'the file:// fixture is snapshotted as before');
});
