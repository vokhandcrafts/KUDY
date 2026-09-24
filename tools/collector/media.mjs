// Media pipeline (G17.03, docs/24_web_collection.md «Фота»): each image
// occurrence of a snapshot is a run_log step (kind 'image') that loads the
// bytes through the offline loader boundary, probes the real pixel
// dimensions, applies the content-size rule, writes the file under the
// article's media/ folder and registers the media row plus the markdown
// image in text.md.
//
// The step is crash-safe by construction — every effect is idempotent on its
// own key, so a resumed run converges instead of duplicating:
// - file: written from the same bytes (deterministic content),
// - media row: UNIQUE(raw_record_id, file) + ON CONFLICT DO NOTHING,
// - markdown: inserted only when the image reference is not in text.md yet.
//
// The loader boundary is the snapshot pipeline's: by default only file://
// sources are served (local fixtures); every other scheme fails the step
// with a diagnostic and the run continues. The real fetcher arrives with
// G17.02.
import fs from 'node:fs';
import path from 'node:path';
import { insertMedia, sha256Hex } from './store.mjs';

// «Іконкі, логатыпы, банеры, кнопкі, лічыльнікі і ўсё дробнае (меньш за ~150 px
// па большай старане) — не бяром». The saved rule is the exact threshold the
// negative test names: the longest side must be >= 150 px.
export const MIN_CONTENT_IMAGE_PX = 150;

// Dimension probing reads only the container headers — no image is decoded.
// Formats: PNG (IHDR), GIF (logical screen descriptor), JPEG (any SOFn frame
// header). Anything else answers null and the step fails with a diagnostic;
// the real format list widens when the crawler needs it.
export function probeImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10) return null;
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    if (bytes.length < 10) return null;
    return { format: 'gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk the segment chain until a start-of-frame marker carries the
    // dimensions. Standalone markers (D0–D7, 01, D8) carry no length field.
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) return null;
      const marker = bytes[pos + 1];
      // 0xFF fill bytes pad segments before the next marker — each is its own
      // byte, not a marker with a length field.
      if (marker === 0xff) {
        pos += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2;
        continue;
      }
      if (SOF_MARKERS.has(marker)) {
        if (pos + 9 > bytes.length) return null;
        return { format: 'jpeg', height: bytes.readUInt16BE(pos + 5), width: bytes.readUInt16BE(pos + 7) };
      }
      pos += 2 + bytes.readUInt16BE(pos + 2);
    }
    return null;
  }
  return null;
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function imageExtension(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

// «слаг-артыкула-img-01.jpg» — the occurrence index (the image's document
// order on the page) is the number: it is derived from the snapshot alone,
// so a resumed or repeated run computes the same name and never produces
// -img-1-1 duplicates.
export function mediaFileName(slug, occurrence, format) {
  return `${slug}-img-${String(occurrence + 1).padStart(2, '0')}.${imageExtension(format)}`;
}

// text.md is the archive's read text: paragraphs joined by a blank line with
// one trailing newline (extract.mjs). The image block goes before block
// `position` (the media row's own index, clamped into range); an image's
// caption is kept as an emphasis line under the image.
export function buildImageMarkdown(image) {
  const alt = image.alt ?? '';
  const lines = [`![${alt}](media/${image.file})`];
  if (image.caption) lines.push(`_${image.caption}_`);
  return lines.join('\n');
}

export function insertImageMarkdown(snapshotPath, image) {
  const mdPath = path.join(snapshotPath, 'text.md');
  const text = fs.readFileSync(mdPath, 'utf8');
  if (text.includes(`](media/${image.file})`)) return false;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const blocks = body.split('\n\n');
  // `position` indexes the page's paragraph sequence; other steps' image
  // blocks shift the list, so the anchor counts paragraph blocks only —
  // the image lands immediately before paragraph `position` (after the
  // paragraph it appeared in), or after the last one when the page ended.
  let at = blocks.length;
  let seen = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].startsWith('![')) continue;
    if (seen === (image.position ?? blocks.length)) {
      at = i;
      break;
    }
    seen += 1;
  }
  blocks.splice(at, 0, buildImageMarkdown(image));
  fs.writeFileSync(mdPath, `${blocks.join('\n\n')}\n`);
  return true;
}

// The image step: load → probe → size rule → file → media row → markdown.
// Every failure throws a named diagnostic; the run loop records it on the
// step (status 'failed') and the run continues — never a crash.
export function processImageStep(db, { now, loadImage }, step) {
  let descriptor;
  try {
    descriptor = JSON.parse(step.detail);
  } catch {
    throw new Error(`image step ${step.ref}: run_log detail is not an image descriptor`);
  }
  const record = db.prepare('SELECT id, snapshot_path, media_dir, rights FROM raw_records WHERE id = ?').get(
    descriptor.recordId
  );
  if (!record || !record.media_dir || !record.snapshot_path) {
    throw new Error(`image ${descriptor.url}: raw record ${descriptor.recordId} has no snapshot on disk`);
  }
  let bytes;
  try {
    bytes = loadImage(descriptor.url);
  } catch (error) {
    throw new Error(`image ${descriptor.url}: ${error.message}`);
  }
  if (bytes === null) {
    throw new Error(`image ${descriptor.url}: the offline loader serves only file:// sources`);
  }
  const probed = probeImage(bytes);
  if (!probed) {
    throw new Error(`image ${descriptor.url}: unsupported or corrupt image bytes`);
  }
  if (Math.max(probed.width, probed.height) < MIN_CONTENT_IMAGE_PX) {
    return `skipped: ${probed.width}x${probed.height}px is under the ${String(MIN_CONTENT_IMAGE_PX)}px content minimum — ${descriptor.url}`;
  }
  const file = mediaFileName(descriptor.slug, descriptor.occurrence, probed.format);
  fs.writeFileSync(path.join(record.media_dir, file), bytes);
  insertMedia(db, {
    rawRecordId: record.id,
    position: descriptor.position,
    alt: descriptor.alt,
    caption: descriptor.caption,
    sourceUrl: descriptor.url,
    file,
    contentHash: sha256Hex(bytes),
    widthPx: probed.width,
    heightPx: probed.height,
    rights: record.rights,
    collectedAt: now,
  });
  insertImageMarkdown(record.snapshot_path, { ...descriptor, file });
  return `saved ${probed.width}x${probed.height}px as ${file}`;
}
