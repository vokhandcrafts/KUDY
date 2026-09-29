// Dispatcher suite (G17.12): the read-only local page over the store. The
// fixture database is built through the production store functions, then
// closed; the suite boots the real dispatcher on an ephemeral port and fetches
// the pages — no route is stubbed (implementation-rules 15). Assertions are on
// rendered content, so reverting the feature turns the suite red.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  completeStep,
  claimStep,
  enqueueStep,
  failStep,
  insertMedia,
  openStore,
  sha256Hex,
  upsertRawRecord,
} from './store.mjs';
import { DEFAULT_PORT, startDispatcher } from './dispatcher.mjs';
import { makeTempDir, pngBytes, rawRecord, seedCampaign } from './testkit.mjs';

const cliPath = fileURLToPath(new URL('./collector.mjs', import.meta.url));

// A raw-path GET: unlike fetch/URL, node:http sends the path verbatim, so the
// traversal suite exercises the server's own URL handling, not the client's
// dot-segment normalization.
function rawRequest(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
      );
    });
    request.on('error', reject);
    request.end();
  });
}

async function get(dispatcher, requestPath) {
  const response = await fetch(`http://127.0.0.1:${dispatcher.port}${requestPath}`);
  return { status: response.status, body: await response.text(), type: response.headers.get('content-type') };
}

