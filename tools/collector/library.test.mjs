import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { basketRows, exportDraft, searchLibrary, syncSearchIndex } from './library.mjs';
import { exportReviewBundle } from './review.mjs';
import { makeTempDir, rawRecord, seedCampaign } from './testkit.mjs';
import {
  basketAdd,
  getRawRecord,
  insertCleanedVersion,
  markRecordCleaned,
  openStore,
  sha256Hex,
  upsertRawRecord,
} from './store.mjs';

// The library fixture: hand-built records in the production shape (passport
// row + cleaned document on disk — the same parts search and export read).
// The crawl pipeline has its own suites; here the passport fields vary per
// record, which is what the filter assertions need.
function writeCleanedRecord(db, record, { title, lines }) {
  const document = [
    '---',
    `record: ${record.id}`,
    `url: ${record.url}`,
    `type: ${record.source_type}`,
    'package: news-v1',
    `title: ${title}`,
    'published_at: 2026-09-20',
    'language: pl',
    '---',
    '',
    ...lines,
    '',
  ].join('\n');
  fs.mkdirSync(path.join(record.snapshot_path, 'cleaned'), { recursive: true });
  const filePath = path.join(record.snapshot_path, 'cleaned', 'v1.md');
  fs.writeFileSync(filePath, document, 'utf8');
  insertCleanedVersion(db, {
    rawRecordId: record.id,
    version: 1,
    package: 'news-v1',
    packageVersion: 1,
    contentHash: sha256Hex(document),
    path: filePath,
    createdAt: '2026-09-26T00:00:00.000Z',
  });
  markRecordCleaned(db, record.id);
  return record;
}

// Three records covering every passport axis (gdansk / krakow, history /
// architecture, web / wiki) plus one raw record with no cleaned document.
// Urls sort cranes < shipyard < main-hall — the stable order the result
// assertions follow.
function buildLibrary(db, dir) {
  const addRecord = (overrides) => {
    const record = rawRecord({ campaignId: 'c1', ...overrides });
    upsertRawRecord(db, record);
    return record;
  };
  const history = writeCleanedRecord(
    db,
    addRecord({ url: 'https://gdansk.example/shipyard', source_type: 'web', snapshot_path: path.join(dir, 'shipyard') }),
    { title: 'Gdansk shipyard turns into a museum', lines: ['The [shipyard history](https://gdansk.example/history) began in 1844.'] }
  );
  const hall = writeCleanedRecord(
    db,
    addRecord({
      url: 'https://krakow.example/main-hall',
      source_type: 'wiki',
      city: 'krakow',
      topics: JSON.stringify(['architecture']),
      snapshot_path: path.join(dir, 'main-hall'),
    }),
    { title: 'The main hall guide', lines: ['The main hall of the museum opened in 1890.'] }
  );
  const cranes = addRecord({ url: 'https://gdansk.example/cranes', source_type: 'web' });
  return { history, hall, cranes };
}

test('passport filters hit the expected records (criterion 1)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall, cranes } = buildLibrary(db, dir);
  const ids = (query) => searchLibrary(db, query).map((row) => row.id);
  assert.deepEqual(ids({ city: 'gdansk' }), [cranes.id, history.id]);
  assert.deepEqual(ids({ city: 'krakow' }), [hall.id]);
  assert.deepEqual(ids({ topic: 'architecture' }), [hall.id]);
  assert.deepEqual(ids({ topic: 'history' }), [cranes.id, history.id]);
  assert.deepEqual(ids({ type: 'wiki' }), [hall.id]);
  assert.deepEqual(ids({ city: 'gdansk', topic: 'history', type: 'web' }), [cranes.id, history.id]);
  assert.deepEqual(ids({ city: 'gdansk', type: 'wiki' }), []);
});

