// G19.02 — behavioral checks for the safe package import (issue #459).
// Every test drives the production importArticle (real extraction factory,
// synthetic input in temp directories only — no real sources, no network).
// Named checks from the brief: identity_not_title, retained_extractions,
// traversal_and_junction, partial_write_retry, missing_local_media — plus the
// CLI unpack contract. Reverting the import behavior must turn these red.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

import { articleIdFor, importArticle } from './import.mjs';
import { CorpusDiagnostic, createExtractionBrowserFactory, sha256Hex } from './extract.mjs';

const execFileAsync = promisify(execFile);

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// The import path includes the extraction profile, so it needs the same
// pinned Playwright browser; without it the suite self-skips visibly.
let browserProblem = null;
try {
  const { chromium } = await import('playwright');
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    browserProblem = `chromium binary is missing at ${executable} — run: npx playwright install chromium`;
  }
  } catch {
    browserProblem = 'playwright is not installed — import checks need: npm install && npx playwright install chromium';
  }
  // node:test marks any present `skip` option as a skip — even null — so the
  // no-problem case must be undefined, never null.
  const skip = browserProblem ?? undefined;

let factoryPromise = null;
const sharedFactory = async () => {
  if (!factoryPromise) factoryPromise = createExtractionBrowserFactory();
  return factoryPromise;
};

after(async () => {
  if (factoryPromise) {
    const factory = await factoryPromise;
    await factory.close();
  }
});

const pageHtml = (title, paragraph) =>
  `<!DOCTYPE html><html lang="be"><head><meta charset="utf-8"><title>${title} — Прыкладавікі</title></head>` +
  `<body><h1 id="firstHeading">${title}</h1><div id="mw-content-text"><div class="mw-parser-output">` +
  `<p>${paragraph}</p></div></div></body></html>`;

// Synthetic input tree + empty library root, both removed with the test.
function makeTree(t, files) {
  const inputRoot = mkdtempSync(path.join(os.tmpdir(), 'corpus-input-'));
  const libraryRoot = mkdtempSync(path.join(os.tmpdir(), 'corpus-library-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(inputRoot, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  t.after(() => {
    rmSync(inputRoot, { recursive: true, force: true });
    rmSync(libraryRoot, { recursive: true, force: true });
  });
  return { inputRoot, libraryRoot };
}

const runImport = async (record, { inputRoot, libraryRoot }, extractorVersion = 'wiki-html/v1', factory) =>
  importArticle(record, {
    inputRoot,
    libraryRoot,
    sourceNamespace: 'fixture-wiki',
    extractorVersion,
    browserFactory: factory ?? (await sharedFactory()),
  });

test('identity_not_title', { skip }, async (t) => {
  const tree = makeTree(t, {
    'pages/a.html': pageHtml('Садзіба Вынаходлівых', 'Тэкст першага артыкула.'),
    'pages/b.html': pageHtml('Садзіба Вынаходлівых', 'Іншы тэкст пад той жа назвай.'),
  });
  const recordA = { source_record_key: 'wiki-0001', html_path: 'pages/a.html', language: 'be', rights: 'research_only' };
  const recordB = { source_record_key: 'wiki-0002', html_path: 'pages/b.html', language: 'be', rights: 'research_only' };

  const pkgA = await runImport(recordA, tree);
  const pkgB = await runImport(recordB, tree);

  assert.notEqual(pkgA.articleId, pkgB.articleId, 'a shared title never merges two records');
  assert.equal(pkgA.articleId, articleIdFor('fixture-wiki', 'wiki-0001'));
  assert.equal(pkgB.articleId, articleIdFor('fixture-wiki', 'wiki-0002'));

  const rawBytes = readFileSync(path.join(tree.inputRoot, 'pages/a.html'));
  assert.equal(pkgA.revisionId, sha256Hex(rawBytes), 'revision id is the hash of the untouched bytes');
  assert.notEqual(pkgA.revisionId, pkgB.revisionId);
  assert.deepEqual(readFileSync(path.join(pkgA.paths.revisionDir, 'raw.html')), rawBytes, 'raw.html is byte-identical');

  assert.ok(existsSync(path.join(pkgA.paths.extractionDir, 'article.json')));
  assert.ok(existsSync(path.join(pkgA.paths.extractionDir, 'text.md')));

  const again = await runImport(recordA, tree);
  assert.equal(again.alreadyPresent, true, 'unchanged data does not duplicate');
  assert.equal(readdirSync(path.join(tree.libraryRoot, 'articles')).length, 2);
  assert.equal(readdirSync(path.join(pkgA.paths.articleDir, 'revisions')).length, 1);
});

