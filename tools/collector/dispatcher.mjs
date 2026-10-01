// Read-only local dispatcher for the collector (G17.12): one command boots an
// HTTP server on 127.0.0.1 that renders the «Агляд» page for a human editor —
// campaigns with record counts by status, photos, failed steps, and the latest
// run_log steps with their diagnostics —, since G17.13, the «Запісы» page:
// every record of every campaign with its status, rights, photo/link counts
// and URL-carried filters, and, since G17.20, the per-campaign «Як парсіць»
// block: the transport stored with the campaign, with the manual steps a human
// performs themselves under tor. Zero dependencies (node:http + node:sqlite).
// The store is opened with readOnly: true, so no request can write to the
// database even if the code grows one — and nothing on the request path writes
// files: the file routes read below the snapshots root, contained by the repo
// idiom in tools/serve-static.mjs (AR-2). The record card (G17.14,
// /record?id=…) is the editor's reading place for one record: snapshot text
// with images at their positions and captions, the link table, the metadata
// and the record's own journal steps.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveStaticFile } from '../serve-static.mjs';
import { wikiTitleFromUrl } from './wiki.mjs';
import { parseCampaign } from './campaign.mjs';
import { TOR_SOCKS5_PROXY } from './transport.mjs';

export const DEFAULT_PORT = 8767;

const RECENT_STEPS_LIMIT = 10;
const MEDIA_PREFIX = '/media';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.vtt': 'text/vtt; charset=utf-8',
};

// run_log statuses rendered for the editor; unknown statuses fall back to the
// stored value (a future kind must not break the page).
const STEP_STATUS_BE = { pending: 'чакае', running: 'працуе', done: 'гатова', failed: 'упаў' };
const RECORD_STATUS_BE = { raw: 'сыравіна', cleaned: 'ачышчана', used: 'выкарыстана' };
const RECORD_STATUSES = ['raw', 'cleaned', 'used'];
// Display words for the contract vocabularies (07 §rights, raw_records
// source_type): the raw key stays visible in a .key span, so the canonical
// value is never hidden behind a translation.
const SOURCE_TYPE_BE = { news: 'навіны', wiki: 'вікі', web: 'вэб', youtube: 'youtube' };
const RIGHTS_BE = {
  public_domain: 'грамадскі здабытак',
  licensed: 'ліцэнзія',
  research_only: 'толькі даследаванне',
  author_own: 'уласны матэрыял',
};
const RECORD_PARAMS = ['status', 'city'];
// Display words for the campaign transport (docs/24 «Кампанія», G17.20): the
// raw key stays visible in a .key span, so the canonical value is never hidden
// behind a translation.
const TRANSPORT_BE = { direct: 'напрамую', tor: 'праз Tor' };
// The approved SOCKS5 address is part of the transport contract
// (transport.mjs) — the block spells it from there, never from a second copy.
const TOR_SOCKS5_HOST = new URL(TOR_SOCKS5_PROXY).host;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Per-campaign aggregates for the overview: records by status, photos, failed
// steps. Three grouped queries, assembled in JS — the page is read-only and
// small (one-person tool), joins would not make it more readable.
function overviewData(db) {
  if (!db) return { campaigns: [], recentSteps: [] };

  const statusCounts = new Map();
  for (const row of db
    .prepare('SELECT campaign_id, status, COUNT(*) AS n FROM raw_records GROUP BY campaign_id, status')
    .all()) {
    const counts = statusCounts.get(row.campaign_id) ?? {};
    counts[row.status] = Number(row.n);
    statusCounts.set(row.campaign_id, counts);
  }

  const photoCounts = new Map();
  for (const row of db
    .prepare(
      `SELECT r.campaign_id AS campaign_id, COUNT(*) AS n
       FROM media m JOIN raw_records r ON r.id = m.raw_record_id
       GROUP BY r.campaign_id`
    )
    .all()) {
    photoCounts.set(row.campaign_id, Number(row.n));
  }

  const failedCounts = new Map();
  for (const row of db
    .prepare("SELECT campaign_id, COUNT(*) AS n FROM run_log WHERE status = 'failed' GROUP BY campaign_id")
    .all()) {
    failedCounts.set(row.campaign_id, Number(row.n));
  }

  // The transport (G17.19) rides in the row and is the only source for the
  // «Як парсіць» block — never the YAML. A read-only connection cannot run
  // the store's in-place migration, so a store written before the transport
  // column existed falls back to the local default 'direct'.
  const hasTransport = db
    .prepare('PRAGMA table_info(campaigns)')
    .all()
    .some((column) => column.name === 'transport');
  const campaigns = db
    .prepare(
      `SELECT id, city, source_path, created_at${hasTransport ? ', transport' : ''} FROM campaigns ORDER BY created_at, id`
    )
    .all()
    .map((row) => ({
      id: row.id,
      city: row.city,
      sourcePath: row.source_path,
      createdAt: row.created_at,
      transport: (hasTransport ? row.transport : null) ?? 'direct',
      statuses: statusCounts.get(row.id) ?? {},
      photos: photoCounts.get(row.id) ?? 0,
      failed: failedCounts.get(row.id) ?? 0,
    }));

  const recentSteps = db
    .prepare(
      `SELECT l.kind, l.ref, l.status, l.error, l.finished_at, c.city
       FROM run_log l JOIN campaigns c ON c.id = l.campaign_id
       ORDER BY l.id DESC LIMIT ${RECENT_STEPS_LIMIT}`
    )
    .all()
    .map((row) => ({
      kind: row.kind,
      ref: row.ref,
      status: row.status,
      statusBe: STEP_STATUS_BE[row.status] ?? row.status,
      error: row.error,
      finishedAt: row.finished_at,
      city: row.city,
    }));

  return { campaigns, recentSteps };
}

