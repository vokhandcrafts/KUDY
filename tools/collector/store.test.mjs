import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { countRows, openStore, upsertRawRecord } from './store.mjs';
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