test('retained_extractions', { skip }, async (t) => {
  const tree = makeTree(t, { 'pages/a.html': pageHtml('Камяніца', 'Адзін тэкст, дзве рэвізіі ачысткі.') });
  const record = { source_record_key: 'wiki-retain', html_path: 'pages/a.html', language: 'be', rights: 'research_only' };

  const first = await runImport(record, tree, 'wiki-html/v1');
  const v1Bytes = readFileSync(path.join(first.paths.extractionDir, 'article.json'));

  const second = await runImport(record, tree, 'wiki-html/v2');
  assert.ok(second.paths.extractionDir.endsWith(path.join('extractions', 'wiki-html/v2')));
  assert.ok(existsSync(path.join(first.paths.extractionDir, 'article.json')), 'the earlier extraction is retained');
  assert.deepEqual(readFileSync(path.join(first.paths.extractionDir, 'article.json')), v1Bytes, 'earlier files stay byte-identical');

  const v2Document = JSON.parse(readFileSync(path.join(second.paths.extractionDir, 'article.json'), 'utf8'));
  assert.equal(v2Document.extractor_version, 'wiki-html/v2');
  const v1Document = JSON.parse(v1Bytes.toString('utf8'));
  assert.notEqual(v1Document.fragments[0].fragment_id, v2Document.fragments[0].fragment_id, 'fragment ids bind to the extractor version');
});

test('traversal_and_junction', { skip }, async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'corpus-escape-'));
  const inputRoot = path.join(base, 'input');
  const libraryRoot = path.join(base, 'library');
  mkdirSync(path.join(inputRoot, 'pages'), { recursive: true });
  mkdirSync(path.join(inputRoot, 'images'), { recursive: true });
  mkdirSync(libraryRoot, { recursive: true });
  writeFileSync(path.join(inputRoot, 'pages/a.html'), pageHtml('Камяніца', 'Звычайны тэкст.'));
  const outsideFile = path.join(base, 'outside.html');
  writeFileSync(outsideFile, pageHtml('Поза коранем', 'Гэта не павінен быць прачытана.'));
  const outsideBytes = readFileSync(outsideFile);
  const inputBytes = readFileSync(path.join(inputRoot, 'pages/a.html'));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const attempt = (record) => runImport(record, { inputRoot, libraryRoot });
  const diagnostic = (rule) => (error) => error instanceof CorpusDiagnostic && error.rule === rule;

  await assert.rejects(
    attempt({ source_record_key: 'k1', html_path: '../outside.html', language: 'be', rights: 'research_only' }),
    diagnostic('record-path-unsafe'),
    '`..` is rejected at the manifest boundary'
  );

  symlinkSync(outsideFile, path.join(inputRoot, 'pages/link.html'));
  await assert.rejects(
    attempt({ source_record_key: 'k2', html_path: 'pages/link.html', language: 'be', rights: 'research_only' }),
    diagnostic('path-escapes-root'),
    'a symlink pointing outside the input root is rejected (junction on Windows is the same realpath check)'
  );

  symlinkSync(outsideFile, path.join(inputRoot, 'images/escape.png'));
  await assert.rejects(
    attempt({
      source_record_key: 'k3',
      html_path: 'pages/a.html',
      language: 'be',
      rights: 'research_only',
      media: [{ media_key: 'm1', local_path: 'images/escape.png', rights: 'research_only' }],
    }),
    diagnostic('path-escapes-root'),
    'a media symlink pointing outside is rejected'
  );

  writeFileSync(path.join(inputRoot, 'pages/big.html'), Buffer.concat([Buffer.from(pageHtml('Вялізны', 'Пачатак.')), Buffer.alloc(20 * 1024 * 1024, 32)]));
  await assert.rejects(
    attempt({ source_record_key: 'k4', html_path: 'pages/big.html', language: 'be', rights: 'research_only' }),
    diagnostic('html-too-large'),
    'oversize html is rejected before any write'
  );

  await assert.rejects(
    attempt({
      source_record_key: 'k5',
      html_path: 'pages/a.html',
      language: 'be',
      rights: 'research_only',
      media: [{ media_key: 'absent', local_path: 'images/absent.png', rights: 'research_only' }],
    }),
    diagnostic('media-file-missing'),
    'a declared media file that does not exist is a named diagnostic'
  );

  writeFileSync(path.join(inputRoot, 'images/mislabeled.jpg'), PNG_BYTES);
  await assert.rejects(
    attempt({
      source_record_key: 'k6',
      html_path: 'pages/a.html',
      language: 'be',
      rights: 'research_only',
      media: [{ media_key: 'm2', local_path: 'images/mislabeled.jpg', rights: 'research_only' }],
    }),
    diagnostic('media-mime-mismatch'),
    'bytes that contradict the declared extension are rejected'
  );

  assert.ok(!existsSync(path.join(libraryRoot, 'articles')), 'no partial registration after any failure');
  assert.deepEqual(readFileSync(outsideFile), outsideBytes, 'the escaped-to file was never touched');
  assert.deepEqual(readFileSync(path.join(inputRoot, 'pages/a.html')), inputBytes, 'input bytes stay identical');
});

