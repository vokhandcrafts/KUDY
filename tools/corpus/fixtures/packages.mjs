// Synthetic library fixture shared by the G19.03 store/backup/CLI tests.
// Everything here is synthetic (25 §9: only code, schemas, synthetic fixtures
// and common results enter Git): the ids are hashes of obvious strings, the
// image bytes are hand-made magic-byte headers. The on-disk layout mirrors
// importArticle's package tree (articles/<article_id>/revisions/<revision_id>/
// extractions/<profile>/v<N>/... plus images/), so listLibraryPackages and
// backupCorpus read it like a real library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sha256Hex } from '../extract.mjs';

const EXTRACTOR = 'wiki-html/v1';
const VOCAB = 'gdansk-v1';

export { EXTRACTOR, VOCAB };

// Builds a fresh library root with one package: raw.html hashes to the
// revision id, each image to its asset id, article.json is the registered
// document verbatim — exactly the anchors the store and the backup verify.
export function makeSyntheticLibrary(t, { seed = 'synthetic-article' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-library-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const rawBytes = `raw html of ${seed}`.repeat(3);
  const revisionId = sha256Hex(rawBytes);
  const articleId = sha256Hex(seed);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const webpBytes = Buffer.concat([Buffer.from('RIFF....WEBP', 'utf8'), Buffer.from([9, 8, 7])]);
  const assetA = sha256Hex(pngBytes);
  const assetB = sha256Hex(webpBytes);
  const fragmentId = sha256Hex(`${seed}-fragment`);
  const document = {
    article_id: articleId,
    revision_id: revisionId,
    extractor_version: EXTRACTOR,
    title: `Synthetic article ${seed}`,
    fragments: [
      {
        fragment_id: fragmentId,
        article_id: articleId,
        revision_id: revisionId,
        extractor_version: EXTRACTOR,
        kind: 'body',
        section_path: ['Тэст'],
        text: 'Адзін цэлы тэкст фікстуры з згадкай пра асобу.',
        source_locator: 'p[1]',
      },
    ],
    links: [{ visible_text: 'спасылка фікстуры', target: 'synthetic-target', source_locator: 'p[1]' }],
    images: [
      { asset_id: assetA, source_locator: 'media-a' },
      { asset_id: assetB, source_locator: 'media-b' },
    ],
  };
  const base = path.join(root, 'articles', articleId, 'revisions', revisionId);
  fs.mkdirSync(path.join(base, 'extractions', EXTRACTOR), { recursive: true });
  fs.mkdirSync(path.join(base, 'images'), { recursive: true });
  fs.writeFileSync(path.join(base, 'raw.html'), rawBytes);
  fs.writeFileSync(path.join(base, 'extractions', EXTRACTOR, 'article.json'), JSON.stringify(document));
  fs.writeFileSync(path.join(base, 'extractions', EXTRACTOR, 'text.md'), `${document.fragments[0].text}\n`);
  fs.writeFileSync(path.join(base, 'images', `${assetA}.png`), pngBytes);
  fs.writeFileSync(path.join(base, 'images', `${assetB}.webp`), webpBytes);
  return {
    root,
    dbPath: path.join(root, 'corpus.db'),
    articleId,
    revisionId,
    fragmentId,
    assetA,
    assetB,
    document,
    packageRecord: {
      articleId,
      revisionId,
      extractorVersion: EXTRACTOR,
      document,
      media: [
        { mediaKey: 'media-a', assetId: assetA, extension: 'png' },
        { mediaKey: 'media-b', assetId: assetB, extension: 'webp' },
      ],
    },
  };
}

// A synthetic level-1 result over the fixture's fragment; the range stays
// inside the fragment text (the contract validator checks code-point bounds).
export function syntheticLevel1(library, runId, { entitySuffix = '' } = {}) {
  const text = library.document.fragments[0].text;
  const at = text.indexOf('асобу');
  return {
    article_id: library.articleId,
    revision_id: library.revisionId,
    run_id: runId,
    vocabulary_version: VOCAB,
    entities: [
      { entity_id: `ent-${runId}${entitySuffix}`, kind: 'place', name: 'Фікстура', matching_status: 'unmatched' },
    ],
    mentions: [
      { kind: 'place', fragment_id: library.fragmentId, start: at, end: at + 5, mention_type: 'depicted', proposed_entity_id: `ent-${runId}${entitySuffix}` },
    ],
    time_references: [],
    place_references: [],
    topic_assignments: [],
    hooks: [],
    context_needs: [],
  };
}