test('full text finds a record by a phrase from its cleaned text (criterion 1)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall, cranes } = buildLibrary(db, dir);
  const ids = (query) => searchLibrary(db, { query }).map((row) => row.id);
  assert.deepEqual(ids('shipyard history'), [history.id]);
  assert.deepEqual(ids('began in 1844'), [history.id]);
  assert.deepEqual(ids('main hall of the museum'), [hall.id]);
  // A record without a cleaned document has no body to find.
  assert.deepEqual(ids('cranes'), []);
  // Hyphenated and punctuation-heavy phrases stay valid queries — the phrase
  // wrap keeps FTS5's operator syntax out of the author's input.
  assert.deepEqual(ids('ціна-якасць (незнойдзена)'), []);
  // Filters compose with the full text.
  assert.deepEqual(ids('main hall'), [hall.id]);
  assert.deepEqual(searchLibrary(db, { city: 'gdansk', query: 'main hall' }), []);
  assert.deepEqual(searchLibrary(db, { city: 'krakow', query: 'main hall' }).map((row) => row.id), [hall.id]);
  // The result row carries the passport and the indexed title.
  const hit = searchLibrary(db, { query: 'shipyard history' })[0];
  assert.equal(hit.status, 'cleaned');
  assert.equal(hit.title, 'Gdansk shipyard turns into a museum');
  assert.equal(hit.collected_at, history.collected_at);
});

test('the search index follows the latest cleaned version', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history } = buildLibrary(db, dir);
  const ids = (query) => searchLibrary(db, { query }).map((row) => row.id);
  // Warm the index on v1 first: the guard under test is the re-index on a
  // version bump, not the cold first index.
  assert.deepEqual(ids('began in 1844'), [history.id]);
  const document2 = [
    '---',
    `record: ${history.id}`,
    `url: ${history.url}`,
    'type: web',
    'package: news-v1',
    'title: Gdansk shipyard turns into a museum',
    'published_at: 2026-09-20',
    'language: pl',
    '---',
    '',
    'Renovated in 2020, the shipyard museum opened its main hall.',
    '',
  ].join('\n');
  const v2Path = path.join(history.snapshot_path, 'cleaned', 'v2.md');
  fs.writeFileSync(v2Path, document2, 'utf8');
  insertCleanedVersion(db, {
    rawRecordId: history.id,
    version: 2,
    package: 'news-v1',
    packageVersion: 2,
    contentHash: sha256Hex(document2),
    path: v2Path,
    createdAt: '2026-09-26T01:00:00.000Z',
  });
  assert.deepEqual(ids('renovated in 2020'), [history.id]);
  assert.deepEqual(ids('began in 1844'), []);
  const indexed = db.prepare('SELECT version FROM cleaned_fts WHERE raw_record_id = ?').get(history.id);
  assert.equal(indexed.version, 2);
});

test('the search index drops a record whose cleaned versions disappeared', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { hall } = buildLibrary(db, dir);
  assert.deepEqual(searchLibrary(db, { query: 'main hall of the museum' }).map((row) => row.id), [hall.id]);
  db.prepare('DELETE FROM cleaned_versions WHERE raw_record_id = ?').run(hall.id);
  fs.rmSync(path.join(hall.snapshot_path, 'cleaned'), { recursive: true, force: true });
  syncSearchIndex(db);
  assert.deepEqual(searchLibrary(db, { query: 'main hall of the museum' }), []);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM cleaned_fts WHERE raw_record_id = ?').get(hall.id).n, 0,
    'the dropped record leaves no stale index row'
  );
});