test('partial_write_retry', { skip }, async (t) => {
  const tree = makeTree(t, { 'pages/a.html': pageHtml('Мост', 'Першы імпарт, затым збоявы паўтор.') });
  const record = { source_record_key: 'wiki-retry', html_path: 'pages/a.html', language: 'be', rights: 'research_only' };

  const first = await runImport(record, tree);
  const revisionDir = first.paths.revisionDir;
  const rawBefore = readFileSync(path.join(revisionDir, 'raw.html'));
  const documentBefore = readFileSync(path.join(revisionDir, 'extractions', 'wiki-html/v1', 'article.json'));

  // An interrupted retry: staging holds the new raw.html, then the browser
  // dies — the old revision must stay readable and no staging may survive.
  const brokenFactory = { open: async () => { throw new Error('browser died mid-run'); } };
  await assert.rejects(runImport(record, tree, 'wiki-html/v2', brokenFactory), (error) => error.message === 'browser died mid-run');
  assert.deepEqual(readFileSync(path.join(revisionDir, 'raw.html')), rawBefore);
  assert.deepEqual(readFileSync(path.join(revisionDir, 'extractions', 'wiki-html/v1', 'article.json')), documentBefore);
  assert.ok(!existsSync(path.join(first.paths.articleDir, 'extractions', 'wiki-html/v2')));
  assert.equal(readdirSync(first.paths.articleDir).filter((name) => name.startsWith('.staging-')).length, 0, 'staging is dropped on failure');

  // A staging path blocked by a foreign file is a named diagnostic, not a
  // silent overwrite of whatever sits there.
  writeFileSync(path.join(first.paths.articleDir, `.staging-${first.revisionId}`), 'junk');
  await assert.rejects(runImport(record, tree, 'wiki-html/v2'), (error) => error instanceof CorpusDiagnostic && error.rule === 'staging-collision');
  assert.deepEqual(readFileSync(path.join(revisionDir, 'raw.html')), rawBefore);

  // The clean retry completes exactly one revision.
  rmSync(path.join(first.paths.articleDir, `.staging-${first.revisionId}`), { force: true });
  const retry = await runImport(record, tree, 'wiki-html/v2');
  assert.equal(retry.alreadyPresent, false);
  assert.equal(readdirSync(path.join(first.paths.articleDir, 'revisions')).length, 1, 'retrying never forks a second revision');
  assert.ok(existsSync(path.join(retry.paths.extractionDir, 'article.json')));
  assert.deepEqual(readFileSync(path.join(revisionDir, 'raw.html')), rawBefore);

  const retryAgain = await runImport(record, tree, 'wiki-html/v2');
  assert.equal(retryAgain.alreadyPresent, true);
});

