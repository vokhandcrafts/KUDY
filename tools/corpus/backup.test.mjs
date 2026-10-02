// G19.03 behavioral checks for backup/restore (issue #460) — the named
// checks from the brief: restore_roundtrip, corrupt_checksum,
// failed_migration_keeps_backup. The library fixture is synthetic (see
// fixtures/packages.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CorpusDiagnostic, sha256Hex } from './extract.mjs';
import { backupCorpus, restoreCorpus } from './backup.mjs';
import {
  closeCorpus,
  CORPUS_MIGRATIONS,
  listLibraryPackages,
  openCorpus,
  recordIdentityDecision,
  registerPackage,
  saveCase,
  storeModelResult,
} from './store.mjs';
import { EXTRACTOR, makeSyntheticLibrary, syntheticLevel1 } from './fixtures/packages.mjs';

function ruleOf(operation) {
  try {
    operation();
  } catch (error) {
    if (error instanceof CorpusDiagnostic) return error.rule;
    throw error;
  }
  return null;
}

function populateAnnotations(store, library) {
  const [pkg] = listLibraryPackages(library.root);
  assert.equal(pkg.articleId, library.articleId);
  assert.equal(pkg.media.length, 2, 'the readback lists both image assets');
  registerPackage(store, pkg);
  storeModelResult(store, syntheticLevel1(library, 'run-1'));
  recordIdentityDecision(store, {
    articleId: library.articleId,
    revisionId: library.revisionId,
    entityId: 'ent-run-1',
    decision: 'confirmed',
    decidedBy: 'author',
  });
  saveCase(store, {
    case_id: 'case-r',
    question: 'Што ў фікстуры?',
    filters: {},
    candidates: [{ candidate_id: 'cand-1', fragment_ids: [library.fragmentId] }],
    selected: [{ fragment_id: library.fragmentId, revision_id: library.revisionId }],
  });
}

test('restore_roundtrip: a fresh directory reproduces annotations, decisions and image associations', (t) => {
  const library = makeSyntheticLibrary(t, { seed: 'roundtrip' });
  const store = openCorpus(library.dbPath);
  populateAnnotations(store, library);

  const backupDir = path.join(library.root, 'backup');
  const backup = backupCorpus(store, { libraryRoot: library.root, outDir: backupDir });
  assert.ok(backup.files >= 5, 'raw, article.json, text.md and both images are backed up');
  assert.ok(fs.existsSync(path.join(backupDir, 'manifest.json')));
  closeCorpus(store);

  // The backup target is single-use: a second run refuses instead of mixing.
  assert.equal(
    ruleOf(() => backupCorpus(openCorpus(library.dbPath), { libraryRoot: library.root, outDir: backupDir })),
    'backup-target-not-empty'
  );

  const restoredRoot = path.join(library.root, 'restored');
  const restored = restoreCorpus({ backupDir, newLibraryRoot: restoredRoot });
  assert.ok(fs.existsSync(path.join(restoredRoot, 'articles')));

  const reopened = openCorpus(restored.dbPath);
  try {
    const count = (sql) => Number(reopened.db.prepare(sql).get().n);
    assert.equal(count('SELECT COUNT(*) AS n FROM model_results'), 1, 'machine results survive');
    assert.equal(count('SELECT COUNT(*) AS n FROM mentions'), 1);
    assert.equal(count('SELECT COUNT(*) AS n FROM extraction_media'), 2, 'image associations survive');
    assert.equal(count('SELECT COUNT(*) AS n FROM identity_decisions'), 1, 'author decisions survive');
    const decisions = reopened.db.prepare('SELECT decision FROM identity_decisions').all().map((row) => row.decision);
    assert.deepEqual(decisions, ['confirmed']);
    assert.equal(count('SELECT COUNT(*) AS n FROM cases'), 1, 'Cases survive');
    assert.equal(count('SELECT COUNT(*) AS n FROM corpus_fts'), 0, 'the search index is derived state and starts empty');
    // A restored library is a working library: registration is idempotent on it.
    const [pkg] = listLibraryPackages(restoredRoot);
    assert.equal(registerPackage(reopened, pkg).alreadyRegistered, true);
  } finally {
    closeCorpus(reopened);
  }

  assert.equal(ruleOf(() => restoreCorpus({ backupDir, newLibraryRoot: restoredRoot })), 'restore-target-exists');
});