function campaignRowHtml(campaign) {
  const statusCells = RECORD_STATUSES.map(
    (status) =>
      `<td>${campaign.statuses[status] ?? 0} <span class="key">(${escapeHtml(
        RECORD_STATUS_BE[status]
      )})</span></td>`
  ).join('');
  return (
    '<tr>' +
    `<td>${escapeHtml(campaign.city)}</td>` +
    statusCells +
    `<td>${campaign.photos}</td>` +
    `<td>${campaign.failed}</td>` +
    `<td><code>${escapeHtml(campaign.id.slice(0, 12))}</code></td>` +
    '</tr>'
  );
}

// The campaign file is read (never written) only to detect a logged-in browser
// profile — the store does not carry it, and tor + a login profile is the one
// combination the block must warn loudly about (G17.20). An unreadable or
// invalid file answers 'profile unknown': the block keeps rendering, only the
// pointed warning stays out.
function campaignHasLoginProfile(campaign) {
  try {
    const parsed = parseCampaign(fs.readFileSync(campaign.sourcePath, 'utf8'));
    return parsed.ok && parsed.campaign.browser_user_data_dir !== undefined;
  } catch {
    return false;
  }
}

// The per-campaign «Як парсіць» block (G17.20): the transport from the store
// row in human words; under tor the numbered steps the human performs
// themselves — raise the daemon, verify SOCKS5, parse this campaign — plus the
// known risks; under direct the minimal block, the run command only, with no
// Tor mention.
function howToParseHtml(campaign) {
  const title = `<h3>${escapeHtml(campaign.city)} — ${escapeHtml(
    TRANSPORT_BE[campaign.transport] ?? campaign.transport
  )} <span class="key">(${escapeHtml(campaign.transport)})</span></h3>`;
  const runCommand = `node tools/collector/collector.mjs run --campaign ${campaign.sourcePath}`;
  if (campaign.transport !== 'tor') {
    return `${title}\n<p class="text">Запуск гэтай кампаніі: <code>${escapeHtml(runCommand)}</code></p>`;
  }
  const steps = [
    `Падніме tor-дэман у асобным тэрмінале: <code>tor</code>`,
    `Праверце SOCKS5-проксі: <code>curl --socks5-hostname ${TOR_SOCKS5_HOST} https://check.torproject.org/api/ip</code> — адказвае адрас Tor-выходу, не ваш`,
    `Запусціце парсінг гэтай кампаніі: <code>${escapeHtml(runCommand)}</code>`,
  ].map((step) => `<li>${step}</li>`);
  const profileWarning = campaignHasLoginProfile(campaign)
    ? '\n<p class="note">У кампаніі зададзены профіль браўзера (browser_user_data_dir) з сесіяй лагіну — праз Tor гэта дэананімізуе трафік. Не парсіць гэтую кампанію праз Tor з гэтым профілем.</p>'
    : '';
  return (
    `${title}\n` +
    `<p class="text">Збор ідзе праз уласны tor-дэман (SOCKS5 ${TOR_SOCKS5_HOST}) — яго чалавек паддымае сам:</p>\n` +
    `<ol>\n${steps.join('\n')}\n</ol>\n` +
    '<p class="note">Рызыкі: CDN блакуюць Tor-выходы — крокі часцей упадаюць, і серыя памылак спыняе прабег; ' +
    'Tor марудны — загрузка старонкі можа не ўпісацца ў таймаўт 30 с.</p>' +
    profileWarning
  );
}

