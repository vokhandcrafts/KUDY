// Arrange-only helpers for the collector suites. Tests always reach the
// production entrypoints (parseCampaign / openStore / runCampaign / the CLI);
// these helpers only build fixtures and temporary locations.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'collector-test-'));
}

export function writeCampaignFile(dir, text, name = 'campaign.yaml') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

// Builds a campaign YAML from raw per-field overrides, so a negative fixture
// differs from the valid one in exactly one declared place. `null` omits the
// line (missing-city case); a string replaces the field's YAML verbatim.
export function campaignYaml(overrides = {}) {
  const fields = {
    city: 'city: gdansk',
    seeds: 'seeds:\n  - https://news.example/gdansk',
    topics: 'topics: [history]',
    fence: 'fence:',
    depth: 'depth: 3',
    extra_domains: 'extra_domains: []',
    delay_s: 'delay_s: [2, 5]',
    youtube: 'youtube:\n  - dQw4w9WgXcQ',
    // G17.04 wiki block: omitted by default (null), so the existing suites'
    // step counts stay untouched; wiki suites pass their YAML verbatim.
    wiki: null,
    ...overrides,
  };
  const lines = [fields.city, fields.seeds, fields.topics];
  if (fields.fence !== null) {
    lines.push(fields.fence);
    for (const key of ['depth', 'extra_domains', 'delay_s']) {
      if (fields[key] !== null) lines.push(`  ${fields[key]}`);
    }
  }
  lines.push(fields.youtube);
  if (fields.wiki !== null) lines.push(fields.wiki);
  return lines.filter((line) => line !== null).join('\n') + '\n';
}

export function rawRecord({ campaignId = 'c1', url = 'https://news.example/article', ...rest } = {}) {
  return {
    id: randomUUID(),
    campaign_id: campaignId,
    source_type: 'news',
    url,
    canonical_url: url,
    collected_at: '2026-09-23T00:00:00.000Z',
    city: 'gdansk',
    topics: JSON.stringify(['history']),
    rights: 'research_only',
    content_hash: null,
    status: 'raw',
    snapshot_path: null,
    media_dir: null,
    ...rest,
  };
}

// Arranges the campaign row a raw_records FK expects. Tests that exercise
// record storage directly (not via runCampaign) call this first.
export function seedCampaign(db, id = 'c1') {
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at)
     VALUES (?, 'gdansk', 'campaign.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')`
  ).run(id);
}

// Fixture page builder for the snapshot suites (G17.01.b): every named field
// is optional and each corrupt variant differs from the valid page in exactly
// one declared place (implementation-rules 14). Default body: three
// paragraphs — an absolute anchor, a relative plus an absolute anchor, and a
// plain one.
export const ARTICLE_BODY = [
  '<p>The <a href="https://gdansk.example/history">shipyard history</a> began in 1844.</p>',
  '<p>Read the <a href="../museum/main-hall.html">main hall guide</a> and the <a href="https://gdansk.example/cranes">crane list</a>.</p>',
  '<p>No links in this paragraph at all.</p>',
];

export function articleHtml({
  title = 'Gdansk shipyard turns into a museum',
  lang = 'en',
  body = ARTICLE_BODY,
  author = 'Jan Kowalski',
  published = '2026-09-20',
  canonical = null,
} = {}) {
  const head = [
    ...(title === null ? [] : [`  <title>${title}</title>`]),
    `  <meta name="author" content="${author}">`,
    `  <meta property="article:published_time" content="${published}">`,
    ...(canonical ? [`  <link rel="canonical" href="${canonical}">`] : []),
  ];
  return [
    '<!DOCTYPE html>',
    `<html lang="${lang}">`,
    '<head>',
    ...head,
    '</head>',
    '<body>',
    ...body.map((paragraph) => `  ${paragraph}`),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Minimal container headers with exact pixel dimensions — the media probe
// reads only these bytes, so no real image data is needed. G17.03 fixtures.
export function pngBytes(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8; // bit depth
  return bytes;
}

export function gifBytes(width, height) {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

export function jpegBytes(width, height) {
  const bytes = Buffer.alloc(25);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0; // SOF0: baseline frame header carries the dimensions
  bytes.writeUInt16BE(17, 4); // segment length
  bytes[6] = 8; // precision
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[11] = 0xff;
  bytes[12] = 0xd9;
  return bytes;
}
