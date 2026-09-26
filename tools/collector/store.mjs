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
    -- Cleaning versions (G17.06): one row per written cleaned document. The
    -- raw record is never rewritten — each cleaning run whose package version
    -- differs from the latest writes the next version file (v1, v2, …) and
    -- records the package that produced it here. UNIQUE(raw_record_id, version)
    -- pins a version number to exactly one deterministic document.
    CREATE TABLE IF NOT EXISTS cleaned_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
      version INTEGER NOT NULL,
      package TEXT NOT NULL,
      package_version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (raw_record_id, version)
    );
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
    -- Basket of fragments for the draft export (G17.07): global, one row per
    -- record — the spec's single-library model (docs/24 «Зборка гайдаў —
    -- рукамі»). The PRIMARY KEY makes a repeated add a no-op, so a repeated
    -- draft export never duplicates a fragment.
    CREATE TABLE IF NOT EXISTS basket (
      raw_record_id TEXT PRIMARY KEY REFERENCES raw_records(id),
      added_at TEXT NOT NULL
    );
    -- Full-text index over the latest cleaned documents (G17.07): standalone
    -- FTS5 table, one row per record, holding the indexed version —
    -- syncSearchIndex (library.mjs) re-indexes a record whose latest version
    -- moved and drops one whose cleaned versions disappeared. Derived state
    -- only: it is rebuilt from cleaned_versions before every search and never
    -- feeds back into raw or cleaned files.
    CREATE VIRTUAL TABLE IF NOT EXISTS cleaned_fts USING fts5(
      raw_record_id UNINDEXED, version UNINDEXED, title UNINDEXED, body
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

// The YouTube pipeline (G17.05) fills the shell row registered by
// registerShell (upsertRawRecord stays DO NOTHING — the shell contract):
// transcript hash + snapshot/media locations. The passport columns themselves
// keep their G17.01.a meaning; metadata.json carries the video's title,
// channel, upload date, duration and language.
export function fillYoutubeRecord(db, { campaignId, url, contentHash, snapshotPath, mediaDir }) {
  const result = db
    .prepare(
      `UPDATE raw_records SET content_hash = ?, snapshot_path = ?, media_dir = ?
       WHERE campaign_id = ? AND url = ?`
    )
    .run(contentHash, snapshotPath, mediaDir, campaignId, url);
  if (result.changes !== 1) {
    throw new Error(`youtube record ${url}: shell row not found for campaign ${campaignId.slice(0, 12)}`);
  }
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

// --- Cleaning (G17.06) ---

// The clean/export commands look the campaign up by its identity (the
// resolved campaign file's path — the same key ensureCampaign hashes). Unlike
// ensureCampaign this never inserts: cleaning or exporting a campaign that was
// never run answers "not registered" instead of creating a phantom row.
export function registeredCampaignId(db, sourcePath) {
  const row = db.prepare('SELECT id FROM campaigns WHERE source_path = ?').get(sourcePath);
  return row ? row.id : null;
}

// Records a cleaning run may touch: a snapshot must exist on disk (YouTube
// shells registered before their pipeline filled them carry none) and the
// record must not be consumed by export yet ('used' — G17.07's contract).
export function recordsToClean(db, campaignId) {
  return db.prepare(
    `SELECT id, source_type, url, collected_at, status, snapshot_path FROM raw_records
     WHERE campaign_id = ? AND snapshot_path IS NOT NULL AND status IN ('raw', 'cleaned')
     ORDER BY url`
  ).all(campaignId);
}

export function getRawRecord(db, recordId) {
  return db.prepare('SELECT * FROM raw_records WHERE id = ?').get(recordId);
}

export function latestCleanedVersion(db, recordId) {
  return db.prepare(
    'SELECT version, package, package_version, content_hash, path FROM cleaned_versions WHERE raw_record_id = ? ORDER BY version DESC LIMIT 1'
  ).get(recordId);
}

export function insertCleanedVersion(db, { rawRecordId, version, package: pkg, packageVersion, contentHash, path: filePath, createdAt }) {
  db.prepare(
    `INSERT INTO cleaned_versions (raw_record_id, version, package, package_version, content_hash, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(rawRecordId, version, pkg, packageVersion, contentHash, filePath, createdAt);
}

export function markRecordCleaned(db, recordId) {
  db.prepare(`UPDATE raw_records SET status = 'cleaned' WHERE id = ? AND status = 'raw'`).run(recordId);
}

// --- Library tools (G17.07): search, basket, draft export ---

// The latest cleaned version of every record that has one (optionally scoped
// to one campaign), in stable url order. The shared source of the review
// bundle's per-campaign listing and the library-wide search/export queries.
export function latestCleanedRecords(db, campaignId = null) {
  const filter = campaignId ? 'WHERE r.campaign_id = ?' : '';
  return db.prepare(
    `SELECT r.id, r.campaign_id, r.source_type, r.url, r.collected_at, r.city, r.status,
            v.version, v.package, v.package_version, v.path
     FROM raw_records r
     JOIN cleaned_versions v ON v.raw_record_id = r.id AND v.version = (
       SELECT MAX(version) FROM cleaned_versions WHERE raw_record_id = r.id)
     ${filter}
     ORDER BY r.url`
  ).all(...(campaignId ? [campaignId] : []));
}

// The handoff point of the draft export (docs/24 «Далей — 07 без зменаў»):
// only a 'cleaned' record moves to 'used' — one that is already used stays
// used, so a repeat export changes nothing.
export function markRecordUsed(db, recordId) {
  const result = db.prepare(`UPDATE raw_records SET status = 'used' WHERE id = ? AND status = 'cleaned'`).run(recordId);
  return result.changes === 1;
}

// Adds a record to the basket; false means it was already there (the PRIMARY
// KEY turns a repeated add into a no-op — fragments never duplicate).
export function basketAdd(db, recordId, now) {
  const result = db.prepare(
    'INSERT INTO basket (raw_record_id, added_at) VALUES (?, ?) ON CONFLICT(raw_record_id) DO NOTHING'
  ).run(recordId, now);
  return result.changes === 1;
}

export function basketIds(db) {
  return db.prepare('SELECT raw_record_id, added_at FROM basket').all();
}

// The basket's exportable rows: every basket record that has a latest cleaned
// version, in the stable url order the draft renders. `basket add` only
// accepts records with a cleaned document, so an empty join means the cleaned
// versions disappeared — the export answers that, not a silent gap.
export function basketRecords(db) {
  const ids = basketIds(db);
  if (ids.length === 0) return [];
  const added = new Map(ids.map((row) => [row.raw_record_id, row.added_at]));
  return latestCleanedRecords(db).filter((row) => added.has(row.id));
}

export function basketClear(db) {
  return db.prepare('DELETE FROM basket').run().changes;
}
