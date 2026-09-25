import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultHandlers, runCampaign } from './runloop.mjs';
import { countRows, openStore, sha256Hex } from './store.mjs';
import { parseCampaign } from './campaign.mjs';
import { campaignYaml, makeTempDir, writeCampaignFile } from './testkit.mjs';

// G17.04 acceptance suite (docs/agent-tasks/collection/G17.04.md) over the
// production pipeline: recorded MediaWiki API fixtures behind the injected
// loadApi boundary — no test touches the network. Criteria:
// 1. fixture parse responses → raw_records with source_type=wiki and every
//    attribution field;
// 2. category expansion respects the campaign topic filter and depth limit,
//    the notes name them;
// 3. rights=licensed is set automatically for wiki sources (asserting the
//    literal, so reverting the mapping fails);
// 4. a missing title fails its own step with a diagnostic, the run completes;
//    the suite is wired into npm test via the tools/collector/*.test.mjs glob.

const API = 'https://pl.wikipedia.org/w/api.php';

// Article body as action=parse (prop=text, formatversion=2) answers it: a
// fragment of <p> blocks with /wiki/ relative anchors — no full document.
const GDANSK_HTML = [
  '<div class="mw-parser-output">',
  '<p><b>Gdańsk</b> is a city on the <a href="/wiki/Baltic_Sea" title="Baltic Sea">Baltic coast</a>.</p>',
  '<p>The <a href="/wiki/Stocznia_Gda%C5%84ska">shipyard</a> was founded in 1945.</p>',
  '<p>A plain paragraph without anchors.</p>',
  '</div>',
].join('\n');

const MINIMAL_HTML = '<p>One paragraph of text.</p>';

function articleResponse({ title, html = GDANSK_HTML, revid = 97531, timestamp = '2026-09-24T10:00:00Z', user = 'WikiEditor' } = {}) {
  return JSON.stringify({
    parse: { title, pageid: 7351, revid, text: html, revisions: [{ revid, timestamp, user }] },
  });
}

function membersResponse({ articles = [], subcategories = [], more = false } = {}) {
  const payload = {
    batchcomplete: true,
    query: {
      categorymembers: [
        ...articles.map((title) => ({ ns: 0, title, pageid: 100 })),
        ...subcategories.map((title) => ({ ns: 14, title, pageid: 200 })),
      ],
    },
  };
  if (more) payload.continue = { cmcontinue: 'page|NEXT', continue: '-||' };
  return JSON.stringify(payload);
}

function errorResponse(code, info) {
  return JSON.stringify({ error: { code, info } });
}

// The transport tests inject: recorded responses keyed by
// 'parse:<title>' / 'members:<category>'. A request without a fixture throws,
// so a test bug is visible as a failed step, not a silent empty run.
function fixtureLoader(responses) {
  return async (url) => {
    const params = new URL(url).searchParams;
    const key = params.get('action') === 'parse' ? `parse:${params.get('page')}` : `members:${params.get('cmtitle')}`;
    if (!(key in responses)) throw new Error(`no fixture for ${key}`);
    return responses[key];
  };
}

function wikiYaml({ articles = [], categories = [], depth, topics = 'topics: [architektura, historia]', api = API }) {
  return campaignYaml({
    topics,
    youtube: null,
    wiki: [
      'wiki:',
      `  api: ${api}`,
      `  depth: ${depth}`,
      ...(articles.length > 0 ? ['  articles:', ...articles.map((title) => `    - ${title}`)] : []),
      ...(categories.length > 0 ? ['  categories:', ...categories.map((title) => `    - ${title}`)] : []),
    ].join('\n'),
  });
}

function setup(responses, overrides) {
  const dir = makeTempDir();
  const file = writeCampaignFile(dir, wikiYaml(overrides));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  return { db, file, source, campaign: parsed.campaign, snapshotsRoot: path.join(dir, 'snapshots'), responses };
}

