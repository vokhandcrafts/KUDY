// G19.03 — verified backup and restore of the corpus (issue #460).
// 25 §9: the backup holds a consistent database snapshot, the required
// package files and a manifest of checksums; restore verifies sums and
// references FIRST and only ever writes into a fresh directory — a corrupt
// or incomplete backup cannot overwrite a live library. Consistency of the
// database image comes from VACUUM INTO (a transaction-consistent copy, the
// store's own connection stays usable); file identity anchors come from the
// database itself: raw.html must hash to its revision_id, an image to its
// asset_id, article.json to the registered document text.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

import { CorpusDiagnostic } from './extract.mjs';

const BACKUP_FORMAT = 1;
const BACKUP_DB_NAME = 'corpus.db';
const MANIFEST_NAME = 'manifest.json';

// The exact shape of a backed-up package file: content-derived id components
// only, so a tampered manifest can never name a path outside the backup tree
// (no `..`, no absolute spelling, no arbitrary names).
const BACKUP_FILE_PATH = new RegExp(
  '^articles/[0-9a-f]{64}/revisions/[0-9a-f]{64}/' +
    '(raw\\.html' +
    '|extractions/[a-z][a-z0-9-]*/v[0-9]+/(article\\.json|text\\.md)' +
    '|images/[0-9a-f]{64}\\.[a-z0-9]{1,8})$'
);

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeBackupRelativePath(value) {
  return typeof value === 'string' && BACKUP_FILE_PATH.test(value);
}

// One confined file read: the relative path's components are DB-derived ids,
// and the resolved real path must stay under the library root — a symlinked
// directory inside the tree must not smuggle foreign bytes into a backup.
function confinedFile(libraryReal, relativePath) {
  const absolute = path.resolve(libraryReal, relativePath);
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new CorpusDiagnostic('backup-file-missing', `required file '${relativePath}' does not exist under the library root`, {
      path: relativePath,
    });
  }
  if (real !== libraryReal && !real.startsWith(libraryReal + path.sep)) {
    throw new CorpusDiagnostic('backup-path-escapes-root', `required file '${relativePath}' resolves outside the library root`, {
      path: relativePath,
    });
  }
  return real;
}

