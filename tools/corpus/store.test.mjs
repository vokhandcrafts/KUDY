// G19.03 behavioral checks (issue #460) — the named checks from the brief:
// duplicate_registration, orphan_fragment, unresolved_mention,
// decisions_survive_reindex, writer_lock. All data is synthetic (25 §9: у Git
// публікуюцца толькі код, схемы, штучныя фікстуры) — ids are hashes of
// obvious strings, no real source material exists on this path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CorpusDiagnostic, sha256Hex } from './extract.mjs';
import { assertNoOpenHandlesUnder } from './fixtures/handles.mjs';
import {
  CORPUS_MIGRATIONS,
  closeCorpus,
  deleteModelResults,
  getCase,
  latestIdentityDecisions,
  openCorpus,
  rebuildSearchIndex,
  recordIdentityDecision,
  registerPackage,
  saveCase,
  storeModelResult,
} from './store.mjs';

const VOCAB = 'gdansk-v1';
const EXTRACTOR = 'wiki-html/v1';

// A fresh store per test; every sandbox is removed when the test ends. The
// store closes before the removal — with a live SQLite handle the removal
// fails on Windows (EPERM) and the census fails here.
function makeStore(t, name = 'corpus.db') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-corpus-'));
  let store;
  t.after(() => {
    if (store) closeCorpus(store);
    assertNoOpenHandlesUnder(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  store = openCorpus(path.join(dir, name));
  return store;
}

function ruleOf(operation) {
  try {
    operation();
  } catch (error) {
    if (error instanceof CorpusDiagnostic) return error.rule;
    throw error;
  }
  return null;
}

// One synthetic package: id anchors are content hashes, the document satisfies
// article-fragment-v1 (two fragments, one image, one link).
function syntheticPackage({ articleSeed = 'article-a', withImage = true } = {}) {
  const articleId = sha256Hex(articleSeed);
  const revisionId = sha256Hex(`${articleSeed}-revision-1`);
  const fragmentA = sha256Hex(`${articleSeed}-fragment-body`);
  const fragmentB = sha256Hex(`${articleSeed}-fragment-caption`);
  const assetId = sha256Hex(`${articleSeed}-image-1`);
  const document = {
    article_id: articleId,
    revision_id: revisionId,
    extractor_version: EXTRACTOR,
    title: `Synthetic article ${articleSeed}`,
    fragments: [
      {
        fragment_id: fragmentA,
        article_id: articleId,
        revision_id: revisionId,
        extractor_version: EXTRACTOR,
        kind: 'body',
        section_path: ['Гісторыя'],
        text: "Месца згадкі пра асобу і яе сям'ю на галоўнай вуліцы горада.",
        source_locator: 'p[1]',
      },
      {
        fragment_id: fragmentB,
        article_id: articleId,
        revision_id: revisionId,
        extractor_version: EXTRACTOR,
        kind: 'caption',
        section_path: [],
        text: 'Падпіс пад выявай будынка.',
        source_locator: 'img[1]',
      },
    ],
    links: [{ visible_text: 'гісторыя горада', target: 'synthetic-target', source_locator: 'p[1]' }],
  };
  if (withImage) {
    document.images = [{ asset_id: assetId, source_locator: 'media_key-1' }];
  }
  const media = withImage ? [{ mediaKey: 'media_key-1', assetId, extension: 'png' }] : [];
  return { articleId, revisionId, extractorVersion: EXTRACTOR, document, media, fragmentA, fragmentB, assetId };
}

// A synthetic level-1 result over the package's fragments; the ranges stay
// inside the fragment texts (the contract validator checks code-point bounds).
function syntheticLevel1(pkg, runId) {
  const text = pkg.document.fragments[0].text;
  const at = text.indexOf('асобу');
  return {
    article_id: pkg.articleId,
    revision_id: pkg.revisionId,
    run_id: runId,
    vocabulary_version: VOCAB,
    entities: [
      { entity_id: `ent-${runId}-person`, kind: 'person', name: 'Ян', name_variants: ['Янка'], matching_status: 'proposed' },
      { entity_id: `ent-${runId}-family`, kind: 'family', name: 'Род Янаў', matching_status: 'unmatched' },
    ],
    mentions: [
      { kind: 'person', fragment_id: pkg.fragmentA, start: at, end: at + 5, mention_type: 'biography', proposed_entity_id: `ent-${runId}-person` },
      { kind: 'place', fragment_id: pkg.fragmentB, start: 0, end: 6, mention_type: 'depicted' },
    ],
    time_references: [{ fragment_id: pkg.fragmentA, start: 0, end: 4, year_from: 1495, year_to: 1495, precision: 'exact', role: 'event' }],
    place_references: [
      { place: 'synthetic-place', name: 'Галоўная вуліца', participation_type: 'location', districts: ['district.main-town'], district_basis: 'synthetic' },
    ],
    topic_assignments: [{ topic_id: 'topic.trade', fragment_id: pkg.fragmentA }],
    hooks: [{ text: 'зачэпка', rationale: 'пасуе для аповеду', fragment_id: pkg.fragmentA }],
    context_needs: [{ concept: 'Ханза', fragment_id: pkg.fragmentA, closure_state: 'open' }],
  };
}

test('duplicate_registration: registering the same package twice creates no duplicate associations', (t) => {
  const store = makeStore(t);
  const pkg = syntheticPackage();

  const first = registerPackage(store, pkg);
  assert.equal(first.alreadyRegistered, false);
  const second = registerPackage(store, pkg);
  assert.equal(second.alreadyRegistered, true);

  const count = (sql) => Number(store.db.prepare(sql).get().n);
  assert.equal(count('SELECT COUNT(*) AS n FROM articles'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM revisions'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM extractions'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM fragments'), 2);
  assert.equal(count('SELECT COUNT(*) AS n FROM media_assets'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM extraction_media'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM extraction_links'), 1);
});

test('orphan_fragment: a fragment of another revision and an unknown media asset are rejected before any row is written', (t) => {
  const store = makeStore(t);
  const pkg = syntheticPackage();

  const foreignRevision = sha256Hex('other-revision');
  const broken = syntheticPackage();
  broken.document.fragments = broken.document.fragments.map((fragment) => ({ ...fragment, revision_id: foreignRevision }));
  assert.equal(ruleOf(() => registerPackage(store, broken)), 'orphan-fragment');

  const unknownAsset = syntheticPackage();
  unknownAsset.document.images = [{ asset_id: sha256Hex('never-provided'), source_locator: 'media_key-x' }];
  assert.equal(ruleOf(() => registerPackage(store, unknownAsset)), 'orphan-media');

  const count = (sql) => Number(store.db.prepare(sql).get().n);
  assert.equal(count('SELECT COUNT(*) AS n FROM articles'), 0, 'no row may precede the rejection');
  assert.equal(count('SELECT COUNT(*) AS n FROM revisions'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM fragments'), 0);
});

test('duplicate_registration: the same ids with a different document answer a named diagnostic, not a silent no-op', (t) => {
  const store = makeStore(t);
  const pkg = syntheticPackage();
  registerPackage(store, pkg);

  const colliding = syntheticPackage();
  colliding.document = { ...colliding.document, title: 'A different document under the same ids' };
  assert.equal(ruleOf(() => registerPackage(store, colliding)), 'package-document-mismatch');

  const count = (sql) => Number(store.db.prepare(sql).get().n);
  assert.equal(count('SELECT COUNT(*) AS n FROM articles'), 1, 'the collision must not add rows');
  assert.equal(count('SELECT COUNT(*) AS n FROM extractions'), 1);
});

test('delete_scope_missing: an unscoped machine-result delete is rejected, never erasing everything', (t) => {
  const store = makeStore(t);
  assert.equal(ruleOf(() => deleteModelResults(store, {})), 'delete-scope-missing');
  assert.equal(ruleOf(() => deleteModelResults(store)), 'delete-scope-missing');
});

test('unresolved_mention: a mention without a proposal stays unresolved; person and family stay distinct kinds', (t) => {
  const store = makeStore(t);
  const pkg = syntheticPackage();
  registerPackage(store, pkg);
  storeModelResult(store, syntheticLevel1(pkg, 'run-1'));

  const mentions = store.db.prepare('SELECT kind, proposed_entity_id FROM mentions ORDER BY mention_id').all();
  assert.equal(mentions.length, 2);
  assert.equal(mentions[0].proposed_entity_id, 'ent-run-1-person');
  assert.equal(mentions[1].proposed_entity_id, null, 'a mention without a proposal must stay unresolved');

  const kinds = store.db.prepare("SELECT kind FROM entities WHERE result_id = (SELECT MAX(result_id) FROM model_results) ORDER BY kind").all();
  assert.deepEqual(kinds.map((row) => row.kind), ['family', 'person'], 'a person and a family are separate entities (25 §5)');
});

test('decisions_survive_reindex: rebuilding the index or replacing machine results keeps Cases and author decisions', (t) => {
  const store = makeStore(t);
  const pkg = syntheticPackage();
  registerPackage(store, pkg);
  storeModelResult(store, syntheticLevel1(pkg, 'run-1'));
  recordIdentityDecision(store, {
    articleId: pkg.articleId,
    revisionId: pkg.revisionId,
    entityId: 'ent-run-1-person',
    decision: 'confirmed',
    decidedBy: 'author',
  });
  saveCase(store, {
    case_id: 'case-1',
    question: 'Хто гандляваў на галоўнай вуліцы?',
    filters: { districts: ['district.main-town'] },
    candidates: [{ candidate_id: 'cand-1', fragment_ids: [pkg.fragmentA] }],
    selected: [{ fragment_id: pkg.fragmentA, revision_id: pkg.revisionId }],
  });

  const indexed = rebuildSearchIndex(store);
  assert.equal(indexed.indexed, 2);

  const deleted = deleteModelResults(store, { articleId: pkg.articleId, revisionId: pkg.revisionId });
  assert.equal(deleted.deleted, 1);
  assert.deepEqual(
    latestIdentityDecisions(store, { articleId: pkg.articleId, revisionId: pkg.revisionId }).map((row) => row.decision),
    ['confirmed'],
    'author decisions live outside machine results'
  );
  assert.equal(getCase(store, 'case-1').document.case_id, 'case-1', 'Cases survive machine-result deletion');

  // Replacing the same run's machine result (delete + re-store) keeps the
  // author's state: the decision is keyed by the content-derived identity,
  // not by the machine row.
  storeModelResult(store, syntheticLevel1(pkg, 'run-1'));
  assert.deepEqual(
    latestIdentityDecisions(store, { articleId: pkg.articleId, revisionId: pkg.revisionId }).map((row) => [row.entity_id, row.decision]),
    [['ent-run-1-person', 'confirmed']],
    'the decision survives the machine-result replacement'
  );
  const rows = store.db.prepare('SELECT result_id FROM model_results').all();
  assert.equal(rows.length, 1, 'the replacement left exactly one machine result');
});

test('writer_lock: a second write session answers db-busy, not a hang or a silent queue', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kudy-corpus-'));
  t.after(() => {
    assertNoOpenHandlesUnder(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const dbPath = path.join(dir, 'corpus.db');
  const first = openCorpus(dbPath);
  const second = openCorpus(dbPath);
  try {
    first.db.exec('BEGIN IMMEDIATE');
    assert.equal(ruleOf(() => registerPackage(second, syntheticPackage())), 'db-busy');
    first.db.exec('ROLLBACK');
    // The lock was the only obstacle: once released, the same write succeeds.
    const outcome = registerPackage(second, syntheticPackage());
    assert.equal(outcome.alreadyRegistered, false);
  } finally {
    closeCorpus(first);
    closeCorpus(second);
  }
});

test('the store ships the migration contract: versions are recorded and foreign keys are enforced', (t) => {
  const store = makeStore(t);
  const applied = store.db.prepare('SELECT version FROM corpus_schema_migrations ORDER BY version').all().map((row) => row.version);
  assert.deepEqual(applied, CORPUS_MIGRATIONS.map((migration) => migration.version));
  assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout, 0);
});
