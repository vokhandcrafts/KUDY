// Raw snapshot pipeline (G17.01.b): a fetched page becomes a per-article
// snapshot dir plus a raw_records passport row (docs/24_web_collection.md
// «Пашпарт запісу (RawRecord)»). The snapshot is the archive — written once,
// never rewritten: a URL already registered skips all file work (resume), and
// dedup never touches existing files. G17.06 cleans into new versions, never
// over raw.
//
// Dedup per the spec («Калектары»: па URL і па хэш тэксту):
// - level 1 — UNIQUE(campaign_id, url): the same page twice is one record;
// - level 2 — the same text under a new URL gets its own row with the same
//   content_hash whose canonical_url points at the original record
//   (той самы тэкст звязваем, а не дублюем).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { extractPage } from './extract.mjs';
import { enqueueStep, insertLink, sha256Hex, upsertRawRecord } from './store.mjs';

// Default location alongside the collector's default runtime database; the CLI
// passes <db-dir>/snapshots explicitly, so this only covers direct runCampaign
// calls. Gitignored with the rest of tools/collector/runtime/.
export function defaultSnapshotsRoot() {
  return fileURLToPath(new URL('./runtime/snapshots', import.meta.url));
}

// «Слаг — гэта кароткі лацінскі запіс назвы артыкула» («Фота»): latin,
// lowercase, diacritics folded where Unicode allows. The url-hash suffix keeps
// two articles from ever sharing a snapshot dir, so no run can overwrite
// another article's files.
export function slugify(title) {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'article' : slug;
}

export function processFetchedPage(db, campaign, campaignId, { url, html, now, snapshotsRoot }) {
  const registered = db
    .prepare('SELECT id FROM raw_records WHERE campaign_id = ? AND url = ?')
    .get(campaignId, url);
  if (registered) return { outcome: 'duplicate-url', recordId: registered.id };

  const page = extractPage(html, url); // throws the corrupt-input diagnostics
  const textBytes = Buffer.from(page.text, 'utf8');
  const contentHash = sha256Hex(textBytes);

  const original = db
    .prepare(
      'SELECT id, canonical_url FROM raw_records WHERE campaign_id = ? AND content_hash = ? ORDER BY rowid LIMIT 1'
    )
    .get(campaignId, contentHash);
  const canonicalUrl = original ? original.canonical_url : page.canonicalUrl;

  const snapshotDir = path.join(
    snapshotsRoot,
    campaignId.slice(0, 12),
    `${slugify(page.title)}-${sha256Hex(url).slice(0, 8)}`
  );
  const mediaDir = path.join(snapshotDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, 'snapshot.html'), Buffer.from(html, 'utf8'));
  fs.writeFileSync(path.join(snapshotDir, 'text.md'), textBytes);
  fs.writeFileSync(path.join(snapshotDir, 'metadata.json'), `${JSON.stringify(page.metadata, null, 2)}\n`);

  const recordId = randomUUID();
  upsertRawRecord(db, {
    id: recordId,
    campaign_id: campaignId,
    source_type: 'web',
    url,
    canonical_url: canonicalUrl,
    collected_at: now,
    city: campaign.city,
    topics: JSON.stringify(campaign.topics),
    rights: 'research_only',
    content_hash: contentHash,
    status: 'raw',
    snapshot_path: snapshotDir,
    media_dir: mediaDir,
  });
  for (const link of page.links) {
    insertLink(db, { rawRecordId: recordId, anchorText: link.anchor, url: link.url, context: link.context });
  }
  // Each image occurrence of the page becomes its own run_log step (G17.03):
  // the descriptor JSON in `detail` carries everything the step needs — the
  // source URL, the text.md block the image belongs before, alt/caption and
  // the article slug for the spec filename. A source the loader cannot serve
  // (or bytes that probe as corrupt) fails that one step with a diagnostic;
  // the record and the run continue.
  page.images.forEach((image, occurrence) => {
    enqueueStep(
      db,
      campaignId,
      'image',
      `${recordId}:${String(occurrence)}`,
      now,
      JSON.stringify({
        recordId,
        occurrence,
        url: image.url,
        position: image.position,
        alt: image.alt,
        caption: image.caption,
        slug: slugify(page.title),
      })
    );
  });
  return { outcome: original ? 'duplicate-text' : 'recorded', recordId, snapshotDir, contentHash };
}