// One journal row for both readers of run_log — the overview (with the
// campaign's city column) and the record card (the record is known, the column
// would be a constant) — so the two tables never drift apart.
function stepRowHtml(step, { withCity = true } = {}) {
  return (
    '<tr>' +
    `<td>${escapeHtml(step.finishedAt ?? '—')}</td>` +
    (withCity ? `<td>${escapeHtml(step.city)}</td>` : '') +
    `<td><code>${escapeHtml(step.kind)}</code>: ${escapeHtml(step.ref)}</td>` +
    `<td>${escapeHtml(step.statusBe)}</td>` +
    `<td class="diagnostic">${escapeHtml(step.error ?? '—')}</td>` +
    '</tr>'
  );
}

function stepsTableHtml(steps, { withCity, empty }) {
  const head = `<tr><th>Час</th>${withCity ? '<th>Кампанія</th>' : ''}<th>Крок</th><th>Стан</th><th>Дыягностыка</th></tr>`;
  const rows =
    steps.length > 0
      ? steps.map((step) => stepRowHtml(step, { withCity })).join('\n')
      : `<tr><td colspan="${withCity ? 5 : 4}" class="empty">${empty}</td></tr>`;
  return `<table>\n${head}\n${rows}\n</table>`;
}

// The empty-store sentence is shared by the overview and the records list so
// the two pages never drift apart on what a fresh store tells the editor.
const EMPTY_LIBRARY_MESSAGE =
  'Яшчэ нічога не сабрана — запусціце <code>run --campaign &lt;файл&gt;</code>, каб назбіраць запісы.';

// Shared page shell of the dispatcher's read-only pages: the nav lets a human
// walk between the overview and the records list without typing URLs.
function pageShell(active, body) {
  const nav = (href, label, key) => `<a href="${href}"${key === active ? ' class="on"' : ''}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="be">
<head>
<meta charset="utf-8">
<title>Дыспетчар калектара</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #1a1a1a; }
  table { border-collapse: collapse; margin-bottom: 2rem; }
  th, td { border: 1px solid #bbb; padding: 0.35rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.key span, .key { color: #555; }
  td.diagnostic { max-width: 40rem; overflow-wrap: anywhere; }
  td.empty { color: #555; }
  code { overflow-wrap: anywhere; }
  p.nav a, p.filters a { margin-right: 0.75rem; }
  p.nav a.on, p.filters a.on { font-weight: bold; }
  p.note { color: #8a6d3b; background: #fcf8e3; border: 1px solid #faebcc; padding: 0.35rem 0.7rem; }
  p.text { max-width: 46rem; }
  figure { margin: 1rem 0; }
  figure img { max-width: 32rem; height: auto; border: 1px solid #bbb; }
  figcaption { color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Дыспетчар калектара</h1>
<p class="nav">${nav('/', 'Агляд', 'overview')} | ${nav('/records', 'Запісы', 'records')}</p>
${body}
</body>
</html>
`;
}