// Two campaigns with records in every status, a photo, a failed crawl step and
// a failed youtube step — everything the overview page claims to show.
function buildStoreFixture(dir) {
  const dbPath = path.join(dir, 'db.sqlite');
  const db = openStore(dbPath);
  seedCampaign(db, 'c1');
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at)
     VALUES ('c2', 'krakow', 'other.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')`
  ).run();
  const recordA = rawRecord({ campaignId: 'c1', url: 'https://news.example/a', status: 'raw' });
  upsertRawRecord(db, recordA);
  upsertRawRecord(db, rawRecord({ campaignId: 'c1', url: 'https://news.example/b', status: 'cleaned' }));
  upsertRawRecord(db, rawRecord({ campaignId: 'c2', url: 'https://news.example/c', status: 'used' }));
  insertMedia(db, {
    rawRecordId: recordA.id,
    position: 1,
    alt: 'Stocznia',
    caption: 'Stocznia Gdańska, 1980',
    sourceUrl: 'https://news.example/a/photo.jpg',
    file: 'article-a-img-1.png',
    contentHash: 'hash',
    widthPx: 640,
    heightPx: 400,
    rights: 'research_only',
    collectedAt: '2026-09-23T00:00:00.000Z',
  });
  const now = '2026-09-23T00:00:00.000Z';
  enqueueStep(db, 'c1', 'seed', 'https://news.example/a', now);
  const failedSeed = db.prepare("SELECT id FROM run_log WHERE kind = 'seed' AND ref = 'https://news.example/a'").get();
  claimStep(db, failedSeed.id, now);
  failStep(db, failedSeed.id, 'HTTP 503: backend unavailable', now);
  enqueueStep(db, 'c1', 'image', 'https://news.example/a#img-1', now);
  const doneImage = db.prepare("SELECT id FROM run_log WHERE kind = 'image'").get();
  claimStep(db, doneImage.id, now);
  completeStep(db, doneImage.id, now, 'wrote article-a-img-1.png');
  enqueueStep(db, 'c2', 'youtube', 'dQw4w9WgXcQ', now);
  const failedYoutube = db.prepare("SELECT id FROM run_log WHERE kind = 'youtube'").get();
  claimStep(db, failedYoutube.id, now);
  failStep(db, failedYoutube.id, 'binary not found — install yt-dlp', now);
  db.close();
  return { dbPath, recordA };
}

test('overview page shows per-campaign counts and journal diagnostics', async (t) => {
  const dir = makeTempDir();
  const { dbPath } = buildStoreFixture(dir);
  const snapshotsRoot = path.join(dir, 'snapshots');
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot, port: 0 });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/html; charset=utf-8/);
  // Both campaigns, their cities and their per-status record counts.
  assert.match(response.body, /Дыспетчар калектара/);
  assert.match(response.body, /gdansk/);
  assert.match(response.body, /krakow/);
  assert.match(response.body, /1 <span class="key">\(сыравіна\)/);
  assert.match(response.body, /1 <span class="key">\(ачышчана\)/);
  assert.match(response.body, /1 <span class="key">\(выкарыстана\)/);
  // Photos and failed steps per campaign.
  assert.match(response.body, /<td>1<\/td><td>1<\/td><td><code>c1/);
  assert.match(response.body, /<td>0<\/td><td>1<\/td><td><code>c2/);
  // The latest journal steps carry the named diagnostics.
  assert.match(response.body, /HTTP 503: backend unavailable/);
  assert.match(response.body, /binary not found — install yt-dlp/);
  assert.match(response.body, /упаў/);
  // A populated page must not show the empty state.
  assert.doesNotMatch(response.body, /Яшчэ нічога не сабрана/);
});

test('missing database file and missing snapshots dir render the empty state', async (t) => {
  const dir = makeTempDir();
  const dispatcher = await startDispatcher({
    dbPath: path.join(dir, 'absent.sqlite'),
    snapshotsRoot: path.join(dir, 'snapshots'),
    port: 0,
  });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /Яшчэ нічога не сабрана — запусціце <code>run --campaign/);
  assert.match(response.body, /Журнал пусты\./);
  // The read-only server must not have created anything on disk.
  assert.equal(fs.existsSync(path.join(dir, 'absent.sqlite')), false);
  assert.equal(fs.existsSync(path.join(dir, 'snapshots')), false);
});

test('no request writes to the database or the snapshots tree', async (t) => {
  const dir = makeTempDir();
  const { dbPath } = buildStoreFixture(dir);
  const snapshotsRoot = path.join(dir, 'snapshots');
  const campaignDir = path.join(snapshotsRoot, 'c1'.padEnd(12, '0'));
  const photoDir = path.join(campaignDir, 'article-a', 'media');
  fs.mkdirSync(photoDir, { recursive: true });
  const photo = path.join(photoDir, 'article-a-img-1.png');
  fs.writeFileSync(photo, pngBytes(640, 400));
  const dbHashBefore = sha256Hex(fs.readFileSync(dbPath));
  const treeBefore = fs.readdirSync(snapshotsRoot, { recursive: true }).sort().join('\n');

  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot, port: 0 });
  t.after(() => dispatcher.close());
  await get(dispatcher, '/');
  const media = await get(dispatcher, '/media/c10000000000/article-a/media/article-a-img-1.png');
  assert.equal(media.status, 200);
  assert.equal(media.type, 'image/png');
  await get(dispatcher, '/media/c10000000000/article-a/media/absent.png');
  await get(dispatcher, '/media/..%2F..%2Fetc%2Fpasswd');
  await get(dispatcher, '/nowhere');

  assert.equal(sha256Hex(fs.readFileSync(dbPath)), dbHashBefore);
  assert.equal(fs.readdirSync(snapshotsRoot, { recursive: true }).sort().join('\n'), treeBefore);
});

test('the media route serves snapshot files and nothing outside the data dir', async (t) => {
  const dir = makeTempDir();
  const { dbPath } = buildStoreFixture(dir);
  const snapshotsRoot = path.join(dir, 'snapshots');
  fs.mkdirSync(path.join(snapshotsRoot, 'c10000000000', 'article-a'), { recursive: true });
  fs.writeFileSync(path.join(snapshotsRoot, 'c10000000000', 'article-a', 'metadata.json'), '{"title":"A"}');
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot, port: 0 });
  t.after(() => dispatcher.close());

  const json = await get(dispatcher, '/media/c10000000000/article-a/metadata.json');
  assert.equal(json.status, 200);
  assert.equal(json.type, 'application/json; charset=utf-8');
  assert.equal(json.body, '{"title":"A"}');

  // Raw traversal paths must never read outside the snapshots root. Literal
  // dot-segments are normalized away by the URL parser (generic 404);
  // encoded slashes survive it and reach the containment guard, which names
  // the escape.
  for (const attack of ['/media/../../etc/passwd', '/media//etc/passwd', '/media/article-a/../../etc/passwd']) {
    const response = await rawRequest(dispatcher.port, attack);
    assert.equal(response.status, 404, attack);
    assert.match(response.body, /невядомы адрас|выйшаў за межы тэчкі даных|файла няма/, attack);
  }
  for (const attack of ['/media/..%2F..%2Fetc%2Fpasswd', '/media/article-a/..%2F..%2F..%2Fetc%2Fpasswd']) {
    const response = await rawRequest(dispatcher.port, attack);
    assert.equal(response.status, 404, attack);
    assert.match(response.body, /выйшаў за межы тэчкі даных/, attack);
  }

  const absent = await get(dispatcher, '/media/c10000000000/article-a/nothing.md');
  assert.equal(absent.status, 404);
});

test('the dispatcher binds the loopback interface on the default port', async (t) => {
  assert.equal(DEFAULT_PORT, 8767);
  const dir = makeTempDir();
  const dispatcher = await startDispatcher({ dbPath: path.join(dir, 'absent.sqlite'), snapshotsRoot: path.join(dir, 'snapshots') });
  t.after(() => dispatcher.close());
  assert.equal(dispatcher.address, '127.0.0.1');
  assert.equal(dispatcher.port, DEFAULT_PORT);
});

test('a busy port answers with a named diagnostic, not a crash', async (t) => {
  const dir = makeTempDir();
  const first = await startDispatcher({
    dbPath: path.join(dir, 'db.sqlite'),
    snapshotsRoot: path.join(dir, 'snapshots'),
    port: 0,
  });
  t.after(() => first.close());
  await assert.rejects(
    startDispatcher({ dbPath: path.join(dir, 'db.sqlite'), snapshotsRoot: path.join(dir, 'snapshots'), port: first.port }),
    (error) => {
      assert.match(error.message, new RegExp(`port ${first.port} is already in use — choose another with --port`));
      return true;
    }
  );
});

test('the dispatch command validates --port before serving', async (t) => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db.sqlite');
  fs.writeFileSync(dbPath, '');
  for (const port of ['abc', '0', '65536']) {
    const run = spawnSync(process.execPath, [cliPath, 'dispatch', '--port', port, '--db', dbPath], { encoding: 'utf8' });
    assert.equal(run.status, 2, `--port ${port}`);
    assert.match(run.stderr, /invalid --port/, `--port ${port}`);
  }
});
