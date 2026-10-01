import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultHandlers, runCampaign } from './runloop.mjs';
import { countRows, enqueueStep, ensureCampaign, openStore, sha256Hex, stepStatusCounts } from './store.mjs';
import { parseCampaign } from './campaign.mjs';
import { parseRequestUrl } from './wiki.mjs';
import { articleHtml, campaignYaml, makeTempDir, skipWithoutBrowser, writeCampaignFile, youtubeBacklogFetch } from './testkit.mjs';

// The seed is a file:// fixture page: G17.02 made https seeds live crawls, so
// these loop-mechanics tests pin the offline snapshot path instead. The
// youtube step completes through the in-process backlog fetch (G17.05 made
// the production default spawn the real yt-dlp binary).
function setup(overrides = {}) {
  const dir = makeTempDir();
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  const file = writeCampaignFile(
    dir,
    campaignYaml({
      seeds: `seeds:\n  - ${pathToFileURL(page).href}`,
      youtube: 'youtube:\n  - dQw4w9WgXcQ',
      ...overrides,
    })
  );
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  const handlers = defaultHandlers({ youtubeFetch: youtubeBacklogFetch() });
  return { db, file, source, campaign: parsed.campaign, handlers };
}

test('AC2: first run registers campaign and records; second run inserts nothing new', async () => {
  const { db, file, source, campaign, handlers } = setup();
  const first = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(first.done, 2, 'one seed + one youtube step');
  assert.equal(countRows(db, 'campaigns'), 1);
  assert.equal(countRows(db, 'raw_records'), 2);
  assert.equal(countRows(db, 'run_log'), 2);

  const recordIds = db.prepare('SELECT id FROM raw_records ORDER BY id').all().map((row) => row.id);
  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(countRows(db, 'campaigns'), 1, 'campaign row not duplicated');
  assert.equal(countRows(db, 'raw_records'), 2, 'raw_records not duplicated');
  assert.equal(countRows(db, 'run_log'), 2, 'steps not duplicated');
  assert.deepEqual(
    db.prepare('SELECT id FROM raw_records ORDER BY id').all().map((row) => row.id),
    recordIds
  );
});

test('AC3: a step left running by an interrupted run is resumed, not duplicated', async () => {
  const { db, file, source, campaign, handlers } = setup();
  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });

  // Simulate a process killed between claim and completion: the row stays
  // 'running' on disk, exactly as the first run would have left it.
  db.prepare("UPDATE run_log SET status = 'running', finished_at = NULL WHERE kind = 'youtube'").run();

  const second = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(second.done, 1, 'only the interrupted step is re-claimed');
  assert.equal(countRows(db, 'raw_records'), 2);
  const youtube = db.prepare("SELECT status, attempts FROM run_log WHERE kind = 'youtube'").get();
  assert.equal(youtube.status, 'done');
  assert.equal(youtube.attempts, 2, 'resumed step counts its second attempt');
  const seed = db.prepare("SELECT attempts FROM run_log WHERE kind = 'seed'").get();
  assert.equal(seed.attempts, 1, 'completed steps are not re-executed (resume, not restart)');
});

test('AC3: a run interrupted after enqueue resumes on the next invocation', async () => {
  const { db, file, source, campaign, handlers } = setup();
  // State of a run killed right after enqueue: campaign registered, steps
  // pending, no processing yet.
  const { campaignId } = ensureCampaign(db, { campaign, sourcePath: file, contentHash: sha256Hex(source) });
  enqueueStep(db, campaignId, 'youtube', campaign.youtube[0], new Date().toISOString());
  enqueueStep(db, campaignId, 'seed', campaign.seeds[0], new Date().toISOString());
  assert.deepEqual(stepStatusCounts(db, campaignId), { pending: 2 });

  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(run.done, 2);
  assert.deepEqual(stepStatusCounts(db, campaignId), { done: 2 });
  assert.equal(countRows(db, 'raw_records'), 2);
  assert.equal(countRows(db, 'run_log'), 2, 'no duplicate step rows after resume');
});

test('a handler failure marks the step failed with the error and is not re-run', async () => {
  const { db, file, source, campaign, handlers } = setup();
  let calls = 0;
  const throwing = {
    seed() {},
    youtube() {
      calls += 1;
      throw new Error('boom');
    },
  };
  const first = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: throwing });
  assert.equal(first.done, 1);
  assert.equal(first.failed, 1);
  assert.equal(calls, 1);
  const youtube = db.prepare("SELECT status, error, attempts FROM run_log WHERE kind = 'youtube'").get();
  assert.equal(youtube.status, 'failed');
  assert.equal(youtube.error, 'boom');

  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: throwing });
  assert.equal(calls, 1, 'failed steps are not re-claimed on the next run');
  assert.equal(countRows(db, 'raw_records'), 0);
});