export function renderOverview({ campaigns, recentSteps }) {
  const campaignRows =
    campaigns.length > 0 ? campaigns.map(campaignRowHtml).join('\n') : `<tr><td colspan="7" class="empty">${EMPTY_LIBRARY_MESSAGE}</td></tr>`;
  const howToParse =
    campaigns.length > 0 ? `\n<h2>Як парсіць</h2>\n${campaigns.map(howToParseHtml).join('\n')}\n` : '';
  return pageShell(
    'overview',
    `<h2>Кампаніі</h2>
<table>
<tr><th>Горад</th><th>Сыравіна (raw)</th><th>Ачышчана (cleaned)</th><th>Выкарыстана (used)</th><th>Фота</th><th>Упалыя крокі</th><th>Кампанія</th></tr>
${campaignRows}
</table>${howToParse}
<h2>Апошнія крокі журналу</h2>
${stepsTableHtml(recentSteps, { withCity: true, empty: 'Журнал пусты.' })}`
  );
}

function notFound(response, why) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(`dispatcher: 404 — ${why}`);
}

// URL filters of the records list: `status` must be a known record status, and
// only the two known parameter names are accepted. Anything else — an unknown
// parameter, an unknown status value — is answered with a readable note and
// the unfiltered list, never a 500. An empty value is no filter.
function parseRecordFilters(query) {
  const notes = [];
  const unknown = [...new Set(query.keys())].filter((key) => !RECORD_PARAMS.includes(key));
  if (unknown.length > 0) {
    notes.push(
      `Невядомы параметр ${unknown.map((key) => `«${key}»`).join(', ')} — ігнаруецца; вядомыя: ${RECORD_PARAMS.join(', ')}.`
    );
  }
  let status = query.get('status') || undefined;
  if (status && !RECORD_STATUSES.includes(status)) {
    notes.push(`Невядомы статус «${status}» — вядомыя: ${RECORD_STATUSES.join(', ')}; фільтр статусу не прыменены.`);
    status = undefined;
  }
  return { status, city: query.get('city') || undefined, notes };
}

// The «Запісы» data: every record of every campaign. A record's city is its
// campaign's city, so the city filter is the axis that separates campaigns
// here — the same one the CLI's search offers. Photo and link counts ride in
// the same query as scalar subqueries; the title comes from the search index's
// row for the latest cleaned document — the index cannot be re-synced from
// this connection (read-only), so a record without one falls back to its URL,
// like the CLI's search output does.
function recordsData(db, query) {
  const filters = parseRecordFilters(query);
  if (!db) return { ...filters, records: [], cities: [] };
  const where = [];
  const params = [];
  if (filters.status) {
    where.push('r.status = ?');
    params.push(filters.status);
  }
  if (filters.city) {
    where.push('r.city = ?');
    params.push(filters.city);
  }
  const records = db
    .prepare(
      `SELECT r.id, r.source_type, r.url, r.collected_at, r.city, r.status, r.rights, f.title,
              (SELECT COUNT(*) FROM media m WHERE m.raw_record_id = r.id) AS photos,
              (SELECT COUNT(*) FROM links l WHERE l.raw_record_id = r.id) AS links
       FROM raw_records r
       LEFT JOIN cleaned_fts f ON f.raw_record_id = r.id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.collected_at DESC, r.url, r.id`
    )
    .all(...params)
    .map((row) => ({
      ...row,
      statusBe: RECORD_STATUS_BE[row.status] ?? row.status,
      sourceBe: SOURCE_TYPE_BE[row.source_type] ?? row.source_type,
      rightsBe: RIGHTS_BE[row.rights] ?? row.rights,
    }));
  const cities = db
    .prepare('SELECT DISTINCT city FROM raw_records ORDER BY city')
    .all()
    .map((row) => row.city);
  return { ...filters, records, cities };
}

// Every choice in the filter bar is a plain GET link carrying the full filter
// state, so the address bar always holds a shareable view a colleague can open
// as-is (сяброўскія спасылкі).
function filterLink(label, target, active) {
  return `<a href="${escapeHtml(target)}"${active ? ' class="on"' : ''}>${escapeHtml(label)}</a>`;
}

function recordsFilterBar({ status, city, cities }) {
  const target = (next) => {
    const params = new URLSearchParams();
    if (next.status) params.set('status', next.status);
    if (next.city) params.set('city', next.city);
    const qs = params.toString();
    return qs ? `/records?${qs}` : '/records';
  };
  const statusLinks = [
    filterLink('усе', target({ city }), !status),
    ...RECORD_STATUSES.map((value) =>
      filterLink(`${RECORD_STATUS_BE[value]} (${value})`, target({ status: value, city }), status === value)
    ),
  ];
  const cityLinks = [
    filterLink('усе', target({ status }), !city),
    ...cities.map((value) => filterLink(value, target({ status, city: value }), city === value)),
  ];
  return `<p class="filters">Статус: ${statusLinks.join(' | ')}</p>\n<p class="filters">Горад: ${cityLinks.join(' | ')}</p>`;
}

