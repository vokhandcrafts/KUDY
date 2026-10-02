// G19.03 — durable corpus store (issue #460). One local SQLite database owns
// the registered packages, the machine results, the author decisions and the
// Cases; the immutable package files stay in the library tree (25 §9: the
// database owns the markup, the files stay primary). SQLite idioms follow
// tools/collector/store.mjs (node:sqlite, PRAGMA foreign_keys = ON, FTS5);
// the corpus adds what 25 §9 demands and the collector does not have:
// versioned migrations with a pre-migration snapshot, a named busy diagnostic
// for a second write session, and a derived search index that is rebuilt from
// stored materials without touching author data.
//
// Validation reuses contracts.mjs — the single boundary home: registration
// re-checks the article document, model results go through the same
// cross-record validator (fragment existence, ranges, vocabulary) the run
// pipeline uses. No network call exists on any path here; every write
// transaction commits before the function returns, so no transaction can
// span a future model request (25 §9: транзакцыі не трымаюцца адкрытымі
// падчас чакання мадэлі).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { CorpusDiagnostic } from './extract.mjs';
import { validateCase, validateDocument, validateModelResult } from './contracts.mjs';

const DECISIONS = new Set(['confirmed', 'split', 'rejected']);

// v1 is the full initial schema. Later changes append objects here — never
// edit an applied migration; the snapshot machinery below depends on
// migrations being replayable from an older file in order.
export const CORPUS_MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE articles (
        article_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        registered_at TEXT NOT NULL
      );
      CREATE TABLE revisions (
        article_id TEXT NOT NULL REFERENCES articles(article_id),
        revision_id TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        PRIMARY KEY (article_id, revision_id)
      );
      CREATE TABLE extractions (
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        document_json TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        PRIMARY KEY (article_id, revision_id, extractor_version),
        FOREIGN KEY (article_id, revision_id) REFERENCES revisions(article_id, revision_id)
      );
      CREATE TABLE media_assets (
        asset_id TEXT PRIMARY KEY,
        extension TEXT NOT NULL
      );
      CREATE TABLE extraction_media (
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES media_assets(asset_id),
        media_key TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        PRIMARY KEY (article_id, revision_id, extractor_version, asset_id),
        FOREIGN KEY (article_id, revision_id, extractor_version) REFERENCES extractions(article_id, revision_id, extractor_version)
      );
      CREATE TABLE fragments (
        extractor_version TEXT NOT NULL,
        fragment_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('body', 'caption', 'bibliography')),
        section_path_json TEXT NOT NULL,
        text TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        PRIMARY KEY (extractor_version, fragment_id),
        FOREIGN KEY (article_id, revision_id) REFERENCES revisions(article_id, revision_id)
      );
      CREATE TABLE extraction_links (
        link_id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        visible_text TEXT NOT NULL,
        target TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        FOREIGN KEY (article_id, revision_id, extractor_version) REFERENCES extractions(article_id, revision_id, extractor_version)
      );
      CREATE TABLE model_results (
        result_id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        vocabulary_version TEXT NOT NULL,
        level INTEGER NOT NULL CHECK (level IN (1, 2)),
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (run_id, article_id, revision_id, level),
        FOREIGN KEY (article_id, revision_id) REFERENCES revisions(article_id, revision_id)
      );
      CREATE TABLE entities (
        result_id INTEGER NOT NULL REFERENCES model_results(result_id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'family', 'place', 'organization')),
        name TEXT NOT NULL,
        name_variants_json TEXT NOT NULL,
        matching_status TEXT NOT NULL CHECK (matching_status IN ('unmatched', 'proposed', 'confirmed', 'split', 'rejected')),
        PRIMARY KEY (result_id, entity_id)
      );
      CREATE TABLE mentions (
        mention_id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id INTEGER NOT NULL REFERENCES model_results(result_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'place', 'organization')),
        fragment_id TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER NOT NULL,
        mention_type TEXT NOT NULL,
        proposed_entity_id TEXT,
        FOREIGN KEY (result_id, proposed_entity_id) REFERENCES entities(result_id, entity_id)
      );
      -- Author-owned state (25 §5: выпраўленні захоўваюцца асобна ад машыннага
      -- выніку). No reference to model_results — deleting or replacing machine
      -- results never touches a decision; the (article_id, revision_id,
      -- entity_id) key is stable across runs because ids are content-derived.
      CREATE TABLE identity_decisions (
        decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'split', 'rejected')),
        decided_by TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        note TEXT
      );
      CREATE TABLE cases (
        case_id TEXT PRIMARY KEY,
        document_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE corpus_fts USING fts5(
        fragment_id UNINDEXED, article_id UNINDEXED, revision_id UNINDEXED, body
      );
    `,
  },
];

function translateSqliteError(error, action) {
  const message = String(error?.message ?? '');
  if (/database is locked|database is busy/i.test(message)) {
    return new CorpusDiagnostic('db-busy', `another write session holds the corpus database (${action})`, {});
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return new CorpusDiagnostic('foreign-key-violation', `${action}: a referenced row is missing`, {});
  }
  return error;
}

// Every mutation runs through here: BEGIN IMMEDIATE takes the write lock up
// front (a second write session answers db-busy immediately instead of
// deadlocking at commit), the callback's work commits before the caller
// continues, and a failure rolls back and rethrows as a named diagnostic.
function inTransaction(store, action, callback) {
  try {
    store.db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    // The write lock itself can be busy — the diagnostic must surface here,
    // before any work is attempted.
    throw translateSqliteError(error, action);
  }
  try {
    const result = callback();
    store.db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      store.db.exec('ROLLBACK');
    } catch {
      // the transaction was already rolled back by SQLite itself
    }
    throw translateSqliteError(error, action);
  }
}

function migrateCorpus(store, migrations) {
  store.db.exec(
    `CREATE TABLE IF NOT EXISTS corpus_schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );
  const applied = new Set(store.db.prepare('SELECT version FROM corpus_schema_migrations').all().map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    // 25 §9: перад міграцыяй ствараецца аднаўляльная копія. The copy happens
    // outside any transaction (no statement of ours is open), so the file
    // image is consistent; on failure the bytes go back and the snapshot
    // stays on disk for forensics.
    const snapshotPath = `${store.dbPath}.pre-migration-v${migration.version}`;
    fs.copyFileSync(store.dbPath, snapshotPath);
    try {
      inTransaction(store, `migration v${migration.version}`, () => {
        store.db.exec(migration.up);
        store.db.prepare('INSERT INTO corpus_schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      });
    } catch (error) {
      try {
        fs.copyFileSync(snapshotPath, store.dbPath);
      } catch {
        // the snapshot itself is the recovery artifact; report its location
      }
      store.close();
      const details = error instanceof CorpusDiagnostic ? error.details : { cause: String(error?.message ?? error) };
      throw new CorpusDiagnostic(
        'migration-failed',
        `migration v${migration.version} failed — the database was restored from the pre-migration snapshot (${snapshotPath})`,
        { version: migration.version, snapshotPath, ...details },
      );
    }
    fs.rmSync(snapshotPath, { force: true });
  }
}

export function openCorpus(dbPath, { migrations = CORPUS_MIGRATIONS } = {}) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  let db;
  try {
    db = new DatabaseSync(resolved);
  } catch (error) {
    throw new CorpusDiagnostic('db-open-failed', `cannot open the corpus database (${error.name ?? 'error'})`, {});
  }
  const store = {
    dbPath: resolved,
    db,
    close() {
      db.close();
    },
  };
  db.exec('PRAGMA foreign_keys = ON');
  // A second write session must answer with a named diagnostic at once
  // (25 §9: другая пісьмовая сесія атрымлівае дыягностыку занятасці), not
  // queue behind the first one.
  db.exec('PRAGMA busy_timeout = 0');
  try {
    migrateCorpus(store, migrations);
  } catch (error) {
    try {
      db.close();
    } catch {
      // already closed by the migration failure path
    }
    throw error;
  }
  return store;
}

export function closeCorpus(store) {
  store.close();
}

function schemaErrorsToDiagnostic(verdict, action) {
  const first = verdict.errors[0];
  return new CorpusDiagnostic(`${action}-invalid`, `${action} rejected by the contract: ${first.rule} at ${first.path}`, {
    errors: verdict.errors,
  });
}

// Registration is the DB half of the import boundary: the package files were
// placed by importArticle (G19.02); this records their identities and
// associations so a re-registration of the same package changes nothing.
export function registerPackage(store, packageRecord) {
  const record = packageRecord ?? {};
  const document = record.document;
  const verdict = validateDocument('article-fragment-v1', document);
  if (!verdict.ok) throw schemaErrorsToDiagnostic(verdict, 'package');
  for (const [field, value] of [
    ['articleId', record.articleId],
    ['revisionId', record.revisionId],
    ['extractorVersion', record.extractorVersion],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CorpusDiagnostic('package-identity-missing', `packageRecord.${field} is missing`, {});
    }
  }
  if (document.article_id !== record.articleId || document.revision_id !== record.revisionId || document.extractor_version !== record.extractorVersion) {
    throw new CorpusDiagnostic('package-identity-mismatch', 'packageRecord ids disagree with the document ids', {});
  }
  // A fragment naming another article/revision would be an orphan by the FK;
  // the named diagnostic fires before any row is written.
  for (const [index, fragment] of (document.fragments ?? []).entries()) {
    if (fragment.article_id !== record.articleId || fragment.revision_id !== record.revisionId || fragment.extractor_version !== record.extractorVersion) {
      throw new CorpusDiagnostic('orphan-fragment', `fragments[${index}] does not belong to this package`, { index });
    }
  }
  const providedAssets = new Set((record.media ?? []).map((medium) => medium.assetId));
  for (const [index, image] of (document.images ?? []).entries()) {
    if (!providedAssets.has(image.asset_id)) {
      throw new CorpusDiagnostic('orphan-media', `images[${index}] references an asset that was not provided with the package`, {
        asset_id: image.asset_id,
      });
    }
  }

  const now = new Date().toISOString();
  return inTransaction(store, 'package registration', () => {
    const existing = store.db
      .prepare('SELECT 1 AS present FROM extractions WHERE article_id = ? AND revision_id = ? AND extractor_version = ?')
      .get(record.articleId, record.revisionId, record.extractorVersion);
    if (existing) return { alreadyRegistered: true };

    store.db.prepare('INSERT OR IGNORE INTO articles (article_id, title, registered_at) VALUES (?, ?, ?)').run(
      record.articleId,
      document.title,
      now,
    );
    store.db.prepare('INSERT OR IGNORE INTO revisions (article_id, revision_id, registered_at) VALUES (?, ?, ?)').run(
      record.articleId,
      record.revisionId,
      now,
    );
    store.db
      .prepare('INSERT INTO extractions (article_id, revision_id, extractor_version, document_json, registered_at) VALUES (?, ?, ?, ?, ?)')
      .run(record.articleId, record.revisionId, record.extractorVersion, JSON.stringify(document), now);

    const insertAsset = store.db.prepare('INSERT OR IGNORE INTO media_assets (asset_id, extension) VALUES (?, ?)');
    const insertAssociation = store.db.prepare(
      `INSERT OR IGNORE INTO extraction_media
         (article_id, revision_id, extractor_version, asset_id, media_key, source_locator)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const locatorByAsset = new Map((document.images ?? []).map((image) => [image.asset_id, image.source_locator]));
    for (const medium of record.media ?? []) {
      insertAsset.run(medium.assetId, medium.extension);
      insertAssociation.run(
        record.articleId,
        record.revisionId,
        record.extractorVersion,
        medium.assetId,
        medium.mediaKey,
        locatorByAsset.get(medium.assetId) ?? medium.mediaKey,
      );
    }

    const insertFragment = store.db.prepare(
      `INSERT INTO fragments
         (extractor_version, fragment_id, article_id, revision_id, kind, section_path_json, text, source_locator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const fragment of document.fragments ?? []) {
      insertFragment.run(
        record.extractorVersion,
        fragment.fragment_id,
        fragment.article_id,
        fragment.revision_id,
        fragment.kind,
        JSON.stringify(fragment.section_path),
        fragment.text,
        fragment.source_locator,
      );
    }
    const insertLink = store.db.prepare(
      `INSERT INTO extraction_links (article_id, revision_id, extractor_version, visible_text, target, source_locator)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const link of document.links ?? []) {
      insertLink.run(record.articleId, record.revisionId, record.extractorVersion, link.visible_text, link.target, link.source_locator);
    }
    return { alreadyRegistered: false };
  });
}

// Machine results are owned by (run_id, article, revision): re-storing the
// same run replaces the previous machine result wholesale — entities and
// mentions cascade with it, while identity_decisions (no reference to
// machine rows) and Cases stay untouched.
export function storeModelResult(store, resultDocument) {
  const fragments = {};
  for (const row of store.db
    .prepare('SELECT fragment_id, text FROM fragments WHERE article_id = ? AND revision_id = ?')
    .all(resultDocument?.article_id ?? '', resultDocument?.revision_id ?? '')) {
    fragments[row.fragment_id] = row.text;
  }
  const verdict = validateModelResult(1, resultDocument, fragments);
  if (!verdict.ok) throw schemaErrorsToDiagnostic(verdict, 'model result');

  return inTransaction(store, 'model result', () => {
    store.db
      .prepare('DELETE FROM model_results WHERE run_id = ? AND article_id = ? AND revision_id = ? AND level = 1')
      .run(resultDocument.run_id, resultDocument.article_id, resultDocument.revision_id);
    const header = store.db
      .prepare(
        `INSERT INTO model_results (article_id, revision_id, run_id, vocabulary_version, level, document_json, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        resultDocument.article_id,
        resultDocument.revision_id,
        resultDocument.run_id,
        resultDocument.vocabulary_version,
        JSON.stringify(resultDocument),
        new Date().toISOString(),
      );
    const resultId = Number(header.lastInsertRowid);
    const insertEntity = store.db.prepare(
      'INSERT INTO entities (result_id, entity_id, kind, name, name_variants_json, matching_status) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const entity of resultDocument.entities) {
      insertEntity.run(
        resultId,
        entity.entity_id,
        entity.kind,
        entity.name,
        JSON.stringify(entity.name_variants ?? []),
        entity.matching_status ?? 'unmatched',
      );
    }
    const insertMention = store.db.prepare(
      `INSERT INTO mentions (result_id, kind, fragment_id, start, end, mention_type, proposed_entity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const mention of resultDocument.mentions) {
      insertMention.run(
        resultId,
        mention.kind,
        mention.fragment_id,
        mention.start,
        mention.end,
        mention.mention_type,
        mention.proposed_entity_id ?? null,
      );
    }
    return { resultId };
  });
}

// At least one scope field is required: an unscoped delete would erase every
// machine result, which no caller of this store should be able to do by
// accident. Author decisions and Cases are separate tables and survive.
export function deleteModelResults(store, { runId, articleId, revisionId } = {}) {
  const scopes = [
    ['run_id', runId],
    ['article_id', articleId],
    ['revision_id', revisionId],
  ].filter(([, value]) => value !== undefined);
  if (scopes.length === 0) {
    throw new CorpusDiagnostic('delete-scope-missing', 'deleteModelResults requires runId, articleId or revisionId', {});
  }
  return inTransaction(store, 'machine result deletion', () => {
    const where = scopes.map(([column]) => `${column} = ?`).join(' AND ');
    const parameters = scopes.map(([, value]) => value);
    parameters.push(1);
    const result = store.db.prepare(`DELETE FROM model_results WHERE ${where} AND level = ?`).run(...parameters);
    return { deleted: Number(result.changes) };
  });
}

export function recordIdentityDecision(store, { articleId, revisionId, entityId, decision, decidedBy, decidedAt, note }) {
  if (!DECISIONS.has(decision)) {
    throw new CorpusDiagnostic('decision-unknown', `identity decision '${decision}' is not one of ${[...DECISIONS].join(', ')}`, {});
  }
  for (const [field, value] of [
    ['articleId', articleId],
    ['revisionId', revisionId],
    ['entityId', entityId],
    ['decidedBy', decidedBy],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new CorpusDiagnostic('decision-field-missing', `identity decision field ${field} is missing`, {});
    }
  }
  return inTransaction(store, 'identity decision', () => {
    const header = store.db
      .prepare(
        `INSERT INTO identity_decisions (article_id, revision_id, entity_id, decision, decided_by, decided_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(articleId, revisionId, entityId, decision, decidedBy, decidedAt ?? new Date().toISOString(), note ?? null);
    return { decisionId: Number(header.lastInsertRowid) };
  });
}

// The latest decision per entity: a replaced machine result re-reads these to
// restore the author's confirmed/split/rejected state on the new proposal.
export function latestIdentityDecisions(store, { articleId, revisionId }) {
  return store.db
    .prepare(
      `SELECT d.entity_id, d.decision, d.decided_by, d.decided_at, d.note
       FROM identity_decisions d
       WHERE d.article_id = ? AND d.revision_id = ? AND d.decision_id = (
         SELECT MAX(d2.decision_id) FROM identity_decisions d2
         WHERE d2.article_id = d.article_id AND d2.revision_id = d.revision_id AND d2.entity_id = d.entity_id
       )
       ORDER BY d.entity_id`
    )
    .all(articleId, revisionId);
}

export function saveCase(store, caseDocument) {
  const verdict = validateCase(caseDocument);
  if (!verdict.ok) throw schemaErrorsToDiagnostic(verdict, 'case');
  const now = new Date().toISOString();
  return inTransaction(store, 'case save', () => {
    store.db
      .prepare(
        `INSERT INTO cases (case_id, document_json, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(case_id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at`
      )
      .run(caseDocument.case_id, JSON.stringify(caseDocument), now, now);
    return { caseId: caseDocument.case_id };
  });
}

export function getCase(store, caseId) {
  const row = store.db.prepare('SELECT case_id, document_json, created_at, updated_at FROM cases WHERE case_id = ?').get(caseId);
  if (!row) return null;
  return { caseId: row.case_id, document: JSON.parse(row.document_json), createdAt: row.created_at, updatedAt: row.updated_at };
}

// The search index is derived state (25 §9: індэксы аднаўляюцца з матэрыялаў
// і разметкі): dropping and rebuilding it must never change Cases or author
// decisions — they live in their own tables and this function only rewrites
// corpus_fts from the stored fragments.
export function rebuildSearchIndex(store) {
  return inTransaction(store, 'search index rebuild', () => {
    // corpus_fts is a regular FTS5 table (not contentless), so the rebuild
    // is a plain DELETE plus re-insert — all inside one transaction.
    store.db.exec('DELETE FROM corpus_fts');
    const rows = store.db.prepare('SELECT fragment_id, article_id, revision_id, text FROM fragments ORDER BY article_id, revision_id, fragment_id').all();
    const insert = store.db.prepare('INSERT INTO corpus_fts (fragment_id, article_id, revision_id, body) VALUES (?, ?, ?, ?)');
    for (const row of rows) insert.run(row.fragment_id, row.article_id, row.revision_id, row.text);
    return { indexed: rows.length };
  });
}

// Library-tree readback for the CLI import command: every complete package
// under articles/ becomes a packageRecord with the same shape importArticle
// returns, so registration needs no second document model. Directory names
// are content-derived ids and are pattern-checked before use — a stray
// directory is reported, never traversed. The extractor version lives two
// levels deep (extractions/<profile>/v<N>/ — a slash cannot be a directory
// name), and the joined spelling must still satisfy the extractor pattern.
const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE_DIR = /^[a-z][a-z0-9-]*$/;
const VERSION_DIR = /^v[0-9]+$/;

export function listLibraryPackages(libraryRoot) {
  const rootReal = fs.realpathSync(libraryRoot);
  const articles = path.join(rootReal, 'articles');
  if (!fs.existsSync(articles)) return [];
  const packages = [];
  for (const articleId of fs.readdirSync(articles).sort()) {
    if (!HEX64.test(articleId)) continue;
    const revisionsDir = path.join(articles, articleId, 'revisions');
    let revisionsReal;
    try {
      revisionsReal = fs.realpathSync(revisionsDir);
    } catch {
      continue;
    }
    if (revisionsReal !== rootReal && !revisionsReal.startsWith(rootReal + path.sep)) continue;
    for (const revisionId of fs.readdirSync(revisionsReal).sort()) {
      if (!HEX64.test(revisionId)) continue;
      const revisionReal = fs.realpathSync(path.join(revisionsReal, revisionId));
      if (revisionReal !== revisionsReal && !revisionReal.startsWith(revisionsReal + path.sep)) continue;
      const extractionsDir = path.join(revisionReal, 'extractions');
      if (!fs.existsSync(extractionsDir)) continue;
      for (const profile of fs.readdirSync(extractionsDir).sort()) {
        if (!PROFILE_DIR.test(profile)) continue;
        const profileDir = path.join(extractionsDir, profile);
        for (const version of fs.readdirSync(profileDir).sort()) {
          if (!VERSION_DIR.test(version)) continue;
          const extractorVersion = `${profile}/${version}`;
          const extractionDir = path.join(profileDir, version);
          if (!fs.existsSync(path.join(extractionDir, 'article.json'))) continue;
          const document = JSON.parse(fs.readFileSync(path.join(extractionDir, 'article.json'), 'utf8'));
          const imagesDir = path.join(revisionReal, 'images');
          const media = [];
          for (const image of document.images ?? []) {
            const names = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir) : [];
            const fileName = names.find((name) => name.startsWith(`${image.asset_id}.`));
            if (!fileName) {
              throw new CorpusDiagnostic('package-file-missing', `image asset ${image.asset_id.slice(0, 12)} is missing from the package`, {
                asset_id: image.asset_id,
              });
            }
            media.push({ mediaKey: image.source_locator, assetId: image.asset_id, extension: fileName.slice(image.asset_id.length + 1) });
          }
          packages.push({
            articleId,
            revisionId,
            extractorVersion,
            document,
            media,
            paths: { articleDir: path.join(rootReal, 'articles', articleId), revisionDir: revisionReal, extractionDir },
          });
        }
      }
    }
  }
  return packages;
}
