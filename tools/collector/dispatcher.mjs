// Read-only local dispatcher for the collector (G17.12): one command boots an
// HTTP server on 127.0.0.1 that renders the «Агляд» page for a human editor —
// campaigns with record counts by status, photos, failed steps, and the latest
// run_log steps with their diagnostics. Zero dependencies (node:http +
// node:sqlite). The store is opened with readOnly: true, so no request can
// write to the database even if the code grows one — and nothing on the
// request path writes files: the only file route reads below the snapshots
// root, contained by the repo idiom in tools/serve-static.mjs (AR-2).
// The record list and record card pages are neighbouring tasks (05–06 of the
// dispatcher series); this file is their shared server skeleton.
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

export function renderOverview({ campaigns, recentSteps }) {
  const campaignRows =
    campaigns.length > 0
      ? campaigns.map(campaignRowHtml).join('\n')
      : '<tr><td colspan="7" class="empty">Яшчэ нічога не сабрана — запусціце <code>run --campaign &lt;файл&gt;</code>, каб назбіраць запісы.</td></tr>';
  const stepRows =
    recentSteps.length > 0
      ? recentSteps.map(stepRowHtml).join('\n')
      : '<tr><td colspan="5" class="empty">Журнал пусты.</td></tr>';
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
</style>
</head>
<body>
<h1>Дыспетчар калектара</h1>
<h2>Кампаніі</h2>
<table>
<tr><th>Горад</th><th>Сыравіна (raw)</th><th>Ачышчана (cleaned)</th><th>Выкарыстана (used)</th><th>Фота</th><th>Упалыя крокі</th><th>Кампанія</th></tr>
${campaignRows}
</table>
<h2>Апошнія крокі журналу</h2>
<table>
<tr><th>Час</th><th>Кампанія</th><th>Крок</th><th>Стан</th><th>Дыягностыка</th></tr>
${stepRows}
</table>
</body>
</html>
`;
}

function notFound(response, why) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(`dispatcher: 404 — ${why}`);
}

// The one file route: reads below the snapshots root only. resolveStaticFile
// (tools/serve-static.mjs, AR-2) decodes the URL and re-normalizes against the
// root with the platform separator — anything that escapes comes back null.
async function serveDataFile(snapshotsRoot, pathname, response) {
  const file = resolveStaticFile(snapshotsRoot, pathname.slice(MEDIA_PREFIX.length));
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
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderOverview(overviewData(db)));
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