function recordRowHtml(record) {
  const title = record.title ?? record.url;
  return (
    '<tr>' +
    `<td><a href="/record?id=${encodeURIComponent(record.id)}">${escapeHtml(title)}</a></td>` +
    `<td>${escapeHtml(record.sourceBe)} <span class="key">(${escapeHtml(record.source_type)})</span></td>` +
    `<td>${escapeHtml(record.statusBe)} <span class="key">(${escapeHtml(record.status)})</span></td>` +
    `<td>${escapeHtml(record.rightsBe)} <span class="key">(${escapeHtml(record.rights)})</span></td>` +
    `<td>${escapeHtml(record.city)}</td>` +
    `<td>${escapeHtml(record.collected_at ?? '—')}</td>` +
    `<td>${record.photos}</td>` +
    `<td>${record.links}</td>` +
    '</tr>'
  );
}

// Readable notes (unknown parameters, missing files) render the same on every
// read-only page.
function notesHtml(notes) {
  return notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join('\n');
}

export function renderRecords({ records, cities, status, city, notes }) {
  const noteHtml = notesHtml(notes);
  const rows =
    records.length > 0
      ? records.map(recordRowHtml).join('\n')
      : `<tr><td colspan="8" class="empty">${status || city ? 'Па гэтым фільтры запісаў няма.' : EMPTY_LIBRARY_MESSAGE}</td></tr>`;
  return pageShell(
    'records',
    `${noteHtml}
<h2>Запісы</h2>
${recordsFilterBar({ status, city, cities })}
<table>
<tr><th>Назва</th><th>Крыніца</th><th>Статус</th><th>Правы</th><th>Горад</th><th>Дата збору</th><th>Фота</th><th>Спасылкі</th></tr>
${rows}
</table>`
  );
}

// --- Картка запіса (G17.14, /record?id=…) ---

const CARD_PARAMS = ['id'];

function parseCardParams(query) {
  const unknown = [...new Set(query.keys())].filter((key) => !CARD_PARAMS.includes(key));
  const notes = unknown.map((key) => `Невядомы параметр «${key}» — ігнаруецца; вядомы: id.`);
  return { id: query.get('id') || undefined, notes };
}

// The record's steps: only the run_log rows whose ref carries this record —
// the seed/crawl step by its url, the image/clean steps by their
// `recordId:`-prefixed refs, and — scoped to the source type that step kind
// produces — the youtube step by the video id inside the record's url and the
// wiki-article step by the title the /wiki/ url maps back to. A web record
// whose url merely looks like either (watch?v=, /wiki/…) stays with its own
// steps. Every other journal row belongs to the campaign, not to this record.
function recordSteps(db, record) {
  const refs = [record.url];
  if (record.source_type === 'youtube') {
    try {
      const videoId = new URL(record.url).searchParams.get('v');
      if (videoId) refs.push(videoId);
    } catch {
      // Unparseable url: the literal and prefix matches still apply.
    }
  }
  if (record.source_type === 'wiki') {
    const wikiTitle = wikiTitleFromUrl(record.url);
    if (wikiTitle) refs.push(wikiTitle);
  }
  return db
    .prepare(
      `SELECT kind, ref, status, error, finished_at FROM run_log
       WHERE campaign_id = ? AND (ref IN (${refs.map(() => '?').join(', ')}) OR ref LIKE ?)
       ORDER BY id`
    )
    .all(record.campaign_id, ...refs, `${record.id}:%`)
    .map((row) => ({
      kind: row.kind,
      ref: row.ref,
      status: row.status,
      statusBe: STEP_STATUS_BE[row.status] ?? row.status,
      error: row.error,
      finishedAt: row.finished_at,
    }));
}

// An anchor renders clickable only for schemes a browser may follow from a
// local page; anything else — and unparseable input — stays plain text: the
// card is a reading place, not a launcher.
function clickableUrl(url) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