async function runThrough(s) {
  return runCampaign(s.db, s.campaign, {
    sourcePath: s.file,
    contentHash: sha256Hex(s.source),
    snapshotsRoot: s.snapshotsRoot,
    handlers: defaultHandlers({ loadApi: fixtureLoader(s.responses) }),
  });
}

test('AC1: a fixture article becomes a raw_records row with source_type=wiki and every attribution field', async () => {
  const s = setup({ 'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }) }, { articles: ['Gdańsk'], depth: 1 });
  const run = await runThrough(s);
  assert.equal(run.failed, 0);
  assert.equal(countRows(s.db, 'raw_records'), 1);
  const record = s.db.prepare('SELECT * FROM raw_records').get();
  assert.equal(record.source_type, 'wiki');
  assert.equal(record.url, 'https://pl.wikipedia.org/wiki/Gda%C5%84sk', 'the record url is the normalized title on the wiki origin');
  assert.ok(fs.existsSync(record.snapshot_path), 'the article has a snapshot dir');

  const metadata = JSON.parse(fs.readFileSync(path.join(record.snapshot_path, 'metadata.json'), 'utf8'));
  assert.equal(metadata.title, 'Gdańsk');
  assert.equal(metadata.published_at, '2026-09-24T10:00:00Z', 'the revision timestamp is the page date');
  assert.equal(metadata.author, 'WikiEditor', 'the revision user is the page author');
  assert.equal(metadata.language, null, 'the parse response carries no content language');
  // Attribution metadata — each field asserted (07's bibliography and the
  // citation rule consume these).
  assert.equal(metadata.attribution.site, 'https://pl.wikipedia.org');
  assert.equal(metadata.attribution.revision_id, 97531);
  assert.equal(
    metadata.attribution.contributors_url,
    'https://pl.wikipedia.org/w/index.php?title=Gda%C5%84sk&action=history'
  );
  assert.equal(metadata.attribution.license, 'CC BY-SA');

  const text = fs.readFileSync(path.join(record.snapshot_path, 'text.md'), 'utf8');
  assert.ok(text.includes('Gdańsk is a city on the [Baltic coast]('), 'markup stripped, anchors kept');
  const links = s.db.prepare('SELECT anchor_text, url FROM links ORDER BY rowid').all();
  assert.deepEqual(links.map((link) => link.url), [
    'https://pl.wikipedia.org/wiki/Baltic_Sea',
    'https://pl.wikipedia.org/wiki/Stocznia_Gda%C5%84ska',
  ], 'relative /wiki/ anchors resolve against the article url');
});

test('AC3: rights=licensed is set automatically for wiki sources (reverting the mapping fails this test)', async () => {
  const s = setup({ 'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }) }, { articles: ['Gdańsk'], depth: 1 });
  await runThrough(s);
  const record = s.db.prepare('SELECT rights, source_type FROM raw_records').get();
  // The literal is the spec value («Правы»: MediaWiki-сайты — licensed,
  // CC BY-SA). Asserting the literal, not the constant, so a reverted
  // WIKI_RIGHTS mapping fails here.
  assert.equal(record.source_type, 'wiki');
  assert.equal(record.rights, 'licensed');
});

test('AC2: category expansion fetches member articles and in-topic subcategories', async () => {
  const s = setup(
    {
      'members:Category:Architektura Gdańska': membersResponse({
        articles: ['Stocznia Gdańska'],
        subcategories: ['Category:Historia Gdańska'],
      }),
      'members:Category:Historia Gdańska': membersResponse({ articles: ['Westerplatte'] }),
      'parse:Stocznia Gdańska': articleResponse({ title: 'Stocznia Gdańska', html: MINIMAL_HTML }),
      'parse:Westerplatte': articleResponse({ title: 'Westerplatte', html: MINIMAL_HTML }),
    },
    { categories: ['Category:Architektura Gdańska'], depth: 2, topics: 'topics: [architektura, historia]' }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 0);
  const urls = s.db.prepare('SELECT url FROM raw_records ORDER BY url').all().map((row) => row.url);
  assert.deepEqual(urls, [
    'https://pl.wikipedia.org/wiki/Stocznia_Gda%C5%84ska',
    'https://pl.wikipedia.org/wiki/Westerplatte',
  ], 'members of the root category and of the in-topic subcategory are recorded');
});

test('AC2 negative: an out-of-topic subcategory is not expanded — the note names the campaign topic filter', async () => {
  const s = setup(
    { 'members:Category:Architektura Gdańska': membersResponse({ subcategories: ['Category:Sport w Gdańsku'] }) },
    { categories: ['Category:Architektura Gdańska'], depth: 2, topics: 'topics: [architektura]' }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 0);
  assert.equal(countRows(s.db, 'raw_records'), 0, 'nothing is fetched from the out-of-topic subcategory');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM run_log WHERE kind = 'wiki-article'").get().n, 0, 'no article steps enqueued');
  const step = s.db.prepare("SELECT status, detail FROM run_log WHERE kind = 'wiki-category'").get();
  assert.equal(step.status, 'done', 'the category step completes with notes, not an error');
  assert.match(step.detail, /'Category:Sport w Gdańsku' not expanded: no campaign topic matches/);
  assert.match(step.detail, /topics: architektura/, 'the filter itself is named');
});

test('AC2 negative: the depth limit stops subcategory expansion — the note names the limit', async () => {
  const s = setup(
    { 'members:Category:Architektura Gdańska': membersResponse({ subcategories: ['Category:Historia Gdańska'] }) },
    { categories: ['Category:Architektura Gdańska'], depth: 1, topics: 'topics: [historia]' }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 0);
  assert.equal(countRows(s.db, 'raw_records'), 0);
  const step = s.db.prepare("SELECT detail FROM run_log WHERE kind = 'wiki-category'").get();
  assert.match(step.detail, /'Category:Historia Gdańska' not expanded: depth limit 1 reached/);
});

test('AC4: a missing title fails its own step with a diagnostic; the run completes', async () => {
  const s = setup(
    {
      'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }),
      'parse:NotExist': errorResponse('missingtitle', "The article title you requested doesn't exist"),
    },
    { articles: ['Gdańsk', 'NotExist'], depth: 1 }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 1);
  const articleSteps = s.db
    .prepare("SELECT ref, status FROM run_log WHERE kind = 'wiki-article' ORDER BY id")
    .all()
    .map((row) => ({ ref: row.ref, status: row.status }));
  assert.deepEqual(articleSteps, [
    { ref: 'Gdańsk', status: 'done' },
    { ref: 'NotExist', status: 'failed' },
  ], 'the valid article is unaffected');
  const failed = s.db.prepare("SELECT ref, error FROM run_log WHERE status = 'failed'").get();
  assert.equal(failed.ref, 'NotExist');
  assert.match(failed.error, /wiki api error for 'NotExist': missingtitle/);
  assert.equal(countRows(s.db, 'raw_records'), 1);
});

test('the same article listed directly and found in a category is one record; a re-run adds nothing', async () => {
  const s = setup(
    {
      'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }),
      'parse:Gdansk': articleResponse({ title: 'Gdańsk' }),
      'members:Category:Historia Gdańska': membersResponse({ articles: ['Gdansk'] }),
    },
    { articles: ['Gdańsk'], categories: ['Category:Historia Gdańska'], depth: 1, topics: 'topics: [historia]' }
  );
  const first = await runThrough(s);
  assert.equal(first.failed, 0);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM run_log WHERE kind LIKE 'wiki-%'").get().n,
    3,
    'two article spellings + one category step'
  );
  assert.equal(countRows(s.db, 'raw_records'), 1, 'the member dedups on the normalized-title url');
  const second = await runThrough(s);
  assert.equal(second.done, 0, 'resume: processed steps are not re-executed');
  assert.equal(countRows(s.db, 'raw_records'), 1);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) AS n FROM run_log WHERE kind LIKE 'wiki-%'").get().n,
    3,
    'no duplicate step rows'
  );
});

test('a category with more member batches completes with a note instead of silent truncation', async () => {
  const s = setup(
    {
      'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }),
      'members:Category:Historia Gdańska': membersResponse({ articles: ['Gdańsk'], more: true }),
    },
    { categories: ['Category:Historia Gdańska'], depth: 1, topics: 'topics: [historia]' }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 0);
  const step = s.db.prepare("SELECT detail FROM run_log WHERE kind = 'wiki-category'").get();
  assert.match(step.detail, /more members \(continue\)/);
});

test('corrupt api payloads fail their own steps with diagnostics, never a crash', async () => {
  const s = setup(
    {
      'parse:Bad JSON': 'not json at all {',
      'parse:No revisions': JSON.stringify({ parse: { title: 'X', text: '<p>Text.</p>' } }),
      'parse:No HTML': JSON.stringify({ parse: { title: 'X', revisions: [{ revid: 1 }] } }),
      'members:Category:Bad': JSON.stringify({ query: {} }),
      'members:Category:Broken member': JSON.stringify({ query: { categorymembers: [{ ns: 0 }] } }),
    },
    { articles: ['Bad JSON', 'No revisions', 'No HTML'], categories: ['Category:Bad', 'Category:Broken member'], depth: 2, topics: 'topics: [bad, broken]' }
  );
  const run = await runThrough(s);
  assert.equal(run.failed, 5);
  const errors = s.db.prepare("SELECT error FROM run_log WHERE status = 'failed'").all().map((row) => row.error).join('\n');
  assert.match(errors, /not valid JSON/);
  assert.match(errors, /missing revision metadata \(parse\.revisions\)/);
  assert.match(errors, /missing article HTML \(parse\.text\)/);
  assert.match(errors, /missing query\.categorymembers/);
  assert.match(errors, /member without ns\/title/);
  assert.equal(countRows(s.db, 'raw_records'), 0);
});

test('the transport boundary serves only http(s): an unservable url fails the step with a diagnostic', async () => {
  assert.equal(await defaultHandlers().loadApi('file:///tmp/fixture.json'), null, 'file:// is not a wiki transport');
  assert.equal(await defaultHandlers().loadApi('ftp://files.example/w/api.php'), null);

  const s = setup({ 'parse:Gdańsk': articleResponse({ title: 'Gdańsk' }) }, { articles: ['Gdańsk'], depth: 1 });
  const run = await runCampaign(s.db, s.campaign, {
    sourcePath: s.file,
    contentHash: sha256Hex(s.source),
    snapshotsRoot: s.snapshotsRoot,
    handlers: defaultHandlers({ loadApi: async () => null }),
  });
  assert.equal(run.failed, 1);
  const failed = s.db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.match(failed.error, /no transport/);
  assert.match(failed.error, /api\.php/, 'the request url is named');
  assert.equal(countRows(s.db, 'raw_records'), 0);
});

test('a non-http api endpoint in the campaign fails through the default transport, with no network attempt', async () => {
  const s = setup({}, { articles: ['Gdańsk'], depth: 1, api: 'ftp://files.example/w/api.php' });
  const run = await runCampaign(s.db, s.campaign, {
    sourcePath: s.file,
    contentHash: sha256Hex(s.source),
    snapshotsRoot: s.snapshotsRoot,
    handlers: defaultHandlers(),
  });
  assert.equal(run.failed, 1);
  const failed = s.db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.match(failed.error, /no transport for /);
  assert.match(failed.error, /api\.php/, 'the request url is named');
  assert.match(failed.error, /\(http\/https only\)/);
  assert.equal(countRows(s.db, 'raw_records'), 0);
});