test('a step kind without a handler fails with a diagnostic, not a crash', async () => {
  const { db, file, source, campaign, handlers } = setup();
  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: {} });
  assert.equal(run.failed, 2);
  const errors = db.prepare("SELECT error FROM run_log WHERE status = 'failed'").all().map((row) => row.error);
  assert.deepEqual(errors.sort(), ["no handler for step kind 'seed'", "no handler for step kind 'youtube'"]);
});

// G17.19 suites: the campaign's collection transport routes the channels.
// Shared arrangement (jscpd): the campaign file comes from campaignYaml
// overrides into a temp dir and is parsed against a fresh store; the handlers
// stay per-test — the boundary injection is the test's own arrangement.
function transportCampaign(dir, overrides) {
  const file = writeCampaignFile(dir, campaignYaml(overrides));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  return { file, source, campaign: parsed.campaign, db };
}

function seedPageFixture(dir) {
  const page = path.join(dir, 'seed-page.html');
  fs.writeFileSync(page, articleHtml(), 'utf8');
  return pathToFileURL(page).href;
}

// The offline boundary injections most of these suites share: no DNS, no
// waits, the youtube backlog shell.
function offlineHandlers(extra = {}) {
  return defaultHandlers({
    netGuard: async () => {},
    sleep: async () => {},
    youtubeFetch: youtubeBacklogFetch(),
    ...extra,
  });
}

const WIKI_BLOCK = 'wiki:\n  api: https://wiki.example/w/api.php\n  articles: [Town]\n  categories: []\n  depth: 1';
const WIKI_ARTICLE_PAYLOAD = JSON.stringify({
  query: {
    pages: [{
      title: 'Town',
      revisions: [{
        revid: 7,
        timestamp: '2026-01-02T03:04:05Z',
        user: 'editor',
        content: '<p>First paragraph about the town and its shipyard history.</p><p>Second paragraph carries more of the recorded story.</p><p>Third paragraph finishes the article text.</p>',
      }],
    }],
  },
});

test('AC2 (G17.19): a file:// campaign with transport tor parses and runs with no proxy', async () => {
  const { db, file, source, campaign, handlers } = setup({ transport: 'transport: tor' });
  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(run.done, 2, 'the file:// seed and the youtube backlog step complete unchanged');
  assert.equal(run.stopped, null);
  assert.equal(countRows(db, 'campaigns'), 1);
});

test('AC6 (G17.19): a tor run stops on the error series when the daemon is unreachable', async () => {
  const { file, source, campaign, db } = transportCampaign(makeTempDir(), {
    seeds: 'seeds:\n  - http://a.example/one\n  - http://b.example/two\n  - http://c.example/three',
    youtube: 'youtube: []',
    transport: 'transport: tor',
  });
  const handlers = offlineHandlers({
    // Every navigation dies like it does behind a dead SOCKS5 proxy; the
    // boundary injections keep the run offline (robots, guard, delays).
    fetchPage: async () => {
      throw new Error('net::ERR_PROXY_CONNECTION_FAILED');
    },
    fetchRobots: async () => null, // no robots.txt — everything allowed
  });

  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.match(run.stopped, /error series: 3 consecutive crawl failures/);
  assert.equal(run.failed, 3);
  const errors = db.prepare("SELECT error FROM run_log WHERE error IS NOT NULL").all().map((row) => row.error);
  assert.ok(errors.length >= 2 && errors.every((message) => message.includes('net::ERR_PROXY_CONNECTION_FAILED')),
    'every failed step records a readable diagnostic');
});

// One wiki run through the production loadApi with the global fetch mocked;
// the transport overrides decides direct vs tor.
async function wikiApiRun(t, { tor = false } = {}) {
  const dir = makeTempDir();
  const { file, source, campaign, db } = transportCampaign(dir, {
    seeds: `seeds:\n  - ${seedPageFixture(dir)}`,
    wiki: WIKI_BLOCK,
    ...(tor ? { transport: 'transport: tor' } : {}),
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => WIKI_ARTICLE_PAYLOAD,
  }));
  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: offlineHandlers() });
  return { run, fetchMock };
}

test('AC4 (G17.19): the wiki api rides the SOCKS5 dispatcher under the tor transport', async (t) => {
  const { run, fetchMock } = await wikiApiRun(t, { tor: true });
  assert.equal(run.done, 2, 'the seed and the wiki-article step complete');
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(
    fetchMock.mock.calls[0].arguments[0],
    parseRequestUrl('https://wiki.example/w/api.php', 'Town'),
    'the api call receives the canonical request url verbatim'
  );
  assert.ok(fetchMock.mock.calls[0].arguments[1]?.dispatcher, 'the fetch carries the SOCKS5 dispatcher');
});

test('AC4 (G17.19): the direct transport fetches the wiki api without a dispatcher', async (t) => {
  const { run, fetchMock } = await wikiApiRun(t);
  assert.equal(run.done, 2);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(fetchMock.mock.calls[0].arguments[1], undefined, "today's direct fetch call shape");
});