// Shared arrangement: a populated library, one taken backup, closed store.
function makeBackupFixture(t, seed) {
  const library = makeSyntheticLibrary(t, { seed });
  const store = openCorpus(library.dbPath);
  populateAnnotations(store, library);
  const backupDir = path.join(library.root, 'backup');
  const target = path.join(library.root, 'restored');
  backupCorpus(store, { libraryRoot: library.root, outDir: backupDir });
  closeCorpus(store);
  return { library, backupDir, target };
}

test('corrupt_checksum: a tampered or incomplete backup never materializes a library', (t) => {
  const { library, backupDir, target } = makeBackupFixture(t, 'corrupt');

  // Corrupt bytes: one flipped byte in a copied file.
  const textFile = path.join(backupDir, `articles/${library.articleId}/revisions/${library.revisionId}/extractions/${EXTRACTOR}/text.md`);
  const original = fs.readFileSync(textFile);
  const corrupted = Buffer.from(original);
  corrupted[0] = corrupted[0] ^ 0x20;
  fs.writeFileSync(textFile, corrupted);
  assert.equal(ruleOf(() => restoreCorpus({ backupDir, newLibraryRoot: target })), 'backup-checksum-mismatch');
  assert.equal(fs.existsSync(target), false, 'a corrupt backup must not create the target');

  // Incomplete: a manifest-listed file is gone.
  fs.writeFileSync(textFile, original);
  fs.rmSync(path.join(backupDir, `articles/${library.articleId}/revisions/${library.revisionId}/raw.html`));
  assert.equal(ruleOf(() => restoreCorpus({ backupDir, newLibraryRoot: target })), 'backup-file-missing');
  assert.equal(fs.existsSync(target), false, 'an incomplete backup must not create the target');
});

test('tampered_manifest: unsafe paths and unparseable manifests are rejected before any write', (t) => {
  const { backupDir, target } = makeBackupFixture(t, 'manifest');

  // A traversal path inside an otherwise valid manifest: the strict path
  // rule fires before a single byte is written to the target.
  const manifestFile = path.join(backupDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.files.push({ path: 'articles/../../evil.html', bytes: 4, sha256: sha256Hex('evil') });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.equal(ruleOf(() => restoreCorpus({ backupDir, newLibraryRoot: target })), 'unsafe-backup-path');
  assert.equal(fs.existsSync(target), false);

  // An unparseable manifest is a named rejection, not a crash.
  fs.writeFileSync(manifestFile, '{ not json');
  assert.equal(ruleOf(() => restoreCorpus({ backupDir, newLibraryRoot: target })), 'backup-manifest-missing');
  assert.equal(fs.existsSync(target), false);
});

test('failed_migration_keeps_backup: a broken migration restores the pre-migration database', (t) => {
  const library = makeSyntheticLibrary(t, { seed: 'migration' });
  const store = openCorpus(library.dbPath);
  populateAnnotations(store, library);
  closeCorpus(store);

  const brokenMigrations = [...CORPUS_MIGRATIONS, { version: 2, up: 'CREATE TABLE broken ( this is not sql' }];
  assert.equal(ruleOf(() => openCorpus(library.dbPath, { migrations: brokenMigrations })), 'migration-failed');

  const snapshotPath = `${library.dbPath}.pre-migration-v2`;
  assert.ok(fs.existsSync(snapshotPath), 'the pre-migration snapshot is retained');
  fs.rmSync(snapshotPath, { force: true });

  // The database itself is back at v1 with all data readable.
  const reopened = openCorpus(library.dbPath);
  try {
    const count = (sql) => Number(reopened.db.prepare(sql).get().n);
    assert.equal(count('SELECT COUNT(*) AS n FROM extractions'), 1);
    assert.equal(count('SELECT COUNT(*) AS n FROM identity_decisions'), 1);
    const applied = reopened.db.prepare('SELECT version FROM corpus_schema_migrations ORDER BY version').all().map((row) => row.version);
    assert.deepEqual(applied, [1]);
  } finally {
    closeCorpus(reopened);
  }
});