export function backupCorpus(store, { libraryRoot, outDir }) {
  const target = path.resolve(outDir);
  let existing = [];
  try {
    existing = fs.readdirSync(target);
  } catch {
    // missing target directory is the normal case
  }
  if (existing.length > 0) {
    throw new CorpusDiagnostic('backup-target-not-empty', 'backup target directory exists and is not empty', { outDir: target });
  }
  let libraryReal;
  try {
    libraryReal = fs.realpathSync(path.resolve(libraryRoot));
  } catch {
    throw new CorpusDiagnostic('library-root-missing', 'the library root does not exist', {});
  }
  fs.mkdirSync(target, { recursive: true });

  // The transaction-consistent database image. VACUUM INTO refuses an
  // existing target, so a half-finished backup can never be mistaken for a
  // snapshot; a failure here leaves only the empty directory behind.
  const dbFile = path.join(target, BACKUP_DB_NAME);
  try {
    store.db.prepare('VACUUM INTO ?').run(dbFile);
  } catch (error) {
    throw new CorpusDiagnostic('backup-snapshot-failed', `the database snapshot failed (${error.name ?? 'error'})`, {});
  }

  // Required files, read back from the database — the store, not a directory
  // walk, decides what a complete backup needs.
  const files = [];
  const copyVerified = (relativePath, expectedSha256, what) => {
    const real = confinedFile(libraryReal, relativePath);
    const actual = sha256File(real);
    if (expectedSha256 !== null && actual !== expectedSha256) {
      throw new CorpusDiagnostic('backup-file-mismatch', `${what} '${relativePath}' does not match its registered checksum`, {
        path: relativePath,
      });
    }
    const destination = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(real, destination);
    files.push({ path: relativePath, bytes: fs.statSync(real).size, sha256: actual });
  };

  const packages = store.db
    .prepare(
      `SELECT article_id, revision_id, extractor_version, document_json
       FROM extractions ORDER BY article_id, revision_id, extractor_version`
    )
    .all();
  for (const pkg of packages) {
    const base = `articles/${pkg.article_id}/revisions/${pkg.revision_id}`;
    copyVerified(`${base}/raw.html`, pkg.revision_id, 'raw html');
    copyVerified(`${base}/extractions/${pkg.extractor_version}/article.json`, null, 'article document');
    copyVerified(`${base}/extractions/${pkg.extractor_version}/text.md`, null, 'extracted text');
    // The document on disk must be the document the database registered —
    // otherwise the backup would certify files the store never saw.
    const documentOnDisk = JSON.parse(fs.readFileSync(path.join(libraryReal, `${base}/extractions/${pkg.extractor_version}/article.json`), 'utf8'));
    if (JSON.stringify(documentOnDisk) !== pkg.document_json) {
      throw new CorpusDiagnostic('backup-document-mismatch', `article.json of ${pkg.revision_id.slice(0, 12)}/${pkg.extractor_version} differs from the registered document`, {});
    }
    const associations = store.db
      .prepare(
        `SELECT em.asset_id, a.extension FROM extraction_media em
         JOIN media_assets a ON a.asset_id = em.asset_id
         WHERE em.article_id = ? AND em.revision_id = ? AND em.extractor_version = ?
         ORDER BY em.asset_id`
      )
      .all(pkg.article_id, pkg.revision_id, pkg.extractor_version);
    for (const asset of associations) {
      copyVerified(`${base}/images/${asset.asset_id}.${asset.extension}`, asset.asset_id, 'image asset');
    }
  }

  const manifest = {
    backup_format: BACKUP_FORMAT,
    created_at: new Date().toISOString(),
    source_db: path.basename(store.dbPath),
    db: { file: BACKUP_DB_NAME, bytes: fs.statSync(dbFile).size, sha256: sha256File(dbFile) },
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  fs.writeFileSync(path.join(target, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outDir: target, files: files.length, dbBytes: manifest.db.bytes };
}

// Restore reads and verifies the whole backup BEFORE the target directory is
// created; the target must not exist, so a live library is unreachable by
// construction. After the copy the restored database answers its own
// reference check (foreign_key_check) — the sums prove the bytes, the FK
// check proves the links (25 §9: спачатку правярае сумы і спасылкі).
export function restoreCorpus({ backupDir, newLibraryRoot }) {
  const source = path.resolve(backupDir);
  const target = path.resolve(newLibraryRoot);
  if (fs.existsSync(target)) {
    throw new CorpusDiagnostic('restore-target-exists', 'refusing to restore over an existing directory — pick a fresh library root', {
      target,
    });
  }
  let manifest;
  const manifestFile = path.join(source, MANIFEST_NAME);
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    throw new CorpusDiagnostic('backup-manifest-missing', `cannot read the backup manifest (${MANIFEST_NAME})`, {});
  }
  if (manifest?.backup_format !== BACKUP_FORMAT || typeof manifest.source_db !== 'string' || manifest.db?.file !== BACKUP_DB_NAME) {
    throw new CorpusDiagnostic('backup-manifest-invalid', 'the backup manifest is not a recognizable corpus backup', {});
  }
  const manifestPathError = (relativePath) => new CorpusDiagnostic('unsafe-backup-path', `manifest entry '${relativePath}' is not a safe backup path`, {});

  const verify = (relativePath, expectedSha256) => {
    if (relativePath !== BACKUP_DB_NAME && !safeBackupRelativePath(relativePath)) throw manifestPathError(relativePath);
    const file = path.join(source, relativePath);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      throw new CorpusDiagnostic('backup-file-missing', `backup file '${relativePath}' listed in the manifest is missing`, { path: relativePath });
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedSha256) {
      throw new CorpusDiagnostic('backup-checksum-mismatch', `backup file '${relativePath}' does not match its manifest checksum`, {
        path: relativePath,
      });
    }
    return bytes;
  };

  const dbBytes = verify(manifest.db.file, manifest.db.sha256);
  for (const entry of manifest.files ?? []) {
    verify(entry.path, entry.sha256);
  }

  // Everything checked — create the target and materialize the backup.
  fs.mkdirSync(target, { recursive: true });
  try {
    const restoredDbPath = path.join(target, path.basename(manifest.source_db));
    fs.writeFileSync(restoredDbPath, dbBytes);
    for (const entry of manifest.files ?? []) {
      const destination = path.join(target, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(source, entry.path), destination);
    }
    const db = new DatabaseSync(restoredDbPath);
    try {
      const integrity = db.prepare('PRAGMA integrity_check').get();
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (integrity?.integrity_check !== 'ok' || violations.length > 0) {
        throw new CorpusDiagnostic('restore-verification-failed', 'the restored database failed its integrity or reference check', {});
      }
    } finally {
      db.close();
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return { libraryRoot: target, dbPath: path.join(target, path.basename(manifest.source_db)) };
}
