// Library tools (G17.07): search, basket and the markdown draft export
// (docs/24_web_collection.md «Зборка гайдаў — рукамі»). The author finds
// library records (city, topic, source type, full text over the cleaned
// documents), collects fragments in the basket and exports a draft whose
// citation lines (source URL + collection date) carry the provenance `07`
// receives as Source. Exporting moves a record's status cleaned → used; the
// raw record and the cleaned documents themselves are never rewritten.
//
// The search is the spec's single-library model: no campaign filter anywhere —
// filters are the passport fields (city, topic, source type) and the full text
// over the latest cleaned documents. Full text runs on an FTS5 index
// (cleaned_fts, node:sqlite ships FTS5) that syncSearchIndex rebuilds from
// cleaned_versions before every search; the sqlite-vec vector search the spec
// names belongs to `07`'s stack, not to this CLI (a deliberate scope line,
// recorded in results/G17.07.md).
import fs from 'node:fs';
import { basketIds, basketRecords, latestCleanedRecords, markRecordUsed } from './store.mjs';
import { cleanedBody } from './review.mjs';

// Brings the FTS index in line with the latest cleaned versions: indexes a
// record that is missing, re-indexes one whose latest version moved, drops one
// whose cleaned versions disappeared. The index is derived state — a search
// after any cleaning run converges on it, nothing else maintains it.
export function syncSearchIndex(db) {
  const rows = latestCleanedRecords(db);
  const indexed = new Map(
    db.prepare('SELECT raw_record_id, version FROM cleaned_fts').all().map((row) => [row.raw_record_id, row.version])
  );
  const known = new Set(rows.map((row) => row.id));
  for (const recordId of indexed.keys()) {
    if (!known.has(recordId)) {
      db.prepare('DELETE FROM cleaned_fts WHERE raw_record_id = ?').run(recordId);
      indexed.delete(recordId);
    }
  }
  for (const row of rows) {
    if (indexed.get(row.id) === row.version) continue;
    let document;
    try {
      document = fs.readFileSync(row.path, 'utf8');
    } catch (error) {
      throw new Error(`search: cannot read cleaned document ${row.path} — ${error.message}`);
    }
    db.prepare('DELETE FROM cleaned_fts WHERE raw_record_id = ?').run(row.id);
    db.prepare('INSERT INTO cleaned_fts (raw_record_id, version, title, body) VALUES (?, ?, ?, ?)').run(
      row.id,
      row.version,
      document.match(/^title: (.*)$/m)?.[1] ?? null,
      document
    );
  }
}
// One library search: passport filters over raw_records, full text as an FTS5
// phrase MATCH over the latest cleaned documents (a record without a cleaned
// document has no body to index and only answers the passport filters). The
// query is wrapped as one quoted phrase — the author types a phrase from the
// text, not the FTS5 query language, and the wrap keeps every input a valid
// query (hyphenated words included: a bare `ціна-якасць` collides with FTS5's
// column-filter syntax). `topic` is an exact list member of the passport's
// topics JSON, not a substring.
export function searchLibrary(db, { city, topic, type, query } = {}) {
  syncSearchIndex(db);
  const filters = [];
  const params = [];
  if (city) {
    filters.push('r.city = ?');
    params.push(city);
  }
  if (topic) {
    filters.push('EXISTS (SELECT 1 FROM json_each(r.topics) WHERE json_each.value = ?)');
    params.push(topic);
  }
  if (type) {
    filters.push('r.source_type = ?');
    params.push(type);
  }
  if (query) {
    filters.push('r.id IN (SELECT raw_record_id FROM cleaned_fts WHERE cleaned_fts MATCH ?)');
    params.push(`"${query.replaceAll('"', '""')}"`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT r.id, r.source_type, r.url, r.collected_at, r.city, r.status, f.title
     FROM raw_records r
     LEFT JOIN cleaned_fts f ON f.raw_record_id = r.id
     ${where}
     ORDER BY r.url`
  ).all(...params);
  return rows;
}

// The draft markdown: one fragment per basket record in stable url order —
// the cleaned body under the fragment title, with the citation line the
// author's review quotes (source URL + collection date) and the record id
// that carries provenance into `07`. Deterministic output: no timestamps, so
// a repeat export of an unchanged basket produces the same file.
export function exportDraft(db, { outPath }) {
  const records = basketRecords(db);
  if (records.length === 0) {
    throw new Error('basket is empty — add fragments with `basket add` first');
  }
  // Read every cleaned text before writing anything: an export that fails
  // midway (a cleaned file the row knows is missing on disk) must leave the
  // previous draft intact, not half-destroy it.
  const fragments = records.map((record) => ({ record, cleanedText: fs.readFileSync(record.path, 'utf8') }));
  const lines = ['# Чарнавік гайда — фрагменты з кошыка', ''];
  for (const { record, cleanedText } of fragments) {
    const title = cleanedText.match(/^title: (.*)$/m)?.[1] ?? record.url;
    lines.push(`## ${title}`, '');
    // The citation voice is the review bundle's («Крыніца:» / «Забрана:»);
    // the draft adds the record id — the provenance `07` needs to walk a
    // fragment back to its raw record.
    lines.push(`Крыніца: ${record.url}`, `Забрана: ${record.collected_at ?? 'невядома'} · Запіс: ${record.id}`, '');
    lines.push(cleanedBody(cleanedText), '');
  }
  fs.writeFileSync(outPath, Buffer.from(lines.join('\n'), 'utf8'));
  // The handoff point: every exported record moves cleaned → used (an already
  // used record stays used — the transition counts only what moved).
  let transitioned = 0;
  for (const record of records) {
    if (markRecordUsed(db, record.id)) transitioned += 1;
  }
  return { outPath, fragments: records.length, transitioned };
}

// The basket list's rows: latest cleaned metadata, the fragment title from
// the search index (synced first — derived state stays coherent wherever it
// is read) and the added_at the basket row carries.
export function basketRows(db) {
  syncSearchIndex(db);
  const added = new Map(basketIds(db).map((row) => [row.raw_record_id, row.added_at]));
  const titles = new Map(
    db.prepare('SELECT raw_record_id, title FROM cleaned_fts').all().map((row) => [row.raw_record_id, row.title])
  );
  return basketRecords(db).map((record) => ({
    ...record,
    added_at: added.get(record.id),
    title: titles.get(record.id) ?? null,
  }));
}
