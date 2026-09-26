import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCampaign } from './campaign.mjs';
import { cleanCampaign, cleanRecord, parseRawBlocks } from './clean.mjs';
import { PACKAGES } from './packages.mjs';
import { exportReviewBundle } from './review.mjs';
import { processFetchedPage } from './snapshot.mjs';
import {
  articleHtml,
  campaignYaml,
  collectAndClean,
  makeTempDir,
  NEWS_BODY,
  rawRecord,
  seedCampaign,
  writeCampaignFile,
} from './testkit.mjs';
import {
  claimStep,
  enqueueStep,
  fillYoutubeRecord,
  getRawRecord,
  openStore,
  sha256Hex,
  upsertRawRecord,
} from './store.mjs';

const cliPath = fileURLToPath(new URL('./collector.mjs', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

test('news snapshot cleans to a document without markers, with content, anchors and the photo in place (criteria 1, 4)', () => {
  const dir = makeTempDir();
  const { snapshot } = collectAndClean(dir);

  const cleaned = fs.readFileSync(path.join(snapshot, 'cleaned', 'v1.md'), 'utf8');
  // Negative assertions, one per drop rule of news-v1: nav, ad, read-also.
  assert.doesNotMatch(cleaned, /Меню:/);
  assert.doesNotMatch(cleaned, /Рэклама:/);
  assert.doesNotMatch(cleaned, /Чытайце таксама/);
  // No content loss: every content paragraph of the fixture survives.
  assert.match(cleaned, /The \[shipyard history\]\(https:\/\/gdansk\.example\/history\) began in 1844\./);
  assert.match(cleaned, /\[main hall guide\]\(file:\/\/\/[^\s)]*museum\/main-hall\.html\)/);
  assert.match(cleaned, /No links in this paragraph at all\./);
  // Anchors keep the anchor+URL form; the photo stays at its position between
  // the content paragraphs with the figure caption preserved.
  assert.match(cleaned, /!\[Stocznia\]\(media\/gdansk-shipyard-turns-into-a-museum-img-01\.png\)/);
  assert.match(cleaned, /_Stocznia Gdańska, 1980_/);
  const order = [
    cleaned.indexOf('began in 1844'),
    cleaned.indexOf('!['),
    cleaned.indexOf('main hall guide'),
  ];
  assert.ok(order[0] < order[1] && order[1] < order[2], `photo out of position: ${order}`);
  // Date and language moved into the front matter; the package is named.
  assert.match(cleaned, /^package: news-v1$/m);
  assert.match(cleaned, /^published_at: 2026-09-20$/m);
  assert.match(cleaned, /^language: pl$/m);
});

test('cleaning never rewrites the raw snapshot (criterion 2)', () => {
  const dir = makeTempDir();
  const { snapshot, hashes } = collectAndClean(dir);
  const after = ['text.md', 'snapshot.html', 'metadata.json'].map((name) => sha256Hex(fs.readFileSync(path.join(snapshot, name))));
  assert.deepEqual(after, hashes, 'raw snapshot bytes changed during cleaning');
  assert.ok(fs.existsSync(path.join(snapshot, 'cleaned', 'v1.md')));
});

test('a rule change re-runs into version 2, both versions retained, run log names the package (criterion 3)', () => {
  const dir = makeTempDir();
  const campaign = parseCampaign(campaignYaml()).campaign;
  const snapshotsRoot = path.join(dir, 'snapshots');
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const html = articleHtml({ body: NEWS_BODY.filter((paragraph) => !paragraph.startsWith('<figure')) });
  const pagePath = path.join(dir, 'seed-page.html');
  fs.writeFileSync(pagePath, html, 'utf8');
  // The production snapshot writer arranges the record — no hand-built rows.
  processFetchedPage(db, campaign, 'c1', {
    url: pathToFileURL(pagePath).href,
    html,
    now: '2026-09-25T00:00:00.000Z',
    snapshotsRoot,
  });

  const first = cleanCampaign(db, 'c1');
  assert.deepEqual(first, { eligible: 1, written: 1, unchanged: 0, failed: 0, skippedFailed: 0 });
  // Same package version again: the record's latest version already carries
  // it, so nothing is enqueued — the run converges without a new version.
  const repeat = cleanCampaign(db, 'c1');
  assert.equal(repeat.written, 0);
  assert.equal(repeat.unchanged, 0);

  const snapshotDir = path.join(snapshotsRoot, 'c1'.slice(0, 12), fs.readdirSync(path.join(snapshotsRoot, 'c1'.slice(0, 12)))[0]);
  assert.deepEqual(fs.readdirSync(path.join(snapshotDir, 'cleaned')).sort(), ['v1.md'], 'only v1 after two runs of the same package');
  const v1 = fs.readFileSync(path.join(snapshotDir, 'cleaned', 'v1.md'), 'utf8');
  assert.match(v1, /No links in this paragraph at all\./);

  // A changed rule package (version 2) cleans again: v2 is written next to
  // the untouched v1, and the run log names the package version.
  const newsV2 = { ...PACKAGES.news, version: 2, drop: [...PACKAGES.news.drop, /No links/i] };
  const second = cleanCampaign(db, 'c1', { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
  assert.equal(second.written, 1);
  const cleanedFiles = fs.readdirSync(path.join(snapshotDir, 'cleaned')).sort();
  assert.deepEqual(cleanedFiles, ['v1.md', 'v2.md'], 'both versions retained');
  const v2 = fs.readFileSync(path.join(snapshotDir, 'cleaned', 'v2.md'), 'utf8');
  assert.doesNotMatch(v2, /No links/);
  assert.match(v2, /^package: news-v2$/m);

  const logRows = db.prepare("SELECT detail FROM run_log WHERE kind = 'clean' ORDER BY id").all();
  assert.ok(logRows.some((row) => /"package":"news","package_version":2/.test(row.detail)), `run log without the package version: ${JSON.stringify(logRows)}`);
  assert.ok(logRows.some((row) => /package news-v2: wrote version 2/.test(row.detail)));

  // Rollback path: re-running the good package version cleans from raw again
  // (the raw was never touched) and writes the next version.
  const rollback = cleanCampaign(db, 'c1');
  assert.equal(rollback.written, 1);
  const v3 = fs.readFileSync(path.join(snapshotDir, 'cleaned', 'v3.md'), 'utf8');
  assert.match(v3, /^package: news-v1$/m);
  assert.match(v3, /No links in this paragraph at all\./);
});

test('wiki snapshot cleans: citations stripped, hatnote dropped, anchors kept (criterion 1)', () => {
  const dir = makeTempDir();
  const campaign = parseCampaign(campaignYaml()).campaign;
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const html = [
    '<!DOCTYPE html>',
    '<html lang="pl">',
    '<head><title>Stocznia Gdańska</title></head>',
    '<body>',
    '<p>Stocznia Gdańska — zakład przemysłowy w <a href="https://pl.wikipedia.org/wiki/Gda%C5%84sk">Gdańsku</a>,<sup>[1]</sup> założony w 1844 roku.<sup>[2]</sup></p>',
    '<p>Zobacz też: Gdańsk, Westerplatte.</p>',
    '<p>Strajk w sierpniu 1980 roku dał początek Solidarności.<sup>[3]</sup></p>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  processFetchedPage(db, campaign, 'c1', {
    url: 'https://pl.wikipedia.org/wiki/Stocznia_Gda%C5%84ska',
    html,
    now: '2026-09-25T00:00:00.000Z',
    snapshotsRoot: path.join(dir, 'snapshots'),
    sourceType: 'wiki',
    enqueueImages: false,
  });

  const result = cleanCampaign(db, 'c1');
  assert.equal(result.written, 1, JSON.stringify(result));
  const [snapshotDir] = fs.readdirSync(path.join(dir, 'snapshots', 'c1'.slice(0, 12)));
  const cleaned = fs.readFileSync(path.join(dir, 'snapshots', 'c1'.slice(0, 12), snapshotDir, 'cleaned', 'v1.md'), 'utf8');
  // The strip rule removed every citation marker; the hatnote drop rule
  // removed the «see also» paragraph; content survives.
  assert.doesNotMatch(cleaned, /\[\d+\]/);
  assert.doesNotMatch(cleaned, /Zobacz też/);
  assert.match(cleaned, /założony w 1844 roku\./);
  assert.match(cleaned, /\[Gdańsku\]\(https:\/\/pl\.wikipedia\.org\/wiki\/Gda%C5%84sk\)/);
  assert.match(cleaned, /^package: wiki-v1$/m);
});

test('youtube transcript cleans: stage directions dropped, timecode anchors kept, upload date normalized (criterion 1)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const snapshotDir = path.join(dir, 'snapshots', 'yt-fixture');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  upsertRawRecord(db, rawRecord({ campaignId: 'c1', source_type: 'youtube', url, snapshot_path: null, media_dir: null }));
  // transcript.md bytes in the exact renderTranscript format (youtube.mjs).
  const transcript = [
    '[00:00:01] Witajcie w Gdańsku.',
    '[00:00:05] [музыка]',
    '[00:00:09] Stocznia Gdańska zaczęła strajk w sierpniu 1980.',
    '[00:00:14] To początek Solidarności.',
  ].join('\n\n') + '\n';
  fs.writeFileSync(path.join(snapshotDir, 'transcript.md'), transcript, 'utf8');
  fs.writeFileSync(
    path.join(snapshotDir, 'metadata.json'),
    JSON.stringify({
      title: 'Gdansk shipyard — the August story',
      channel: 'History of the Coast',
      upload_date: '20240815',
      duration_s: 217.4,
      language: 'pl',
      subtitle_kind: 'manual',
      subtitle_language: 'pl',
      cover: null,
    }, null, 2) + '\n'
  );
  fillYoutubeRecord(db, {
    campaignId: 'c1',
    url,
    contentHash: sha256Hex(Buffer.from(transcript, 'utf8')),
    snapshotPath: snapshotDir,
    mediaDir: path.join(snapshotDir, 'media'),
  });

  const result = cleanCampaign(db, 'c1');
  assert.equal(result.written, 1, JSON.stringify(result));
  const cleaned = fs.readFileSync(path.join(snapshotDir, 'cleaned', 'v1.md'), 'utf8');
  // The stage-direction paragraph is dropped whole; the content paragraphs
  // keep their timecode anchors.
  assert.doesNotMatch(cleaned, /музыка/);
  assert.match(cleaned, /\[00:00:01\] Witajcie w Gdańsku\./);
  assert.match(cleaned, /\[00:00:09\] Stocznia Gdańska zaczęła strajk w sierpniu 1980\./);
  assert.match(cleaned, /^package: youtube-v1$/m);
  // The YYYYMMDD upload_date moves into published_at as an ISO date.
  assert.match(cleaned, /^published_at: 2024-08-15$/m);
  assert.match(cleaned, /^language: pl$/m);
});

test('a cleaning step left running by an interrupted process converges instead of duplicating (rule 14)', () => {
  const dir = makeTempDir();
  const campaign = parseCampaign(campaignYaml()).campaign;
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const html = articleHtml();
  const pagePath = path.join(dir, 'seed-page.html');
  fs.writeFileSync(pagePath, html, 'utf8');
  const { recordId, snapshotDir } = processFetchedPage(db, campaign, 'c1', {
    url: pathToFileURL(pagePath).href,
    html,
    now: '2026-09-25T00:00:00.000Z',
    snapshotsRoot: path.join(dir, 'snapshots'),
  });

  // Simulate the crash: a v2 step claimed ('running'), then the version was
  // written by cleanRecord directly — the process died before completing the
  // step. The next clean run finds the record already at the current package
  // version: the stale step completes as 'unchanged', no second v2 file.
  cleanCampaign(db, 'c1');
  const newsV2 = { ...PACKAGES.news, version: 2, drop: [...PACKAGES.news.drop, /No links/i] };
  const now = '2026-09-25T01:00:00.000Z';
  enqueueStep(db, 'c1', 'clean', `${recordId}:news-v2#v2`, now, JSON.stringify({ recordId, package: 'news', package_version: 2, target_version: 2 }));
  const [stale] = db.prepare("SELECT id FROM run_log WHERE kind = 'clean' AND ref LIKE '%news-v2%'").all();
  claimStep(db, stale.id, now);
  cleanRecord(db, getRawRecord(db, recordId), newsV2, { now });

  const result = cleanCampaign(db, 'c1', { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
  assert.deepEqual(result, { eligible: 1, written: 0, unchanged: 1, failed: 0, skippedFailed: 0 });
  assert.deepEqual(fs.readdirSync(path.join(snapshotDir, 'cleaned')).sort(), ['v1.md', 'v2.md'], 'no duplicate version file');
  const staleRow = db.prepare('SELECT status FROM run_log WHERE id = ?').get(stale.id);
  assert.equal(staleRow.status, 'done', 'the stale step is completed, not re-run');
});

test('export-review writes a browseable bundle whose documents open with citations (criterion 5)', () => {
  const dir = makeTempDir();
  const { campaignFile, dbPath, snapshot } = collectAndClean(dir);
  const exportRun = runCli(['export-review', '--campaign', campaignFile, '--db', dbPath]);
  assert.equal(exportRun.status, 0, exportRun.stderr);
  const reviewDir = path.join(path.dirname(snapshot), 'review');
  assert.match(exportRun.stdout, /review bundle at /);
  assert.ok(exportRun.stdout.includes(reviewDir), exportRun.stdout);
  const index = fs.readFileSync(path.join(reviewDir, 'index.md'), 'utf8');
  assert.match(index, /^# Агляд ачысткі/m);
  const [entryFile] = index.match(/\]\(([^)]+\.md)\)/).slice(1);
  const doc = fs.readFileSync(path.join(reviewDir, entryFile), 'utf8');
  // The document opens with the visible citation: source URL + collection date.
  assert.match(doc, /^# Gdansk shipyard turns into a museum\n\nКрыніца: file:\/\//);
  assert.match(doc, /^Забрана: \d{4}-\d{2}-\d{2}T/m);
  assert.match(doc, /began in 1844/, 'the cleaned body is in the bundle');

  // The bundle is derived output: a second export rewrites it byte-identical.
  const indexHash = sha256Hex(fs.readFileSync(path.join(reviewDir, 'index.md')));
  runCli(['export-review', '--campaign', campaignFile, '--db', dbPath]);
  assert.equal(sha256Hex(fs.readFileSync(path.join(reviewDir, 'index.md'))), indexHash);
});

test('export-review over a campaign with nothing cleaned writes the empty index, not a crash', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { entries } = exportReviewBundle(db, 'c1', { reviewDir: path.join(dir, 'review') });
  assert.equal(entries.length, 0);
  const index = fs.readFileSync(path.join(dir, 'review', 'index.md'), 'utf8');
  assert.match(index, /Ачышчаных дакументаў яшчэ няма/);
});

// Arranges one collected web record through the production snapshot writer
// over an articleHtml fixture (or a caller's html/url); returns the store and
// the snapshot dir.
function arrangeCollectedRecord(dir, { html = articleHtml(), url } = {}) {
  const campaign = parseCampaign(campaignYaml()).campaign;
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const pagePath = path.join(dir, 'seed-page.html');
  fs.writeFileSync(pagePath, html, 'utf8');
  const { snapshotDir } = processFetchedPage(db, campaign, 'c1', {
    url: url ?? pathToFileURL(pagePath).href,
    html,
    now: '2026-09-25T00:00:00.000Z',
    snapshotsRoot: path.join(dir, 'snapshots'),
  });
  return { db, snapshotDir };
}

// Arranges the truncated-snapshot record: registered, but its snapshot dir
// holds nothing (the raw text.md is gone).
function arrangeBrokenRecord(dir, db) {
  const brokenDir = path.join(dir, 'snapshots', 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  upsertRawRecord(db, rawRecord({ campaignId: 'c1', url: 'https://news.example/broken', snapshot_path: brokenDir, media_dir: path.join(brokenDir, 'media') }));
  return brokenDir;
}

test('a record without its snapshot file fails its own step with a diagnostic; the rest still clean (rule 14)', () => {
  const dir = makeTempDir();
  const { db } = arrangeCollectedRecord(dir);
  arrangeBrokenRecord(dir, db);

  const result = cleanCampaign(db, 'c1');
  assert.equal(result.failed, 1, JSON.stringify(result));
  assert.equal(result.written, 1, 'the healthy record still cleans');
  const failedRow = db.prepare("SELECT ref, error FROM run_log WHERE kind = 'clean' AND status = 'failed'").get();
  assert.match(failedRow.error, /https:\/\/news\.example\/broken/);
  assert.match(failedRow.error, /cannot read text\.md/);
});

// Two corrupt-metadata cases, each on a fresh record: truncated JSON and
// valid JSON that is not an object (rule 14's wrong-type case) — each answers
// its own diagnostic, no version is written for a failed step.
test('corrupt metadata.json fails the step with a named diagnostic, not a crash (rule 14)', () => {
  const cases = [
    ['{not json', /cannot read metadata\.json/],
    ['null', /metadata\.json must hold an object/],
  ];
  for (const [content, diagnostic] of cases) {
    const dir = makeTempDir();
    const { db, snapshotDir } = arrangeCollectedRecord(dir);
    fs.writeFileSync(path.join(snapshotDir, 'metadata.json'), content, 'utf8');

    const result = cleanCampaign(db, 'c1');
    assert.equal(result.failed, 1, `${content}: ${JSON.stringify(result)}`);
    const failedRow = db.prepare("SELECT error FROM run_log WHERE kind = 'clean' AND status = 'failed'").get();
    assert.match(failedRow.error, diagnostic);
    assert.equal(fs.existsSync(path.join(snapshotDir, 'cleaned')), false, 'no version is written for a failed step');
  }
});

test('a failed clean step is not retried by a re-run; the skip stays visible (rule 14)', () => {
  const dir = makeTempDir();
  const { db } = arrangeCollectedRecord(dir);
  const brokenDir = arrangeBrokenRecord(dir, db);

  const first = cleanCampaign(db, 'c1');
  assert.equal(first.failed, 1, JSON.stringify(first));

  // Same package version again: the failed step stays terminal (the ref
  // conflicts, claimableSteps serves pending/running only) — the re-run
  // reports the skip instead of a misleading `failed 0`.
  const retry = cleanCampaign(db, 'c1');
  assert.deepEqual(retry, { eligible: 2, written: 0, unchanged: 0, failed: 0, skippedFailed: 1 });
  const failedRows = db.prepare("SELECT COUNT(*) AS n FROM run_log WHERE kind = 'clean' AND status = 'failed'").get();
  assert.equal(Number(failedRows.n), 1, 'no second failed row, no silent re-run');

  // Recovery: fix the cause, then a new package version enqueues a fresh
  // attempt — the new step supersedes the failed one, so the skip count is
  // zero and both records clean from the untouched raw.
  fs.writeFileSync(path.join(brokenDir, 'text.md'), 'Repaired paragraph.\n', 'utf8');
  fs.writeFileSync(path.join(brokenDir, 'metadata.json'), JSON.stringify({ title: 'Repaired page' }), 'utf8');
  const newsV2 = { ...PACKAGES.news, version: 2 };
  const recovery = cleanCampaign(db, 'c1', { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
  assert.equal(recovery.skippedFailed, 0, 'the fresh attempt supersedes the failed step');
  assert.equal(recovery.written, 2, 'both records clean from raw');
  const after = cleanCampaign(db, 'c1', { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
  assert.deepEqual(after, { eligible: 2, written: 0, unchanged: 0, failed: 0, skippedFailed: 0 });
});

test('rules that drop every block refuse to write an empty document (rule 14)', () => {
  const dir = makeTempDir();
  const onlyAd = [
    '<!DOCTYPE html>',
    '<html lang="pl">',
    '<head><title>Only an ad</title></head>',
    '<body>',
    '  <p>Рэклама: толькі сёння зніжка.</p>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
  const { db, snapshotDir } = arrangeCollectedRecord(dir, { html: onlyAd, url: 'https://news.example/only-ad' });

  // The production news-v1 package matches the only paragraph — the engine
  // must refuse the empty document instead of writing a husk.
  const result = cleanCampaign(db, 'c1');
  assert.equal(result.failed, 1, JSON.stringify(result));
  const failedRow = db.prepare("SELECT error FROM run_log WHERE kind = 'clean' AND status = 'failed'").get();
  assert.match(failedRow.error, /drop every block/);
  assert.equal(fs.existsSync(path.join(snapshotDir, 'cleaned')), false, 'no version is written for an empty document');
});

test('a re-export after a new cleaned version leaves no stale bundle files', () => {
  const dir = makeTempDir();
  const { db } = arrangeCollectedRecord(dir);
  const reviewDir = path.join(dir, 'review');
  cleanCampaign(db, 'c1');
  exportReviewBundle(db, 'c1', { reviewDir });

  const newsV2 = { ...PACKAGES.news, version: 2 };
  cleanCampaign(db, 'c1', { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
  const { entries } = exportReviewBundle(db, 'c1', { reviewDir });

  assert.deepEqual(fs.readdirSync(reviewDir).sort(), ['index.md', ...entries.map((entry) => entry.file)].sort());
  assert.ok(entries[0].file.includes('-v2.md'), `the bundle lists the latest version: ${entries[0].file}`);
});

test('a failing export leaves the previous bundle intact (the read-before-refresh order)', () => {
  const dir = makeTempDir();
  const { db, snapshotDir } = arrangeCollectedRecord(dir);
  const reviewDir = path.join(dir, 'review');
  cleanCampaign(db, 'c1');
  exportReviewBundle(db, 'c1', { reviewDir });
  const bundleBefore = fs.readdirSync(reviewDir).sort().map((file) => [file, sha256Hex(fs.readFileSync(path.join(reviewDir, file)))]);

  // The cleaned document vanishes from disk (the DB row still names it): the
  // export must fail with a diagnostic AND leave the old bundle untouched —
  // reverting the read-before-refresh order (wipe first, read after) fails
  // this test with an emptied review/ directory.
  fs.rmSync(path.join(snapshotDir, 'cleaned'), { recursive: true, force: true });
  assert.throws(() => exportReviewBundle(db, 'c1', { reviewDir }), /no such file or directory/);
  const bundleAfter = fs.readdirSync(reviewDir).sort().map((file) => [file, sha256Hex(fs.readFileSync(path.join(reviewDir, file)))]);
  assert.deepEqual(bundleAfter, bundleBefore, 'the previous bundle survived the failed export');
});

test('CLI: clean and export-review on a never-run campaign answer with a diagnostic, exit 1', () => {
  const dir = makeTempDir();
  const campaignFile = writeCampaignFile(dir, campaignYaml({ youtube: null }));
  for (const command of ['clean', 'export-review']) {
    const result = runCli([command, '--campaign', campaignFile, '--db', path.join(dir, 'db.sqlite')]);
    assert.equal(result.status, 1, `${command}: ${result.stderr}`);
    assert.match(result.stderr, /campaign file is not registered — run it first/);
  }
});

test('CLI: clean without --campaign answers with usage, exit 2', () => {
  const result = runCli(['clean', '--db', path.join(makeTempDir(), 'db.sqlite')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /clean requires --campaign/);
});

test('parseRawBlocks keeps media blocks verbatim and splits paragraphs on blank lines', () => {
  const blocks = parseRawBlocks(
    '![alt](media/x.png)\n_caption_\n\nFirst paragraph.\n\nSecond paragraph.\n'
  );
  assert.deepEqual(
    blocks.map((block) => [block.kind, block.text]),
    [
      ['media', '![alt](media/x.png)\n_caption_'],
      ['paragraph', 'First paragraph.'],
      ['paragraph', 'Second paragraph.'],
    ]
  );
});
