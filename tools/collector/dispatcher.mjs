// Read-only local dispatcher for the collector (G17.12): one command boots an
// HTTP server on 127.0.0.1 that renders the «Агляд» page for a human editor —
// campaigns with record counts by status, photos, failed steps, and the latest
// run_log steps with their diagnostics — and, since G17.13, the «Запісы» page:
// every record of every campaign with its status, rights, photo/link counts
// and URL-carried filters. Zero dependencies (node:http + node:sqlite). The
// store is opened with readOnly: true, so no request can write to the database
// even if the code grows one — and nothing on the request path writes files:
// the only file route reads below the snapshots root, contained by the repo
// idiom in tools/serve-static.mjs (AR-2). The record card page is the
// neighbouring task 06 of the dispatcher series.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveStaticFile } from '../serve-static.mjs';

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

  const campaigns = db
    .prepare('SELECT id, city, source_path, created_at FROM campaigns ORDER BY created_at, id')
    .all()
    .map((row) => ({
      id: row.id,
      city: row.city,
      sourcePath: row.source_path,
      createdAt: row.created_at,
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

function stepRowHtml(step) {
  return (
    '<tr>' +
    `<td>${escapeHtml(step.finishedAt ?? '—')}</td>` +
    `<td>${escapeHtml(step.city)}</td>` +
    `<td><code>${escapeHtml(step.kind)}</code>: ${escapeHtml(step.ref)}</td>` +
    `<td>${escapeHtml(step.statusBe)}</td>` +
    `<td class="diagnostic">${escapeHtml(step.error ?? '—')}</td>` +
    '</tr>'
  );
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
  const stepRows =
    recentSteps.length > 0
      ? recentSteps.map(stepRowHtml).join('\n')
      : '<tr><td colspan="5" class="empty">Журнал пусты.</td></tr>';
  return pageShell(
    'overview',
    `<h2>Кампаніі</h2>
<table>
<tr><th>Горад</th><th>Сыравіна (raw)</th><th>Ачышчана (cleaned)</th><th>Выкарыстана (used)</th><th>Фота</th><th>Упалыя крокі</th><th>Кампанія</th></tr>
${campaignRows}
</table>
<h2>Апошнія крокі журналу</h2>
<table>
<tr><th>Час</th><th>Кампанія</th><th>Крок</th><th>Стан</th><th>Дыягностыка</th></tr>
${stepRows}
</table>`
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

export function renderRecords({ records, cities, status, city, notes }) {
  const noteHtml = notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join('\n');
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