test('missing_local_media', { skip }, async (t) => {
  // (a) A declared local media file that does not exist rejects the record
  // before any write — a missing original is never silently skipped.
  const treeA = makeTree(t, { 'pages/a.html': pageHtml('Садзіба', 'Тэкст з адсутнай выявай.') });
  await assert.rejects(
    runImport(
      {
        source_record_key: 'wiki-media',
        html_path: 'pages/a.html',
        language: 'be',
        rights: 'research_only',
        media: [{ media_key: 'absent', local_path: 'images/absent.png', rights: 'research_only' }],
      },
      treeA
    ),
    (error) => error instanceof CorpusDiagnostic && error.rule === 'media-file-missing'
  );
  assert.ok(!existsSync(path.join(treeA.libraryRoot, 'articles')));

  // (b) A remote original without a provided file stays a missing record —
  // reported, never fetched.
  const trapsHtml = readFileSync(new URL('./fixtures/html/example-0004-traps.html', import.meta.url));
  const treeB = makeTree(t, { 'pages/traps.html': trapsHtml });
  const trapsPackage = await runImport({ source_record_key: 'wiki-traps', html_path: 'pages/traps.html', language: 'be', rights: 'research_only' }, treeB);
  assert.deepEqual(trapsPackage.missing, [{ reference: 'https://example.org/trap-remote.png', locator: 'img[1]', reason: 'no-local-file' }]);
  assert.equal(trapsPackage.media.length, 0);
  assert.equal(JSON.parse(readFileSync(path.join(trapsPackage.paths.extractionDir, 'article.json'), 'utf8')).images, undefined);
  assert.ok(!existsSync(path.join(trapsPackage.paths.revisionDir, 'images')));

  // (c) A provided media file is hashed, format-checked and bound by its
  // file name; the package carries images/<asset_id>.<extension>.
  const figurePage =
    `<!DOCTYPE html><html lang="be"><head><meta charset="utf-8"><title>План</title></head>` +
    `<body><h1 id="firstHeading">План</h1><div id="mw-content-text"><div class="mw-parser-output">` +
    `<figure><img src="//example.test/images/photo.png" alt="Плян" width="10" height="10">` +
    `<figcaption>Плян камяніцы, 1912 год</figcaption></figure>` +
    `</div></div></body></html>`;
  const treeC = makeTree(t, {
    'pages/photo.html': figurePage,
    'images/photo.png': PNG_BYTES,
  });
  const photoPackage = await runImport(
    {
      source_record_key: 'wiki-photo',
      html_path: 'pages/photo.html',
      language: 'be',
      rights: 'research_only',
      media: [{ media_key: 'photo-001', local_path: 'images/photo.png', rights: 'research_only' }],
    },
    treeC
  );
  const assetId = sha256Hex(PNG_BYTES);
  assert.deepEqual(photoPackage.media, [{ mediaKey: 'photo-001', assetId, extension: 'png' }]);
  assert.deepEqual(photoPackage.missing, [], 'the provided file covers the original by file name');
  const assetPath = path.join(photoPackage.paths.revisionDir, 'images', `${assetId}.png`);
  assert.deepEqual(readFileSync(assetPath), PNG_BYTES);
  const photoDocument = JSON.parse(readFileSync(path.join(photoPackage.paths.extractionDir, 'article.json'), 'utf8'));
  assert.deepEqual(photoDocument.images, [{ asset_id: assetId, source_locator: 'photo-001' }]);
  const markdown = readFileSync(path.join(photoPackage.paths.extractionDir, 'text.md'), 'utf8');
  assert.match(markdown, /^# План$/m);
  assert.match(markdown, /\*Плян камяніцы, 1912 год\*/);
});

test('cli_unpack_contract', { skip }, async (t) => {
  const tree2 = makeTree(t, {
    'pages/a.html': pageHtml('Першы', 'Тэкст першы.'),
    'pages/b.html': pageHtml('Другі', 'Тэкст другі.'),
  });
  const manifestPath = path.join(tree2.inputRoot, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      source_namespace: 'fixture-wiki',
      records: [
        { source_record_key: 'wiki-a', html_path: 'pages/a.html', language: 'be', rights: 'research_only' },
        { source_record_key: 'wiki-b', html_path: 'pages/b.html', language: 'be', rights: 'research_only' },
      ],
    })
  );
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const cliArguments = ['tools/corpus/cli.mjs', 'unpack', '--manifest', manifestPath, '--input-root', tree2.inputRoot, '--library-root', tree2.libraryRoot];

  const firstRun = await execFileAsync(process.execPath, cliArguments, { cwd: repoRoot });
  assert.match(firstRun.stdout, /record\[0\] imported/);
  assert.match(firstRun.stdout, /record\[1\] imported/);
  assert.match(firstRun.stdout, /unpack finished — 2 ok, 0 failed/);

  const secondRun = await execFileAsync(process.execPath, cliArguments, { cwd: repoRoot });
  assert.match(secondRun.stdout, /record\[0\] already-present/);
  assert.match(secondRun.stdout, /unpack finished — 2 ok, 0 failed/);

  // One failing record does not stop the others; the exit code reflects it.
  const brokenManifest = path.join(tree2.inputRoot, 'manifest-broken.json');
  writeFileSync(
    brokenManifest,
    JSON.stringify({
      source_namespace: 'fixture-wiki',
      records: [
        { source_record_key: 'wiki-broken', html_path: 'pages/a.html', language: 'be', rights: 'research_only', media: [{ media_key: 'absent', local_path: 'images/absent.png', rights: 'research_only' }] },
        { source_record_key: 'wiki-c', html_path: 'pages/b.html', language: 'be', rights: 'research_only' },
      ],
    })
  );
  await assert.rejects(
    execFileAsync(process.execPath, ['tools/corpus/cli.mjs', 'unpack', '--manifest', brokenManifest, '--input-root', tree2.inputRoot, '--library-root', tree2.libraryRoot], { cwd: repoRoot }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /record\[0\] media-file-missing/);
      assert.match(error.stdout, /record\[1\] imported/);
      assert.match(error.stdout, /unpack finished — 1 ok, 1 failed/);
      return true;
    }
  );
});
