import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCampaign } from './runloop.mjs';
import { countRows, openStore, sha256Hex } from './store.mjs';
import { parseCampaign } from './campaign.mjs';
import { processFetchedPage } from './snapshot.mjs';
import { articleHtml, campaignYaml, makeTempDir, writeCampaignFile } from './testkit.mjs';

// Seeds-only campaigns (youtube: null) so step counts isolate the seed pipeline.
function setup({ fixtures = { 'article.html': articleHtml() }, seedOrder, seedLines } = {}) {
  const dir = makeTempDir();
  for (const [name, html] of Object.entries(fixtures)) {
    if (html !== null) fs.writeFileSync(path.join(dir, name), html, 'utf8');
  }
  const seedUrl = (name) => pathToFileURL(path.resolve(dir, name)).href;
  const entries = seedOrder ?? Object.keys(fixtures);
  const lines = seedLines ?? entries.map((name) => `  - ${seedUrl(name)}`).join('\n');
  const file = writeCampaignFile(dir, campaignYaml({ youtube: null, seeds: `seeds:\n${lines}` }));
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  assert.ok(parsed.ok, parsed.diagnostics?.join('\n'));
  const db = openStore(path.join(dir, 'db.sqlite'));
  return { dir, db, file, source, campaign: parsed.campaign, seedUrl, snapshotsRoot: path.join(dir, 'snapshots') };
}

async function runThroughLoop(s) {
  return runCampaign(s.db, s.campaign, {
    sourcePath: s.file,
    contentHash: sha256Hex(s.source),
    snapshotsRoot: s.snapshotsRoot,
  });
}

function snapshotBytes(snapshotDir) {
  return {
    'snapshot.html': fs.readFileSync(path.join(snapshotDir, 'snapshot.html')),
    'text.md': fs.readFileSync(path.join(snapshotDir, 'text.md')),
    'metadata.json': fs.readFileSync(path.join(snapshotDir, 'metadata.json')),
  };
}

test('AC1: the fixture page becomes a snapshot dir; every anchor keeps its target URL', async () => {
  const s = setup();
  const run = await runThroughLoop(s);
  assert.equal(run.done, 1);
  const record = s.db.prepare('SELECT * FROM raw_records').get();
  for (const name of ['snapshot.html', 'text.md', 'metadata.json']) {
    assert.ok(fs.existsSync(path.join(record.snapshot_path, name)), `${name} exists`);
  }
  assert.ok(fs.statSync(path.join(record.snapshot_path, 'media')).isDirectory(), 'media/ dir exists');
  assert.equal(countRows(s.db, 'media'), 0, 'photo download is G17.03: media/ stays empty');
  assert.equal(record.media_dir, path.join(record.snapshot_path, 'media'));
  assert.equal(record.source_type, 'web');
  assert.equal(record.rights, 'research_only', 'web pages are research_only per the spec');

  const textMd = fs.readFileSync(path.join(record.snapshot_path, 'text.md'), 'utf8');
  const anchors = [...textMd.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => [match[1], match[2]]);
  const relative = new URL('../museum/main-hall.html', s.seedUrl('article.html')).href;
  assert.deepEqual(anchors, [
    ['shipyard history', 'https://gdansk.example/history'],
    ['main hall guide', relative],
    ['crane list', 'https://gdansk.example/cranes'],
  ]);

  const links = s.db.prepare('SELECT anchor_text, url, context FROM links ORDER BY rowid').all();
  assert.deepEqual(
    links.map((link) => [link.anchor_text, link.url]),
    anchors,
    'the links table mirrors the anchors of text.md'
  );
  assert.ok(links[0].context.includes('began in 1844'), 'context is the surrounding paragraph');
  assert.ok(links[1].context.includes('Read the'), 'each anchor carries its own paragraph');

  const metadata = JSON.parse(fs.readFileSync(path.join(record.snapshot_path, 'metadata.json'), 'utf8'));
  assert.deepEqual(metadata, {
    title: 'Gdansk shipyard turns into a museum',
    published_at: '2026-09-20',
    author: 'Jan Kowalski',
    language: 'en',
  });
});

test('AC2: the same fixture twice is one record; snapshots are never rewritten', async () => {
  const s = setup();
  const first = await runThroughLoop(s);
  assert.equal(first.done, 1);
  const record = s.db.prepare('SELECT * FROM raw_records').get();
  const before = snapshotBytes(record.snapshot_path);

  const second = await runThroughLoop(s);
  assert.equal(second.done, 0, 'resume: the processed seed step is not re-executed');
  assert.equal(countRows(s.db, 'raw_records'), 1);
  assert.deepEqual(snapshotBytes(record.snapshot_path), before, 'file bytes unchanged');

  // A re-delivered page (what a re-fetch would hand the pipeline) also skips.
  const redelivered = processFetchedPage(s.db, s.campaign, first.campaignId, {
    url: s.seedUrl('article.html'),
    html: articleHtml(),
    now: '2026-09-23T12:00:00.000Z',
    snapshotsRoot: s.snapshotsRoot,
  });
  assert.equal(redelivered.outcome, 'duplicate-url');
  assert.equal(redelivered.recordId, record.id);
  assert.deepEqual(snapshotBytes(record.snapshot_path), before, 're-delivery rewrites nothing');
});

