// Arrange-only helpers for the collector suites. Tests always reach the
// production entrypoints (parseCampaign / openStore / runCampaign / the CLI);
// these helpers only build fixtures and temporary locations.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseCampaign } from './campaign.mjs';
import { openStore } from './store.mjs';

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
    youtube: 'youtube: []',
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

// Filler paragraphs padding a fixture page past the article heuristic's
// minimum (crawler and CLI suites).
const FILLERS = [
  '<p>First filler paragraph with plain text.</p>',
  '<p>Second filler paragraph with plain text.</p>',
  '<p>Third filler paragraph with plain text.</p>',
];

// An article-shaped fixture page: every link gets its own paragraph, padded
// past the article heuristic's minimum so classification never misfires.
export function articlePage(title, hrefs = []) {
  return articleHtml({
    title,
    body: [...hrefs.map(([href, text]) => `<p>Read the <a href="${href}">${text}</a> page.</p>`), ...FILLERS],
  });
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

// Local fixture HTTP server for the crawler suites (G17.02): the tests' only
// network is 127.0.0.1. `routes` maps request path → { status, headers, body }
// (or a plain string body); an unknown path answers a plain 404 page. The
// `requests` log records { path, at } arrival moments — the politeness test
// asserts the gaps between them. The campaign fence sees the server's
// hostname, so a second server on another port of the same host is the same
// fence host.
export async function startFixtureServer(routes = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, at: Date.now() });
    const route = routes[req.url];
    const { status = 200, headers = {}, body = '' } =
      typeof route === 'string' ? { body: route } : (route ?? { status: 404, body: '<html><head><title>404</title></head><body>not found</body></html>' });
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: (pathName) => `http://127.0.0.1:${port}${pathName}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// The crawl suites' injected fetchPage: a plain GET over the global fetch,
// following redirects exactly like the browser fetcher does (finalUrl is the
// last response's URL). HTTP ≥ 400 rejects — a fetch failure for the error
// series. This is the test-side stand-in for netfetch.mjs, not the production
// path; every crawler suite drives the production pipeline through it.
export async function httpFetchPage(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url };
}

// Skip guard for suites that drive real chromium (the netfetch live suite,
// the CLI run test): CI installs the playwright npm package but not the
// browser binary (implementation-rules 7). Returns true when the test may
// proceed; otherwise the test is skipped with a visible reason.
export async function skipWithoutBrowser(t) {
  let executable;
  try {
    const { chromium } = await import('playwright');
    executable = chromium.executablePath();
  } catch {
    t.skip('playwright is not installed — run: npx playwright install chromium');
    return false;
  }
  if (!fs.existsSync(executable)) {
    t.skip(`chromium binary is not installed (${executable}) — run: npx playwright install chromium`);
    return false;
  }
  return true;
}

// Bundled subtitle fixtures for the YouTube suites (G17.05): no network — the
// stub yt-dlp command serves them to the production spawn/parse pipeline.
export function openCampaignFixture(dir, yamlText) {
  const file = writeCampaignFile(dir, yamlText);
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseCampaign(source);
  if (!parsed.ok) throw new Error(`fixture campaign invalid: ${parsed.diagnostics.join('; ')}`);
  const db = openStore(path.join(dir, 'db.sqlite'));
  return { file, source, parsed, db };
}

export const MANUAL_VTT = [
  'WEBVTT',
  '',
  '1',
  '00:00:01.000 --> 00:00:04.500',
  'Witajcie w Gdańsku.',
  '',
  '2',
  '00:00:05.000 --> 00:00:09.250',
  'Stocznia <c>Gdańska</c> zaczęła',
  'strajk w sierpniu 1980.',
  '',
  '3',
  '00:00:10.000 --> 00:00:14.000',
  'To początek Solidarności.',
  '',
].join('\n') + '\n';

export const AUTO_VTT = [
  'WEBVTT',
  '',
  '00:00:02.000 --> 00:00:05.000',
  'witajcie w  gdansku',
  '',
  '00:00:06.000 --> 00:00:08.000',
  'witajcie w  gdansku',
  '',
  '00:00:09.000 --> 00:00:12.500',
  'stocznia zaczela strajk',
  '',
].join('\n') + '\n';

// Default fixture video info: manual English subtitles + automatic ones + a
// cover URL (tests point it at the local fixture server).
export function youtubeInfo({ id = 'dQw4w9WgXcQ', thumbnail = null, subtitles = null, automatic = null } = {}) {
  return {
    id,
    title: 'Gdansk shipyard — the August story',
    channel: 'History of the Coast',
    uploader: 'History of the Coast',
    upload_date: '20240815',
    duration: 217.4,
    language: 'en',
    thumbnail,
    subtitles: subtitles === null ? { en: [{ ext: 'vtt', url: 'https://example/sub.en.vtt' }] } : subtitles,
    automatic_captions:
      automatic === null ? { en: [{ ext: 'vtt', url: 'https://example/auto.en.vtt' }] } : automatic,
  };
}

// A deterministic in-process youtubeFetch for loop-mechanics suites: every
// video lands in asr-backlog (the step completes with a note, the shell row
// stays empty) — no spawn, no network, no snapshot files. The full pipeline
// (real spawn path, VTT fixtures, covers) is exercised by youtube.test.mjs.
export function youtubeBacklogFetch() {
  return async ({ videoId }) => ({ info: { id: videoId }, selected: null, cover: null });
}

// A stub yt-dlp command for the suites: phase 1 (--dump-json) prints the
// fixture JSON, phase 2 (-o template + --sub-langs) writes the fixture VTT for
// the requested language. The pipeline under test spawns it exactly like the
// real binary; the command is [node, stubPath] — cross-platform, no chmod.
// `playlist` maps video id → { info, vtt: { en: text, ... } } so one stub
// serves several videos of a campaign.
export function writeYtDlpStub(dir, playlist) {
  const stubPath = path.join(dir, 'yt-dlp-stub.mjs');
  fs.writeFileSync(
    stubPath,
    `import fs from 'node:fs';
const args = process.argv.slice(2);
const playlist = ${JSON.stringify(playlist)};
const id = args.find((a) => a.includes('watch?v=')).split('watch?v=')[1];
const entry = playlist[id];
if (!entry) { console.error('stub: no fixture for ' + id); process.exit(1); }
const outIdx = args.indexOf('-o');
if (outIdx === -1) {
  console.log(JSON.stringify(entry.info));
  process.exit(0);
}
const lang = args[args.indexOf('--sub-langs') + 1];
const vtt = entry.vtt[lang];
if (!vtt) { console.error('stub: no vtt for ' + id + '/' + lang); process.exit(1); }
fs.writeFileSync(args[outIdx + 1] + '.' + lang + '.vtt', vtt);
`
  );
  return [process.execPath, stubPath];
}