// The archive text.md's image form: `![alt](media/file)` written by the media
// steps (media.mjs), with the caption as an emphasis line under it. The file
// name is our own slug charset; anything else never becomes a path or a URL.
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const CAPTION_LINE = /^_(.+)_$/;
const MEDIA_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function paragraphHtml(block) {
  const escaped = escapeHtml(block);
  // The block is escaped first, so both the link text and the href are safe as
  // rendered; an anchor whose href survives as-is is exactly that, escaped.
  const html = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (link, text, href) =>
    clickableUrl(href) === null ? link : `<a href="${href}">${text}</a>`
  );
  return `<p class="text">${html}</p>`;
}

function figureHtml(block, snapshotDir, mediaBase) {
  const lines = block.split('\n');
  const match = lines[0].match(IMAGE_LINE);
  if (!match) return null;
  const [, alt, ref] = match;
  const file = ref.startsWith('media/') ? ref.slice('media/'.length) : null;
  const caption = lines
    .slice(1)
    .map((line) => line.match(CAPTION_LINE)?.[1] ?? null)
    .filter((line) => line !== null)
    .join(' ');
  if (file === null || !MEDIA_FILE.test(file)) {
    return `<p class="note">Нераспазнаная спасылка на выяву: <code>${escapeHtml(ref)}</code>.</p>`;
  }
  if (mediaBase === null) {
    return `<p class="note">Снапшот па-за тэчкай даных — выяву паказаць нельга: <code>media/${escapeHtml(file)}</code>.</p>`;
  }
  let present = false;
  try {
    present = fs.statSync(path.join(snapshotDir, 'media', file)).isFile();
  } catch {
    present = false;
  }
  if (!present) {
    return `<p class="note">Выява адсутнічае на дыску: <code>media/${escapeHtml(file)}</code>${
      caption ? ` — подпіс: ${escapeHtml(caption)}` : ''
    }.</p>`;
  }
  return (
    '<figure>' +
    `<img src="/media/${mediaBase}/media/${encodeURIComponent(file)}" alt="${escapeHtml(alt)}">` +
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '') +
    '</figure>'
  );
}

// The snapshot text rendered block by block — the raw archive, not the cleaned
// versions (those are separate artifacts for guide assembly). An article
// snapshot keeps text.md, a youtube one transcript.md; a missing text is a
// note, the rest of the card still shows.
function textHtml(snapshotDir, mediaBase) {
  if (snapshotDir === null) {
    return '<p class="note">Здымак не запісаны — тэксту здымку няма.</p>';
  }
  let text = null;
  for (const name of ['text.md', 'transcript.md']) {
    try {
      text = fs.readFileSync(path.join(snapshotDir, name), 'utf8');
      break;
    } catch {
      // Try the next text form; the note below names both.
    }
  }
  if (text === null) {
    return `<p class="note">Тэкст здымку не прачытаны: няма ні <code>text.md</code>, ні <code>transcript.md</code> у <code>${escapeHtml(
      snapshotDir
    )}</code>.</p>`;
  }
  const blocks = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n\n').filter((block) => block !== '');
  if (blocks.length === 0) return '<p class="note">Тэкст здымку пусты.</p>';
  return blocks
    .map((block) =>
      block.startsWith('![') ? (figureHtml(block, snapshotDir, mediaBase) ?? paragraphHtml(block)) : paragraphHtml(block)
    )
    .join('\n');
}

// The snapshot dir's path below the snapshots root, as the /media route
// addresses it. A snapshot_path that leaves the root (a corrupt row) answers
// null — images render as notes, the page stays up.
function mediaUrlBase(snapshotsRoot, snapshotDir) {
  const rel = path.relative(snapshotsRoot, snapshotDir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).map(encodeURIComponent).join('/');
}

