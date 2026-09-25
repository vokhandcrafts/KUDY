// Review export (G17.06): a browseable markdown bundle of the campaign's
// cleaned documents for the author's acceptance pass (docs/24_web_collection.md
// «Ачыстка»: «Прыёмка пакета — прагляд аўтарам выбаркі ачышчаных дакументаў,
// экспартаванай у зручны для прагляду выгляд»). The bundle lives inside the
// campaign's snapshot dir, next to the raw copies it cites:
// review/index.md lists every record's latest cleaned version, and each
// document file opens with the visible citation (source URL + collection
// date) the acceptance pass quotes. The bundle is derived output: re-running
// the export rewrites it deterministically and never touches raw or cleaned
// files.
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './snapshot.mjs';

// The latest cleaned version of every record that has one, in stable url order.
export function cleanedRecordsForReview(db, campaignId) {
  return db.prepare(
    `SELECT r.id, r.url, r.collected_at, v.version, v.package, v.package_version, v.path
     FROM raw_records r
     JOIN cleaned_versions v ON v.raw_record_id = r.id AND v.version = (
       SELECT MAX(version) FROM cleaned_versions WHERE raw_record_id = r.id)
     WHERE r.campaign_id = ?
     ORDER BY r.url`
  ).all(campaignId);
}

// The cleaned document opens with its front matter fence; the review copy
// shows the body under its own citation header.
function cleanedBody(cleanedText) {
  const match = cleanedText.match(/^---\n[\s\S]*?\n---\n\n/);
  return match ? cleanedText.slice(match[0].length) : cleanedText;
}

function citationBlock({ record, title }) {
  const collected = record.collected_at ?? 'невядома';
  return [
    `# ${title}`,
    '',
    `Крыніца: ${record.url}`,
    `Забрана: ${collected} · Пакет: ${record.package}-v${record.package_version} · Версія ачысткі: ${record.version}`,
    '',
    '---',
    '',
  ];
}

export function exportReviewBundle(db, campaignId, { reviewDir } = {}) {
  const records = cleanedRecordsForReview(db, campaignId);
  fs.mkdirSync(reviewDir, { recursive: true });
  const entries = [];
  for (const record of records) {
    const cleanedText = fs.readFileSync(record.path, 'utf8');
    const title = cleanedText.match(/^title: (.*)$/m)?.[1] ?? record.url;
    const file = `${slugify(title)}-${record.id.slice(0, 8)}-v${record.version}.md`;
    const document = citationBlock({ record, title })
      .concat(cleanedBody(cleanedText), '')
      .join('\n');
    fs.writeFileSync(path.join(reviewDir, file), Buffer.from(document, 'utf8'));
    entries.push({ file, title, url: record.url });
  }
  const index = ['# Агляд ачысткі — выбарка для аўтара', ''];
  if (entries.length === 0) index.push('Ачышчаных дакументаў яшчэ няма — спачатку запуск `clean`.');
  for (const entry of entries) index.push(`- [${entry.title}](${entry.file}) — ${entry.url}`);
  fs.writeFileSync(path.join(reviewDir, 'index.md'), Buffer.from(index.join('\n') + '\n', 'utf8'));
  return { entries };
}