test('export writes a draft whose fragments carry the citation line (criterion 2)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall } = buildLibrary(db, dir);
  assert.ok(basketAdd(db, history.id, '2026-09-26T02:00:00.000Z'));
  assert.ok(basketAdd(db, hall.id, '2026-09-26T02:00:00.000Z'));
  const outPath = path.join(dir, 'draft.md');
  const { fragments, transitioned } = exportDraft(db, { outPath });
  assert.equal(fragments, 2);
  assert.equal(transitioned, 2);
  const draft = fs.readFileSync(outPath, 'utf8');
  // The citation line per fragment: source URL + collection date, with the
  // record id carrying provenance into 07. Reverting the citation writer
  // makes exactly these assertions fail.
  assert.match(
    draft,
    new RegExp(`Крыніца: https://gdansk\\.example/shipyard\\nЗабрана: ${history.collected_at} · Запіс: ${history.id}`)
  );
  assert.match(
    draft,
    new RegExp(`Крыніца: https://krakow\\.example/main-hall\\nЗабрана: ${hall.collected_at} · Запіс: ${hall.id}`)
  );
  // Fragment bodies: the cleaned text under the fragment title.
  assert.match(draft, /## Gdansk shipyard turns into a museum/);
  assert.match(draft, /began in 1844\./);
  assert.match(draft, /## The main hall guide/);
  assert.match(draft, /opened in 1890\./);
  // Stable url order: the gdansk fragment before the krakow one.
  assert.ok(draft.indexOf('Gdansk shipyard') < draft.indexOf('The main hall guide'));
});

test('exported records move cleaned to used; a repeat export does not duplicate (criterion 3)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall } = buildLibrary(db, dir);
  basketAdd(db, history.id, '2026-09-26T02:00:00.000Z');
  basketAdd(db, hall.id, '2026-09-26T02:00:00.000Z');
  const outPath = path.join(dir, 'draft.md');
  exportDraft(db, { outPath });
  assert.equal(getRawRecord(db, history.id).status, 'used');
  assert.equal(getRawRecord(db, hall.id).status, 'used');

  const first = fs.readFileSync(outPath, 'utf8');
  const repeat = path.join(dir, 'draft-again.md');
  const { fragments, transitioned } = exportDraft(db, { outPath: repeat });
  assert.equal(fragments, 2);
  assert.equal(transitioned, 0, 'already used records do not count as moved again');
  // Idempotent: the repeat renders the same draft, each fragment once.
  assert.equal(fs.readFileSync(repeat, 'utf8'), first);
  assert.equal(first.split(`Запіс: ${history.id}`).length - 1, 1);
  assert.equal(first.split(`Запіс: ${hall.id}`).length - 1, 1);
});

test('an empty basket answers with a diagnostic and writes no file (criterion 4)', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  buildLibrary(db, dir);
  const outPath = path.join(dir, 'draft.md');
  assert.throws(() => exportDraft(db, { outPath }), /basket is empty — add fragments with `basket add` first/);
  assert.equal(fs.existsSync(outPath), false);
});

test('a draft export that cannot read a cleaned file leaves the previous draft intact', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history } = buildLibrary(db, dir);
  basketAdd(db, history.id, '2026-09-26T02:00:00.000Z');
  const outPath = path.join(dir, 'draft.md');
  exportDraft(db, { outPath });
  const intact = fs.readFileSync(outPath, 'utf8');
  fs.rmSync(path.join(history.snapshot_path, 'cleaned'), { recursive: true, force: true });
  assert.throws(() => exportDraft(db, { outPath }), /no such file or directory/);
  assert.equal(fs.readFileSync(outPath, 'utf8'), intact);
});

test('basket rows carry the fragment title and the added stamp; adds are idempotent', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall } = buildLibrary(db, dir);
  const addedAt = '2026-09-26T02:00:00.000Z';
  assert.ok(basketAdd(db, hall.id, addedAt));
  assert.equal(basketAdd(db, hall.id, addedAt), false, 'a repeated add is a no-op, not a duplicate');
  assert.ok(basketAdd(db, history.id, addedAt));
  const rows = basketRows(db);
  assert.deepEqual(rows.map((row) => row.id), [history.id, hall.id]);
  assert.equal(rows[0].title, 'Gdansk shipyard turns into a museum');
  assert.equal(rows[1].title, 'The main hall guide');
  assert.equal(rows[0].added_at, addedAt);
  assert.equal(rows[0].status, 'cleaned');
});

test('exportReviewBundle still lists the campaign records the library fixture cleaned', () => {
  const dir = makeTempDir();
  const db = openStore(path.join(dir, 'db.sqlite'));
  seedCampaign(db);
  const { history, hall } = buildLibrary(db, dir);
  const { entries } = exportReviewBundle(db, 'c1', { reviewDir: path.join(dir, 'review') });
  assert.deepEqual(entries.map((entry) => entry.url), [history.url, hall.url]);
});
