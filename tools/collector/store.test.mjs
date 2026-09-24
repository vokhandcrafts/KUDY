import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { countRows, enqueueStep, insertMedia, openStore, upsertRawRecord } from './store.mjs';
import { makeTempDir, rawRecord, seedCampaign } from './testkit.mjs';

// Verbatim from docs/24_web_collection.md «Пашпарт запісу (RawRecord)», in the
// table's printed order. The spec's `topics[]` annotation marks the array
// type; the column is named `topics` and stores the array as JSON text — the
// single declared mapping (store.mjs header).
const SPEC_RAW_RECORD_COLUMNS = [
  'id',
  'campaign_id',
  'source_type',
  'url',
  'canonical_url',
  'collected_at',
  'city',
  'topics',
  'rights',
  'content_hash',
  'status',
  'snapshot_path',
  'media_dir',
];

test('AC4: raw_records columns equal the spec passport list, verbatim and in order', () => {
  const db = openStore(path.join(makeTempDir(), 'db.sqlite'));
  const columns = db.prepare('PRAGMA table_info(raw_records)').all().map((column) => column.name);
  assert.deepEqual(columns, SPEC_RAW_RECORD_COLUMNS);
});

test('first open creates the full schema; reopening the same database is a no-op', () => {
  const dbPath = path.join(makeTempDir(), 'db.sqlite');
  const db = openStore(dbPath);
  for (const table of ['campaigns', 'raw_records', 'links', 'media', 'run_log']) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `table ${table} exists`);
  }
  const reopened = openStore(dbPath);
  assert.equal(countRows(reopened, 'campaigns'), 0);
  assert.equal(countRows(reopened, 'raw_records'), 0);
});

test('upsertRawRecord keeps one row per (campaign_id, url); re-insert reports no change', () => {
  const db = openStore(path.join(makeTempDir(), 'db.sqlite'));
  seedCampaign(db);
  const record = rawRecord();
  assert.equal(upsertRawRecord(db, record), true);
  assert.equal(upsertRawRecord(db, { ...record, id: 'second-uuid' }), false);
  assert.equal(countRows(db, 'raw_records'), 1);
});

test('vocabulary CHECKs reject a value outside the spec lists', () => {
  const db = openStore(path.join(makeTempDir(), 'db.sqlite'));
  seedCampaign(db);
  assert.throws(() => upsertRawRecord(db, rawRecord({ rights: 'public' })), /CHECK constraint failed/);
  assert.throws(() => upsertRawRecord(db, rawRecord({ source_type: 'podcast' })), /CHECK constraint failed/);
});

// A database written by the pre-G17.03 schema (no run_log.detail, no media
// uniqueness) must keep working: openStore migrates it in place, so `run`
// neither crashes nor duplicates media rows on old databases.
test('AC (G17.03): a pre-G17.03 database is migrated in place by openStore', () => {
  const dbPath = path.join(makeTempDir(), 'old-schema.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE campaigns (
      id TEXT PRIMARY KEY, city TEXT NOT NULL, source_path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL, seeds TEXT NOT NULL, topics TEXT NOT NULL,
      fence TEXT NOT NULL, youtube TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE raw_records (
      id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      source_type TEXT NOT NULL, url TEXT NOT NULL, canonical_url TEXT,
      collected_at TEXT, city TEXT NOT NULL, topics TEXT NOT NULL, rights TEXT NOT NULL,
      content_hash TEXT, status TEXT NOT NULL DEFAULT 'raw', snapshot_path TEXT, media_dir TEXT,
      UNIQUE (campaign_id, url)
    );
    CREATE TABLE media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
      position INTEGER, alt TEXT, caption TEXT, source_url TEXT, file TEXT,
      content_hash TEXT, width_px INTEGER, height_px INTEGER, rights TEXT, collected_at TEXT
    );
    CREATE TABLE run_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      kind TEXT NOT NULL, ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      UNIQUE (campaign_id, kind, ref)
    );
  `);
  legacy.close();

  const db = openStore(dbPath);
  seedCampaign(db);
  const record = rawRecord();
  assert.equal(upsertRawRecord(db, record), true);

  enqueueStep(db, 'c1', 'image', 'rec:0', '2026-09-25T00:00:00.000Z', '{"recordId":"rec"}');
  const step = db.prepare("SELECT detail FROM run_log WHERE kind = 'image'").get();
  assert.equal(step.detail, '{"recordId":"rec"}', 'the detail work-order column exists after the migration');

  const media = { rawRecordId: record.id, position: 1, alt: 'a', caption: null, sourceUrl: 'u', file: 'x-img-01.png', contentHash: 'h', widthPx: 1, heightPx: 1, rights: 'research_only', collectedAt: '2026-09-25T00:00:00.000Z' };
  assert.equal(insertMedia(db, media), true);
  assert.equal(insertMedia(db, media), false, 'the unique index rejects a duplicate (raw_record_id, file)');
  assert.equal(countRows(db, 'media'), 1);
});