// The run-loop wiring under tor, driven through the production transports
// (implementation-rules 15): the robots gate and the youtube command reach
// their SOCKS5 arguments only through the lazy channel factories above.

test('AC3 (G17.19): the robots.txt gate rides the SOCKS5 dispatcher under the tor transport', async (t) => {
  const { file, source, campaign, db } = transportCampaign(makeTempDir(), {
    seeds: 'seeds:\n  - http://a.example/one',
    youtube: 'youtube: []',
    transport: 'transport: tor',
  });
  const handlers = offlineHandlers({
    // The crawl itself dies on the injected page fetch — the assertion target
    // is the robots.txt request the production fetchRobotsFor made before it.
    fetchPage: async () => {
      throw new Error('net::ERR_PROXY_CONNECTION_FAILED');
    },
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => 'User-agent: *\nAllow: /\n',
  }));

  await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(fetchMock.mock.calls.length, 1, 'only the robots.txt request used the mocked fetch');
  assert.equal(fetchMock.mock.calls[0].arguments[0], 'http://a.example/robots.txt');
  assert.ok(fetchMock.mock.calls[0].arguments[1]?.dispatcher, 'the robots fetch carries the SOCKS5 dispatcher');
});

test('AC6 (G17.19): a robots.txt fetch failure under tor carries the tor-down hint', async (t) => {
  const { file, source, campaign, db } = transportCampaign(makeTempDir(), {
    seeds: 'seeds:\n  - http://a.example/one',
    youtube: 'youtube: []',
    transport: 'transport: tor',
  });
  const handlers = offlineHandlers({
    // Unreachable by construction: the robots gate refuses the seed first.
    fetchPage: async () => {
      throw new Error('must not be reached — the robots gate refuses first');
    },
  });
  // The robots.txt request dies like it does behind a dead SOCKS5 proxy; the
  // gate's «unavailable» reason must carry the tor-down hint (criterion 6 on
  // the run's most likely failure path — the first request of every host).
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch failed');
  });

  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers });
  assert.equal(run.failed, 1);
  const failed = db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.match(failed.error, /fetch failed.*tor daemon.*seed not fetched/s);
});

test('live AC3 (G17.19): a tor campaign drives the production browser through the SOCKS5 proxy', async (t) => {
  if (!(await skipWithoutBrowser(t))) return;
  const { file, source, campaign, db } = transportCampaign(makeTempDir(), {
    seeds: 'seeds:\n  - http://news.example/page',
    youtube: 'youtube: []',
    transport: 'transport: tor',
  });
  // The robots.txt request rides the dead SOCKS5 dispatcher too — mocked, so
  // the run reaches the browser navigation, which fails with the tor-down
  // hint. Without the run-loop wiring the browser would start direct and the
  // hint would never appear.
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => 'User-agent: *\nAllow: /\n',
  }));

  const run = await runCampaign(db, campaign, { sourcePath: file, contentHash: sha256Hex(source), handlers: offlineHandlers() });
  assert.equal(run.failed, 1);
  const failed = db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.match(failed.error, /tor daemon/, 'the production fetcher carries the tor-down hint');
});

test('live AC4 (G17.19): the run loop hands the tor transport to the production yt-dlp command', { skip: process.platform === 'win32' && 'the PATH stub needs a POSIX shell' }, async (t) => {
  const dir = makeTempDir();
  const argvLog = path.join(dir, 'argv.log');
  const stubDir = path.join(dir, 'bin');
  fs.mkdirSync(stubDir);
  const stub = path.join(stubDir, 'yt-dlp');
  fs.writeFileSync(
    stub,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(argvLog)}\ncase "$*" in *--dump-json*) echo '{"id":"dQw4w9WgXcQ","title":"Stub"}';; esac\n`
  );
  fs.chmodSync(stub, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
  });

  // No youtubeFetch injection: the production fetch (youtubeFor) spawns the
  // command from PATH — a reverted transport wiring spawns it without --proxy
  // and this assertion fails.
  const { file, source, campaign, db } = transportCampaign(dir, {
    seeds: `seeds:\n  - ${seedPageFixture(dir)}`,
    youtube: 'youtube:\n  - dQw4w9WgXcQ',
    transport: 'transport: tor',
  });

  const run = await runCampaign(db, campaign, {
    sourcePath: file,
    contentHash: sha256Hex(source),
    handlers: defaultHandlers({}),
  });
  assert.equal(run.done, 2, 'the file:// seed and the backlogged video complete');

  // The stub logs one argument per line: the first two are --proxy's pair.
  const args = fs.readFileSync(argvLog, 'utf8').trim().split('\n');
  assert.ok(args.length >= 2, 'the production yt-dlp command ran');
  assert.equal(args[0], '--proxy', 'the first yt-dlp invocation is proxied');
  assert.equal(args[1], 'socks5h://127.0.0.1:9050');
});