test('AC2: same text under a different URL is a second row linked to the original', async () => {
  const s = setup({
    fixtures: {
      'article.html': articleHtml(),
      'twin.html': articleHtml({ title: 'Old shipyard museum opens its main hall' }),
    },
  });
  const run = await runThroughLoop(s);
  assert.equal(run.done, 2);
  const rows = s.db.prepare('SELECT url, canonical_url, content_hash FROM raw_records ORDER BY rowid').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, s.seedUrl('article.html'));
  assert.equal(rows[1].url, s.seedUrl('twin.html'));
  assert.equal(rows[1].content_hash, rows[0].content_hash, 'equal text → equal content_hash');
  assert.equal(rows[1].canonical_url, rows[0].canonical_url, 'the twin links to the original via canonical_url');
  assert.equal(rows[0].canonical_url, s.seedUrl('article.html'), 'the original keeps its own address');
  assert.equal(new Set(rows.map((row) => row.content_hash)).size, 1, 'no duplicated text: one hash pair');
});

test('a declared rel=canonical becomes the original record canonical_url', async () => {
  const s = setup({
    fixtures: { 'article.html': articleHtml({ canonical: 'https://news.example/the-real-article' }) },
  });
  await runThroughLoop(s);
  const record = s.db.prepare('SELECT canonical_url FROM raw_records').get();
  assert.equal(record.canonical_url, 'https://news.example/the-real-article');
});

test('AC3: an empty fixture fails its step with a diagnostic and writes no files', async () => {
  for (const empty of ['', '   \n  ']) {
    const s = setup({ fixtures: { 'article.html': empty } });
    const run = await runThroughLoop(s);
    assert.equal(run.failed, 1);
    assert.equal(run.done, 0);
    const step = s.db.prepare("SELECT status, error FROM run_log WHERE kind = 'seed'").get();
    assert.equal(step.status, 'failed');
    assert.ok(step.error.startsWith(`seed ${s.seedUrl('article.html')}: `), step.error);
    assert.match(step.error, /empty document/);
    assert.equal(countRows(s.db, 'raw_records'), 0);
    assert.ok(!fs.existsSync(s.snapshotsRoot), 'nothing written for a corrupt page');
  }
});

test('AC3: a page without <title> fails with a named diagnostic', async () => {
  const s = setup({ fixtures: { 'article.html': articleHtml({ title: null }) } });
  const run = await runThroughLoop(s);
  assert.equal(run.failed, 1);
  const step = s.db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.ok(step.error.startsWith(`seed ${s.seedUrl('article.html')}: `), step.error);
  assert.match(step.error, /missing <title>/);
  assert.equal(countRows(s.db, 'raw_records'), 0);
  assert.ok(!fs.existsSync(s.snapshotsRoot));
});

test('AC3: a missing seed file fails its step; the other steps still run', async () => {
  const s = setup({
    fixtures: { 'absent.html': null, 'article.html': articleHtml() },
    seedOrder: ['absent.html', 'article.html'],
  });
  const run = await runThroughLoop(s);
  assert.equal(run.failed, 1);
  assert.equal(run.done, 1, 'the valid seed is unaffected by the failed one');
  assert.equal(countRows(s.db, 'raw_records'), 1);
  const failed = s.db.prepare("SELECT error FROM run_log WHERE status = 'failed'").get();
  assert.ok(failed.error.startsWith(`seed ${s.seedUrl('absent.html')}: `), failed.error);
});

test('AC4: content_hash is the sha256 of the stored text.md bytes re-read from disk', async () => {
  const s = setup();
  await runThroughLoop(s);
  const record = s.db.prepare('SELECT content_hash, snapshot_path FROM raw_records').get();
  const stored = fs.readFileSync(path.join(record.snapshot_path, 'text.md'));
  assert.equal(record.content_hash, sha256Hex(stored), 'hash matches the file as stored');
  assert.ok(!stored.includes(13), 'no CR bytes — the hash pins the LF bytes as written');
});

test('a seed with a scheme neither the loader nor the crawl pipeline serves stays progress-only', async () => {
  // G17.02: file:// seeds snapshot, http(s) seeds crawl — everything else
  // (ftp:// here) completes as a progress step without any page source.
  const s = setup({ seedLines: '  - ftp://news.example/gdansk' });
  const run = await runThroughLoop(s);
  assert.equal(run.done, 1, 'the step still completes, as in G17.01.a');
  assert.equal(countRows(s.db, 'raw_records'), 0, 'no record without a page source');
  assert.ok(!fs.existsSync(s.snapshotsRoot), 'no snapshot written');
});
