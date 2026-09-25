// SQLite storage for the collector (G17.01.a). Local, one-person tool: no
// server, no queue. Schema is created on first open (CREATE IF NOT EXISTS), so
// `init`, `run` and `status` all work against the same on-disk database.
//
// raw_records column order mirrors the spec table verbatim —
// docs/24_web_collection.md «Пашпарт запісу (RawRecord)». The schema test
// compares PRAGMA output against that exact list. Spec's `topics[]` is stored
// as a JSON text column named `topics`; that mapping is declared once here and
// asserted in the schema test.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      source_path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      seeds TEXT NOT NULL,
      topics TEXT NOT NULL,
      fence TEXT NOT NULL,
      youtube TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS raw_records (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      source_type TEXT NOT NULL CHECK (source_type IN ('news', 'wiki', 'web', 'youtube')),
      url TEXT NOT NULL,
      canonical_url TEXT,
      collected_at TEXT,
      city TEXT NOT NULL,
      topics TEXT NOT NULL,
      rights TEXT NOT NULL CHECK (rights IN ('public_domain', 'licensed', 'research_only', 'author_own')),
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'raw' CHECK (status IN ('raw', 'cleaned', 'used')),
      snapshot_path TEXT,
      media_dir TEXT,
      UNIQUE (campaign_id, url)
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
      anchor_text TEXT NOT NULL,
      url TEXT NOT NULL,
      context TEXT
    );
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
      position INTEGER,
      alt TEXT,
      caption TEXT,
      source_url TEXT,
      file TEXT,
      content_hash TEXT,
      width_px INTEGER,
      height_px INTEGER,
      rights TEXT,
      collected_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS media_record_file ON media (raw_record_id, file);
    CREATE TABLE IF NOT EXISTS run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      detail TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE (campaign_id, kind, ref)
    );
  `);
  // Databases created before G17.03 keep working: their media table lacks the
  // uniqueness the image steps rely on (carried by the named index above,
  // CREATE IF NOT EXISTS) and their run_log lacks the detail work-order
  // column. CREATE TABLE IF NOT EXISTS never alters an existing table, so the
  // missing column is added here, once, by a schema check.
  const columns = db.prepare('PRAGMA table_info(run_log)').all().map((column) => column.name);
  if (!columns.includes('detail')) {
    db.exec('ALTER TABLE run_log ADD COLUMN detail TEXT');
  }
}

export function openStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  createSchema(db);
  return db;
}

// Campaign identity is the campaign file's resolved path: same file → same
// row, re-running never duplicates. Editing the file keeps the identity (the
// row's content_hash records what was last seen); a copied file is a new
// campaign by definition.
export function ensureCampaign(db, { campaign, sourcePath, contentHash }) {
  const id = sha256Hex(sourcePath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  ).run(
    id,
    campaign.city,
    sourcePath,
    contentHash,
    JSON.stringify(campaign.seeds),
    JSON.stringify(campaign.topics),
    JSON.stringify(campaign.fence),
    JSON.stringify(campaign.youtube),
    now
  );
  return { campaignId: id };
}

export function upsertRawRecord(db, record) {
  const result = db.prepare(
    `INSERT INTO raw_records
       (id, campaign_id, source_type, url, canonical_url, collected_at, city, topics, rights,
        content_hash, status, snapshot_path, media_dir)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, url) DO NOTHING`
  ).run(
    record.id,
    record.campaign_id,
    record.source_type,
    record.url,
    record.canonical_url,
    record.collected_at,
    record.city,
    record.topics,
    record.rights,
    record.content_hash,
    record.status,
    record.snapshot_path,
    record.media_dir
  );
  return result.changes === 1;
}

// The raw snapshot's link list (spec: тэкст-анкер + адрас + кантэкстны абзац)
// lives in `links`, one row per anchor of the record's text.md.
export function insertLink(db, { rawRecordId, anchorText, url, context }) {
  db.prepare('INSERT INTO links (raw_record_id, anchor_text, url, context) VALUES (?, ?, ?, ?)').run(
    rawRecordId,
    anchorText,
    url,
    context
  );
}

// The snapshot's image inventory (docs/24_web_collection.md «Фота»: артыкул,
// нумар абзаца, alt, подпіс, сапраўдны URL, файл, хэш, памер у пікселях,
// rights, дата збору). UNIQUE(raw_record_id, file) makes a resumed image step
// a no-op instead of a duplicate row — the filename is derived from the
// step's own occurrence, so a re-run converges on the same row.
export function insertMedia(db, media) {
  const result = db.prepare(
    `INSERT INTO media (raw_record_id, position, alt, caption, source_url, file, content_hash,
                        width_px, height_px, rights, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(raw_record_id, file) DO NOTHING`
  ).run(
    media.rawRecordId,
    media.position,
    media.alt,
    media.caption,
    media.sourceUrl,
    media.file,
    media.contentHash,
    media.widthPx,
    media.heightPx,
    media.rights,
    media.collectedAt
  );
  return result.changes === 1;
}

// run_log is the run loop's progress record: one row per work item of a
// campaign (kind 'seed' for each seed URL, 'youtube' for each video id,
// 'image' for each image occurrence of a snapshot — G17.03). UNIQUE(campaign_id,
// kind, ref) makes enqueuing idempotent; a row left in 'running' by an
// interrupted process is claimable again by the next run — resume, not
// restart. `detail` carries the kind's work order: the image step stores its
// descriptor JSON there, so a resumed process re-derives nothing.
export function enqueueStep(db, campaignId, kind, ref, now, detail = null) {
  const result = db.prepare(
    `INSERT INTO run_log (campaign_id, kind, ref, status, attempts, detail, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(campaign_id, kind, ref) DO NOTHING`
  ).run(campaignId, kind, ref, detail, now);
  return result.changes === 1;
}

export function claimableSteps(db, campaignId) {
  return db.prepare(
    `SELECT id, kind, ref, status, attempts, detail FROM run_log
     WHERE campaign_id = ? AND status IN ('pending', 'running') ORDER BY id`
  ).all(campaignId);
}

export function claimStep(db, id, now) {
  db.prepare(
    `UPDATE run_log SET status = 'running', started_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?`
  ).run(now, id);
}

export function completeStep(db, id, now, detail = null) {
  db.prepare(
    `UPDATE run_log SET status = 'done', finished_at = ?, detail = COALESCE(?, detail) WHERE id = ?`
  ).run(now, detail, id);
}

export function failStep(db, id, error, now) {
  db.prepare(`UPDATE run_log SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`).run(now, error, id);
}

export function countRows(db, table, campaignId) {
  const filter = campaignId ? ' WHERE campaign_id = ?' : '';
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${filter}`).get(...(campaignId ? [campaignId] : []));
  return Number(row.n);
}

// Records whose snapshot exists on disk (snapshot_path set); YouTube shells
// registered before G17.05 fill them carry no snapshot and are not counted.
export function countSnapshots(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM raw_records WHERE snapshot_path IS NOT NULL').get();
  return Number(row.n);
}

export function stepStatusCounts(db, campaignId) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM run_log${campaignId ? ' WHERE campaign_id = ?' : ''} GROUP BY status`
  ).all(...(campaignId ? [campaignId] : []));
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}