// The metadata block: the passport columns (source, collected date, rights)
// plus what metadata.json carries — publication date, author, language and,
// when the snapshot has one, the wiki attribution. Everything optional renders
// only when present («калі ёсць»).
function metadataRowsHtml(record, metadata) {
  const row = (label, value) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const url = clickableUrl(record.url);
  const rows = [
    row(
      'Крыніца',
      url ? `<a href="${escapeHtml(url)}">${escapeHtml(record.url)}</a>` : `<code>${escapeHtml(record.url)}</code>`
    ),
  ];
  if (record.canonical_url && record.canonical_url !== record.url) {
    rows.push(row('Кананічны адрас', `<code>${escapeHtml(record.canonical_url)}</code>`));
  }
  rows.push(row('Дата збору', escapeHtml(record.collected_at ?? '—')));
  const published = metadata?.published_at ?? metadata?.upload_date ?? null;
  if (published) rows.push(row('Дата публікацыі', escapeHtml(String(published))));
  const author = metadata?.author ?? metadata?.channel ?? null;
  if (author) rows.push(row('Аўтар', escapeHtml(String(author))));
  if (metadata?.language) rows.push(row('Мова', escapeHtml(String(metadata.language))));
  rows.push(
    row(
      'Правы',
      `${escapeHtml(RIGHTS_BE[record.rights] ?? record.rights)} <span class="key">(${escapeHtml(record.rights)})</span>`
    )
  );
  const attribution = metadata?.attribution;
  if (attribution) {
    const parts = [attribution.site, attribution.license].filter(Boolean).map((part) => escapeHtml(String(part)));
    const revision = attribution.revision_id ? `, рэвізія ${escapeHtml(String(attribution.revision_id))}` : '';
    const contributors = attribution.contributors_url
      ? clickableUrl(String(attribution.contributors_url))
      : null;
    const history = attribution.contributors_url
      ? contributors
        ? ` — <a href="${escapeHtml(contributors)}">гісторыя рэвізій</a>`
        : ` — <code>${escapeHtml(String(attribution.contributors_url))}</code>`
      : '';
    rows.push(row('Атрыбуцыя', `${parts.join(', ')}${revision}${history}`));
  }
  return `<table>\n${rows.join('\n')}\n</table>`;
}

function linksTableHtml(links) {
  const rows = links.map((link) => {
    const url = clickableUrl(link.url);
    const urlCell = url
      ? `<a href="${escapeHtml(url)}">${escapeHtml(link.url)}</a>`
      : `<code>${escapeHtml(link.url)}</code>`;
    return `<tr><td>${escapeHtml(link.anchor_text)}</td><td>${urlCell}</td><td class="diagnostic">${escapeHtml(
      link.context ?? '—'
    )}</td></tr>`;
  });
  const body =
    links.length > 0
      ? rows.join('\n')
      : '<tr><td colspan="3" class="empty">Спасылак у запіса няма.</td></tr>';
  return `<table>\n<tr><th>Анкер</th><th>Адрас</th><th>Кантэкст абзаца</th></tr>\n${body}\n</table>`;
}

// The card's data: the passport row with the search-index title, the snapshot
// files read from disk (metadata may be unreadable — a note, not an error),
// the record's links and its journal steps.
function recordData(db, snapshotsRoot, query) {
  const { id, notes } = parseCardParams(query);
  if (!db || !id) return { kind: 'missing-record', id, notes };
  const record = db
    .prepare(
      `SELECT r.*, f.title AS fts_title FROM raw_records r
       LEFT JOIN cleaned_fts f ON f.raw_record_id = r.id WHERE r.id = ?`
    )
    .get(id);
  if (!record) return { kind: 'missing-record', id, notes };
  const snapshotDir = record.snapshot_path ?? null;
  const mediaBase = snapshotDir ? mediaUrlBase(snapshotsRoot, snapshotDir) : null;
  let metadata = null;
  let metadataNote = null;
  if (snapshotDir) {
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'metadata.json'), 'utf8'));
    } catch {
      metadataNote = `<p class="note">Метаданыя здымку не прачытаны: няма ці пашкоджаны <code>metadata.json</code> у <code>${escapeHtml(
        snapshotDir
      )}</code>.</p>`;
    }
  }
  const links = db
    .prepare('SELECT anchor_text, url, context FROM links WHERE raw_record_id = ? ORDER BY id')
    .all(record.id);
  return { kind: 'record', notes, record, snapshotDir, mediaBase, metadata, metadataNote, links, steps: recordSteps(db, record) };
}

export function renderRecordCard(data) {
  if (data.kind === 'missing-record') {
    const reason = data.id
      ? `Запіс <code>${escapeHtml(data.id)}</code> у сховішчы не знойдзены.`
      : 'Картка запіса патрабуе параметр <code>id</code>.';
    return {
      status: 404,
      body: pageShell('records', `${notesHtml(data.notes)}\n<p class="note">${reason}</p>`),
    };
  }
  const { record, metadata } = data;
  const title = record.fts_title ?? metadata?.title ?? record.url;
  const body = `
<h2>${escapeHtml(String(title))}</h2>
${notesHtml(data.notes)}
<h3>Метаданыя</h3>
${metadataRowsHtml(record, metadata)}
${data.metadataNote ?? ''}
<h3>Тэкст запіса</h3>
${textHtml(data.snapshotDir, data.mediaBase)}
<h3>Спасылкі</h3>
${linksTableHtml(data.links)}
<h3>Журнал крокаў</h3>
${stepsTableHtml(data.steps, { withCity: false, empty: 'Крокаў для гэтага запіса ў журнале няма.' })}`;
  return { status: 200, body: pageShell('records', body) };
}

// The one file route: reads below the snapshots root only. resolveStaticFile
// (tools/serve-static.mjs, AR-2) decodes the URL and re-normalizes against the
// root with the platform separator — anything that escapes comes back null.
async function serveDataFile(snapshotsRoot, pathname, response) {
  let file;
  try {
    file = resolveStaticFile(snapshotsRoot, pathname.slice(MEDIA_PREFIX.length));
  } catch {
    // Corrupt percent-encoding in the URL (e.g. /media/%zz) — same verdict as
    // the sibling createStaticServer: a 404, never a thrown URIError.
    notFound(response, 'невядомы адрас');
    return;
  }
  if (file === null) {
    notFound(response, 'шлях выйшаў за межы тэчкі даных');
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
  } catch {
    notFound(response, 'файла няма');
    return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' });
  response.end(await readFile(file));
}

async function handleRequest(db, snapshotsRoot, request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET') {
    response.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
    response.end('dispatcher: 405 — сервер толькі чытэльны');
    return;
  }
  if (url.pathname === '/') {
    // The body is computed before any header is written: a store that exists
    // but cannot be queried (a zero-byte file, a foreign schema) must reach
    // the 500 path below as a readable diagnostic, not hang the response.
    const body = renderOverview(overviewData(db));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
    return;
  }
  if (url.pathname === '/records') {
    // Same body-before-head order as the overview.
    const body = renderRecords(recordsData(db, url.searchParams));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
    return;
  }
  if (url.pathname === '/record') {
    // Same body-before-head order as the other pages.
    const card = renderRecordCard(recordData(db, snapshotsRoot, url.searchParams));
    response.writeHead(card.status, { 'content-type': 'text/html; charset=utf-8' });
    response.end(card.body);
    return;
  }
  if (url.pathname === MEDIA_PREFIX || url.pathname.startsWith(`${MEDIA_PREFIX}/`)) {
    await serveDataFile(snapshotsRoot, url.pathname, response);
    return;
  }
  notFound(response, 'невядомы адрас');
}

// Opens the store read-only; a missing database file is the tool's natural
// empty state (nothing collected yet), a file that exists but cannot be opened
// is fatal — the CLI answers with its exit-2 diagnostic (README: непрыдатны
// --db — дыягностыка з кодам 2 для любой каманды).
function openReadOnlyOrThrow(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw new Error(`cannot open database ${dbPath}: ${error.message}`);
  }
}

// Resolves once the server listens; rejects with a named diagnostic when the
// port is taken (the busy port is a readable situation, not a crash). The
// caller keeps the returned handle to close the server (the CLI process stays
// alive on the listening handle).
export async function startDispatcher({ dbPath, snapshotsRoot, port = DEFAULT_PORT, host = '127.0.0.1' }) {
  const db = openReadOnlyOrThrow(dbPath);
  const root = path.resolve(snapshotsRoot);
  const server = createServer((request, response) => {
    handleRequest(db, root, request, response).catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(`dispatcher: ${error.message}`);
      } else {
        response.destroy(error);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`port ${port} is already in use — choose another with --port`)
          : error
      );
    });
    server.listen(port, host, resolve);
  });
  return {
    port: server.address().port,
    address: server.address().address,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (db) db.close();
      }),
  };
}
