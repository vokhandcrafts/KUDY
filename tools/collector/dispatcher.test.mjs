// Dispatcher suite (G17.12, «Запісы» — G17.13, «Як парсіць» — G17.20): the
// read-only local pages over the store. The fixture database is built through
// the production store functions, then closed; the suite boots the real
// dispatcher on an ephemeral port and fetches the pages — no route is stubbed
// (implementation-rules 15). Assertions are on rendered content, so reverting
// the feature turns the suite red.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  completeStep,
  claimStep,
  enqueueStep,
  failStep,
  insertLink,
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

// Two campaigns with records in every status, a photo, links, a failed crawl
// step and a failed youtube step — everything the overview and the records
// pages claim to show. The records fixture (G17.13): c1's two records are
// gdansk with two links on A and one on B, c2's record is krakow with none;
// only B has a cleaned version, so its title comes from the search index and
// A's falls back to the URL. The card fixture (G17.14): A has a full snapshot
// on disk (metadata with attribution, text.md with an image whose file
// exists), B's metadata.json is corrupt and its text.md references an image
// that is not there plus one hostile non-media ref, E's snapshot dir is empty;
// C and D carry no snapshot; F's snapshot sits outside the snapshots root
// (every image must answer the containment note even though its file exists,
// and its attribution carries a non-http contributors_url); G is a web record
// whose url embeds the same video id as D — the step log must stay empty,
// because the youtube ref match is scoped to youtube records. D's url embeds
// the video id of the failed youtube step, E's /wiki/ url maps back to the
// wiki-article step's ref, A's url is the failed seed's ref and the
// `recordId:`-prefixed image step's owner — the ref shapes the card's step
// log matches.
function buildStoreFixture(dir) {
  const dbPath = path.join(dir, 'db.sqlite');
  const db = openStore(dbPath);
  seedCampaign(db, 'c1');
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at)
     VALUES ('c2', 'krakow', 'other.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')`
  ).run();
  const snapshotsRoot = path.join(dir, 'snapshots');
  const snapshotA = path.join(snapshotsRoot, 'c10000000000', 'article-a-ab12cd34');
  fs.mkdirSync(path.join(snapshotA, 'media'), { recursive: true });
  fs.writeFileSync(
    path.join(snapshotA, 'metadata.json'),
    `${JSON.stringify(
      {
        title: 'Верф Гданьска',
        published_at: '2026-09-20',
        author: 'Jan Kowalski',
        language: 'pl',
        attribution: {
          site: 'https://pl.wikipedia.org',
          revision_id: '12345',
          contributors_url: 'https://pl.wikipedia.org/w/index.php?title=Gda%C5%84sk&action=history',
          license: 'CC BY-SA',
        },
        source_url: 'https://news.example/a',
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(snapshotA, 'text.md'),
    'Першы абзац пра верф.\n\n![Stocznia](media/article-a-img-1.png)\n_Stocznia Gdańska, 1980_\n\nДругі абзац са [спасылкай](https://news.example/x).\n'
  );
  fs.writeFileSync(path.join(snapshotA, 'media', 'article-a-img-1.png'), pngBytes(640, 400));
  const snapshotB = path.join(snapshotsRoot, 'c10000000000', 'museum-beef1234');
  fs.mkdirSync(snapshotB, { recursive: true });
  fs.writeFileSync(path.join(snapshotB, 'metadata.json'), 'не-JSON');
  fs.writeFileSync(
    path.join(snapshotB, 'text.md'),
    '![заставка](media/museum-img-1.png)\n_Від музея_\n\n![хак](../etc/passwd)\n\n![хак-2](media/../../etc/passwd)\n'
  );
  // F's snapshot deliberately lives outside the snapshots root: the text and
  // metadata are readable from the row's own path, but no image may become a
  // /media URL.
  const snapshotF = path.join(dir, 'outside-snapshot');
  fs.mkdirSync(path.join(snapshotF, 'media'), { recursive: true });
  fs.writeFileSync(
    path.join(snapshotF, 'metadata.json'),
    `${JSON.stringify(
      {
        title: 'Па-за коранем',
        attribution: {
          site: 'https://pl.wikipedia.org',
          revision_id: '99',
          contributors_url: 'javascript:alert(1)',
          license: 'CC BY-SA',
        },
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(path.join(snapshotF, 'text.md'), '![заставка](media/outside-img-1.png)\n_Від звонку_\n');
  fs.writeFileSync(path.join(snapshotF, 'media', 'outside-img-1.png'), pngBytes(10, 10));
  const snapshotE = path.join(snapshotsRoot, 'c2', 'gdansk-fedc9876');
  fs.mkdirSync(snapshotE, { recursive: true });
  const recordA = rawRecord({
    campaignId: 'c1',
    url: 'https://news.example/a',
    status: 'raw',
    snapshot_path: snapshotA,
    media_dir: path.join(snapshotA, 'media'),
  });
  upsertRawRecord(db, recordA);
  const recordB = rawRecord({
    campaignId: 'c1',
    url: 'https://news.example/b',
    status: 'cleaned',
    snapshot_path: snapshotB,
    media_dir: path.join(snapshotB, 'media'),
  });
  upsertRawRecord(db, recordB);
  const recordC = rawRecord({ campaignId: 'c2', url: 'https://news.example/c', status: 'used', city: 'krakow' });
  upsertRawRecord(db, recordC);
  const recordD = rawRecord({
    campaignId: 'c2',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    status: 'raw',
    city: 'krakow',
    source_type: 'youtube',
  });
  upsertRawRecord(db, recordD);
  const recordE = rawRecord({
    campaignId: 'c2',
    url: 'https://pl.wikipedia.org/wiki/Gda%C5%84sk',
    status: 'raw',
    city: 'krakow',
    source_type: 'wiki',
    rights: 'licensed',
    snapshot_path: snapshotE,
    media_dir: path.join(snapshotE, 'media'),
  });
  upsertRawRecord(db, recordE);
  const recordF = rawRecord({
    campaignId: 'c2',
    url: 'https://news.example/outside',
    status: 'raw',
    city: 'krakow',
    snapshot_path: snapshotF,
    media_dir: path.join(snapshotF, 'media'),
  });
  upsertRawRecord(db, recordF);
  const recordG = rawRecord({
    campaignId: 'c2',
    url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    status: 'raw',
    city: 'krakow',
  });
  upsertRawRecord(db, recordG);
  for (const link of [
    { rawRecordId: recordA.id, anchorText: 'history', url: 'https://news.example/rel-1', context: 'p1' },
    { rawRecordId: recordA.id, anchorText: 'cranes', url: 'https://news.example/rel-2', context: 'p2' },
    { rawRecordId: recordB.id, anchorText: 'museum', url: 'https://news.example/rel-3', context: 'p1' },
  ]) {
    insertLink(db, link);
  }
  db.prepare('INSERT INTO cleaned_fts (raw_record_id, version, title, body) VALUES (?, ?, ?, ?)').run(
    recordB.id,
    1,
    'Назва запіса B',
    'тэкст ачышчанага дакумента'
  );
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
  enqueueStep(db, 'c1', 'image', `${recordA.id}:0`, now);
  const cardImage = db.prepare("SELECT id FROM run_log WHERE kind = 'image' AND ref LIKE ?").get(`${recordA.id}:%`);
  claimStep(db, cardImage.id, now);
  completeStep(db, cardImage.id, now, 'wrote article-a-img-1.png');
  enqueueStep(db, 'c2', 'youtube', 'dQw4w9WgXcQ', now);
  const failedYoutube = db.prepare("SELECT id FROM run_log WHERE kind = 'youtube'").get();
  claimStep(db, failedYoutube.id, now);
  failStep(db, failedYoutube.id, 'binary not found — install yt-dlp', now);
  enqueueStep(db, 'c2', 'wiki-article', 'Gdańsk', now);
  const doneWiki = db.prepare("SELECT id FROM run_log WHERE kind = 'wiki-article'").get();
  claimStep(db, doneWiki.id, now);
  completeStep(db, doneWiki.id, now, 'wrote Gdańsk');
  db.close();
  return { dbPath, recordA, recordB, recordC, recordD, recordE, recordF, recordG };
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
  const records = await get(dispatcher, '/records');
  assert.equal(records.status, 200);
  assert.match(records.body, /Яшчэ нічога не сабрана — запусціце <code>run --campaign/);
  // The read-only server must not have created anything on disk.
  assert.equal(fs.existsSync(path.join(dir, 'absent.sqlite')), false);
  assert.equal(fs.existsSync(path.join(dir, 'snapshots')), false);
});

test('records page lists every record with counts, rights and the card link', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordA, recordB } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, '/records');
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/html; charset=utf-8/);
  // Every record of every campaign, each row linking to its card page (task 06).
  assert.match(response.body, new RegExp(`href="/record\\?id=${recordA.id}"`));
  assert.match(response.body, new RegExp(`href="/record\\?id=${recordB.id}"`));
  // Title from the search index for the cleaned record; URL fallback for the raw one.
  assert.match(response.body, /Назва запіса B/);
  assert.match(response.body, />https:\/\/news\.example\/a<\/a>/);
  // Source, status and rights show the Belarusian word next to the raw key.
  assert.match(response.body, /навіны <span class="key">\(news\)<\/span>/);
  assert.match(response.body, /ачышчана <span class="key">\(cleaned\)<\/span>/);
  assert.match(response.body, /выкарыстана <span class="key">\(used\)<\/span>/);
  assert.match(response.body, /толькі даследаванне <span class="key">\(research_only\)<\/span>/);
  // Photo and link counts: A — 1 фота / 2 спасылкі, B — 0/1, C — 0/0.
  assert.match(response.body, /<td>1<\/td><td>2<\/td>/);
  assert.match(response.body, /<td>0<\/td><td>1<\/td>/);
  assert.match(response.body, /<td>0<\/td><td>0<\/td>/);
  // The filter bar offers every city present in the store.
  assert.match(response.body, /Горад: <a href="\/records"[^>]*>усе<\/a>/);
  assert.match(response.body, /<a href="\/records\?city=gdansk"[^>]*>gdansk<\/a>/);
  assert.match(response.body, /<a href="\/records\?city=krakow"[^>]*>krakow<\/a>/);
  assert.doesNotMatch(response.body, /class="note"/);
});

test('status and city URL filters narrow the records list and stay shareable', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordA, recordB, recordC } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const raw = await get(dispatcher, '/records?status=raw');
  assert.equal(raw.status, 200);
  assert.ok(raw.body.includes(recordA.url), 'raw record listed');
  assert.ok(!raw.body.includes(`href="/record?id=${recordB.id}"`), 'cleaned record filtered out');
  assert.ok(!raw.body.includes(recordC.url), 'used record filtered out');
  assert.match(raw.body, /<a href="\/records\?status=raw" class="on">сыравіна \(raw\)<\/a>/);

  const krakow = await get(dispatcher, '/records?city=krakow');
  assert.ok(krakow.body.includes(recordC.url), 'krakow record listed');
  assert.ok(!krakow.body.includes(recordA.url), 'gdansk record filtered out');
  assert.match(krakow.body, /<a href="\/records\?city=krakow" class="on">krakow<\/a>/);

  const both = await get(dispatcher, '/records?status=cleaned&city=gdansk');
  assert.ok(both.body.includes(`href="/record?id=${recordB.id}"`), 'cleaned gdansk record listed');
  assert.ok(!both.body.includes(recordA.url), 'raw gdansk record filtered out');
  // The address bar is the shareable state; the bar's links carry the same
  // full state, so a colleague opens the filtered view as-is.
  assert.match(both.body, /href="\/records\?status=cleaned&amp;city=gdansk" class="on"/);
});

test('unknown record filter parameters answer readably, not 500', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordA } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const unknownParam = await get(dispatcher, '/records?banana=1');
  assert.equal(unknownParam.status, 200);
  assert.match(unknownParam.body, /Невядомы параметр «banana» — ігнаруецца; вядомыя: status, city\./);
  assert.ok(unknownParam.body.includes(recordA.url), 'the list still renders, unfiltered');

  const unknownStatus = await get(dispatcher, '/records?status=banana');
  assert.equal(unknownStatus.status, 200);
  assert.match(unknownStatus.body, /Невядомы статус «banana» — вядомыя: raw, cleaned, used; фільтр статусу не прыменены\./);
  assert.ok(unknownStatus.body.includes(recordA.url), 'the unfiltered list is shown');

  // A hostile status value arrives escaped as text, never as markup.
  const hostile = await get(dispatcher, '/records?status=%3Cscript%3E');
  assert.equal(hostile.status, 200);
  assert.doesNotMatch(hostile.body, /<script>/);
  assert.match(hostile.body, /Невядомы статус «&lt;script&gt;»/);

  // An empty value is no filter: the unfiltered list, no note — a regression
  // that forwards '' into the WHERE clause would empty the table silently.
  for (const empty of ['/records?status=', '/records?city=', '/records?status=&city=']) {
    const response = await get(dispatcher, empty);
    assert.equal(response.status, 200, empty);
    assert.ok(response.body.includes(recordA.url), `unfiltered list — ${empty}`);
    assert.doesNotMatch(response.body, /class="note"/, empty);
  }

  const unknownCity = await get(dispatcher, '/records?city=nowhere');
  assert.equal(unknownCity.status, 200);
  assert.match(unknownCity.body, /Па гэтым фільтры запісаў няма\./);
});

test('record card shows snapshot text with the image at its position, links and metadata', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordA } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, `/record?id=${recordA.id}`);
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/html; charset=utf-8/);
  // The heading falls back to metadata.json — record A has no search-index row.
  assert.match(response.body, /<h2>Верф Гданьска<\/h2>/);
  // The snapshot text renders block by block: paragraphs with inline anchors,
  // the image at its archive position with the caption under it, served
  // through the /media route.
  assert.match(response.body, /<p class="text">Першы абзац пра верф\.<\/p>/);
  assert.match(
    response.body,
    /<figure><img src="\/media\/c10000000000\/article-a-ab12cd34\/media\/article-a-img-1\.png" alt="Stocznia"><figcaption>Stocznia Gdańska, 1980<\/figcaption><\/figure>/
  );
  assert.match(response.body, /Другі абзац са <a href="https:\/\/news\.example\/x">спасылкай<\/a>\./);
  // The link table: anchor, address, paragraph context.
  assert.match(
    response.body,
    /<td>history<\/td><td><a href="https:\/\/news\.example\/rel-1">https:\/\/news\.example\/rel-1<\/a><\/td><td class="diagnostic">p1<\/td>/
  );
  assert.match(response.body, /<td>cranes<\/td><td><a href="https:\/\/news\.example\/rel-2">/);
  // Metadata: source, collected and published dates, author, language, rights,
  // and the attribution whenever metadata.json carries one.
  assert.match(response.body, /<th>Крыніца<\/th><td><a href="https:\/\/news\.example\/a">https:\/\/news\.example\/a<\/a><\/td>/);
  assert.match(response.body, /<th>Дата збору<\/th><td>2026-09-23T00:00:00\.000Z<\/td>/);
  assert.match(response.body, /<th>Дата публікацыі<\/th><td>2026-09-20<\/td>/);
  assert.match(response.body, /<th>Аўтар<\/th><td>Jan Kowalski<\/td>/);
  assert.match(response.body, /<th>Мова<\/th><td>pl<\/td>/);
  assert.match(response.body, /<th>Правы<\/th><td>толькі даследаванне <span class="key">\(research_only\)<\/span><\/td>/);
  assert.match(
    response.body,
    /<th>Атрыбуцыя<\/th><td>https:\/\/pl\.wikipedia\.org, CC BY-SA, рэвізія 12345 — <a href="https:\/\/pl\.wikipedia\.org\/w\/index\.php\?title=Gda%C5%84sk&amp;action=history">гісторыя рэвізій<\/a><\/td>/
  );
});

test('the card step log matches steps by url, record prefix, video id and wiki title', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordA, recordC, recordD, recordE, recordG } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  // A: the failed seed (ref = record url) and the done image (ref prefixed
  // with the record id); the campaign's other image step stays out. The time
  // cell rides in the same assertion — a snake_case row field left unmapped
  // would render the '—' fallback here.
  const cardA = await get(dispatcher, `/record?id=${recordA.id}`);
  assert.match(
    cardA.body,
    /<tr><td>2026-09-23T00:00:00\.000Z<\/td><td><code>seed<\/code>: https:\/\/news\.example\/a<\/td><td>упаў<\/td><td class="diagnostic">HTTP 503: backend unavailable<\/td><\/tr>/
  );
  assert.match(cardA.body, new RegExp(`<td><code>image</code>: ${recordA.id}:0</td><td>гатова</td>`));
  assert.ok(!cardA.body.includes('https://news.example/a#img-1'), "another step's ref stays out of the card");

  // D: the failed youtube step via the video id inside the record url.
  const cardD = await get(dispatcher, `/record?id=${recordD.id}`);
  assert.match(
    cardD.body,
    /<td><code>youtube<\/code>: dQw4w9WgXcQ<\/td><td>упаў<\/td><td class="diagnostic">binary not found — install yt-dlp<\/td>/
  );

  // E: the wiki-article step via the /wiki/ title the record url maps back to.
  const cardE = await get(dispatcher, `/record?id=${recordE.id}`);
  assert.match(cardE.body, /<td><code>wiki-article<\/code>: Gdańsk<\/td><td>гатова<\/td>/);

  // C has no steps of its own — a readable empty row, not silence.
  const cardC = await get(dispatcher, `/record?id=${recordC.id}`);
  assert.match(cardC.body, /Крокаў для гэтага запіса ў журнале няма\./);

  // G is a web record whose url embeds the same video id as D's youtube step:
  // the ref match is scoped to the source type, so no step row appears (the
  // url itself still shows in the metadata table).
  const cardG = await get(dispatcher, `/record?id=${recordG.id}`);
  assert.match(cardG.body, /Крокаў для гэтага запіса ў журнале няма\./);
  assert.ok(!cardG.body.includes('<code>youtube</code>'), 'a web record must not inherit the youtube step');
});

test('a youtube record whose url is not a URL renders the card with an empty journal', async (t) => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'db.sqlite');
  const db = openStore(dbPath);
  seedCampaign(db, 'c1');
  const record = rawRecord({ campaignId: 'c1', url: 'не-URL', source_type: 'youtube' });
  upsertRawRecord(db, record);
  // The campaign journal holds a youtube step by video id: the card must not
  // claim it, because the corrupt url yields no id — and without the defensive
  // catch around new URL(record.url) in recordSteps the request itself fails.
  enqueueStep(db, 'c1', 'youtube', 'dQw4w9WgXcQ', '2026-09-23T00:00:00.000Z');
  db.close();
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, `/record?id=${record.id}`);
  assert.equal(response.status, 200);
  assert.match(response.type, /^text\/html; charset=utf-8/);
  assert.match(response.body, /Крокаў для гэтага запіса ў журнале няма\./);
  assert.ok(!response.body.includes('dQw4w9WgXcQ'), 'the video-id step stays out of the corrupt card');
  // The corrupt url renders as text — the card is a reading place, not a
  // launcher.
  assert.match(response.body, /<th>Крыніца<\/th><td><code>не-URL<\/code><\/td>/);

  // The server answers the next request normally.
  const records = await get(dispatcher, '/records');
  assert.equal(records.status, 200);
});

test('missing snapshot files render readable notes and the server stays up', async (t) => {
  const dir = makeTempDir();
  const { dbPath, recordB, recordC, recordE, recordF } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  // B: text.md references an image whose file is gone plus a hostile non-media
  // ref, metadata.json is corrupt — notes on the card, status still 200; the
  // heading comes from the search index, not from the unreadable metadata.
  const cardB = await get(dispatcher, `/record?id=${recordB.id}`);
  assert.equal(cardB.status, 200);
  assert.match(cardB.body, /<h2>Назва запіса B<\/h2>/);
  assert.match(cardB.body, /Выява адсутнічае на дыску: <code>media\/museum-img-1\.png<\/code> — подпіс: /);
  assert.match(cardB.body, /Нераспазнаная спасылка на выяву: <code>\.\.\/etc\/passwd<\/code>\./);
  assert.match(cardB.body, /Нераспазнаная спасылка на выяву: <code>media\/\.\.\/\.\.\/etc\/passwd<\/code>\./);
  assert.match(cardB.body, /Метаданыя здымку не прачытаны: няма ці пашкоджаны <code>metadata\.json<\/code>/);

  // C carries no snapshot at all.
  const cardC = await get(dispatcher, `/record?id=${recordC.id}`);
  assert.equal(cardC.status, 200);
  assert.match(cardC.body, /Здымак не запісаны — тэксту здымку няма\./);

  // E's snapshot dir exists but is empty: neither text form nor metadata.
  const cardE = await get(dispatcher, `/record?id=${recordE.id}`);
  assert.equal(cardE.status, 200);
  assert.match(cardE.body, /няма ні <code>text\.md<\/code>, ні <code>transcript\.md<\/code>/);

  // F's snapshot lives outside the snapshots root: the file exists, but no
  // image may become a /media URL — the containment note renders instead, the
  // text and metadata still show, and the attribution's non-http
  // contributors_url arrives as text, never as an anchor.
  const cardF = await get(dispatcher, `/record?id=${recordF.id}`);
  assert.equal(cardF.status, 200);
  assert.match(cardF.body, /<h2>Па-за коранем<\/h2>/);
  assert.match(
    cardF.body,
    /Снапшот па-за тэчкай даных — выяву паказаць нельга: <code>media\/outside-img-1\.png<\/code>/
  );
  assert.ok(!cardF.body.includes('Выява адсутнічае'), 'the file exists — only the URL is refused');
  assert.match(cardF.body, /<code>javascript:alert\(1\)<\/code>/);
  assert.doesNotMatch(cardF.body, /<a href="javascript:/);

  // The server answers the list page normally afterwards.
  const records = await get(dispatcher, '/records');
  assert.equal(records.status, 200);
});

test('unknown record id, missing id and unknown parameter answer readably', async (t) => {
  const dir = makeTempDir();
  const { dbPath } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const absent = await get(dispatcher, '/record?id=absent-id');
  assert.equal(absent.status, 404);
  assert.match(absent.body, /Запіс <code>absent-id<\/code> у сховішчы не знойдзены\./);

  const noId = await get(dispatcher, '/record');
  assert.equal(noId.status, 404);
  assert.match(noId.body, /патрабуе параметр <code>id<\/code>/);

  const extra = await get(dispatcher, '/record?id=absent-id&banana=1');
  assert.equal(extra.status, 404);
  assert.match(extra.body, /Невядомы параметр «banana» — ігнаруецца; вядомы: id\./);
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

test('a store file that cannot be queried answers a named diagnostic, not a hang', async (t) => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'zero.sqlite');
  fs.writeFileSync(dbPath, '');
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  // The timeout proves the request settles: a regression that writes the
  // response head before computing the body hangs here until the signal.
  const response = await fetch(`http://127.0.0.1:${dispatcher.port}/`, { signal: AbortSignal.timeout(5000) });
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.match(body, /^dispatcher: /);
});

test('corrupt percent-encoding on the media route is a 404, not a thrown URIError', async (t) => {
  const dir = makeTempDir();
  const { dbPath } = buildStoreFixture(dir);
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const response = await rawRequest(dispatcher.port, '/media/%zz');
  assert.equal(response.status, 404);
  assert.match(response.body, /невядомы адрас/);
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

// The short root command from the collector README's «Каманды» is npm wiring
// over the documented CLI command; retargeting or removing it turns this red.
test('the root npm script collector:dispatch points at the dispatch CLI command', () => {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(
    pkg.scripts['collector:dispatch'],
    'node tools/collector/collector.mjs dispatch',
    'collector:dispatch must raise the dispatcher through the documented CLI command'
  );
});

// --- «Як парсіць» (G17.20) ---

// A minimal valid campaign file on disk: the block reads it (never writes)
// for the login-profile detection, so the fixtures are real files addressed
// by the absolute paths the store rows carry.
function writeCampaignYaml(dir, name, { profile = false, transport = null } = {}) {
  const file = path.join(dir, name);
  const lines = [
    'city: gdansk',
    'seeds:',
    '  - https://news.example/a',
    'topics: []',
    'fence: { depth: 3, extra_domains: [], delay_s: [2, 5] }',
    'youtube: []',
  ];
  if (transport !== null) lines.push(`transport: ${transport}`);
  if (profile) lines.push('browser_user_data_dir: /home/editor/browser-profile');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function insertCampaignRow(db, id, sourcePath, transport) {
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, transport, created_at)
     VALUES (?, 'gdansk', ?, 'hash', '[]', '[]', '{}', '[]', ?, '2026-09-23T00:00:00.000Z')`
  ).run(id, sourcePath, transport);
}

// The common arrangement of the «Як парсіць» tests: one campaign row with its
// campaign file on disk and the real dispatcher over the store.
async function startTransportDispatcher(t, dir, { name, profile = false, transport }) {
  const dbPath = path.join(dir, 'db.sqlite');
  const db = openStore(dbPath);
  const campaignYamlPath = writeCampaignYaml(dir, name, { profile, transport });
  insertCampaignRow(db, 'c1', campaignYamlPath, transport);
  db.close();
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());
  return { dispatcher, campaignYamlPath, dbPath };
}

test('the «Як парсіць» block shows the transport from the store row, never from the YAML', async (t) => {
  const dir = makeTempDir();
  // The YAML says tor; the row — what the last run actually used — says
  // direct: the block must follow the row.
  const { dispatcher, campaignYamlPath } = await startTransportDispatcher(t, dir, {
    name: 'direct.yaml',
    transport: 'direct',
  });

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /<h2>Як парсіць<\/h2>/);
  // The human word and the raw key come from the row.
  assert.match(response.body, /<h3>gdansk — напрамую <span class="key">\(direct\)<\/span><\/h3>/);
  assert.ok(
    response.body.includes(
      `Запуск гэтай кампаніі: <code>node tools/collector/collector.mjs run --campaign ${campaignYamlPath}</code>`
    ),
    'the minimal block names this campaign file in the run command'
  );
  // The YAML's tor never leaks into the page: the minimal direct block carries
  // the run command only, with no Tor mention at all.
  assert.doesNotMatch(response.body, /праз Tor/);
  assert.doesNotMatch(response.body, /tor-дэман/);
});

test('a tor campaign renders the numbered manual steps and the risks', async (t) => {
  const dir = makeTempDir();
  const { dispatcher, campaignYamlPath } = await startTransportDispatcher(t, dir, {
    name: 'tor.yaml',
    transport: 'tor',
  });

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /<h3>gdansk — праз Tor <span class="key">\(tor\)<\/span><\/h3>/);
  // The numbered steps carry the copy-paste commands: raise the daemon,
  // verify the SOCKS5 address from the transport contract, parse this
  // campaign.
  assert.match(
    response.body,
    /<ol>\n<li>Падніме tor-дэман у асобным тэрмінале: <code>tor<\/code><\/li>\n<li>Праверце SOCKS5-проксі: <code>curl --socks5-hostname 127\.0\.0\.1:9050 https:\/\/check\.torproject\.org\/api\/ip<\/code>[^<]*<\/li>\n<li>Запусціце парсінг гэтай кампаніі: <code>[^<]*<\/code><\/li>\n<\/ol>/
  );
  assert.ok(
    response.body.includes(`run --campaign ${campaignYamlPath}</code>`),
    'the run command names this campaign file'
  );
  // The risks the spec names are on the page.
  assert.match(response.body, /CDN блакуюць Tor-выходы/);
  assert.match(response.body, /таймаўт 30 с/);
  // No profile in the campaign file — no pointed warning.
  assert.doesNotMatch(response.body, /дэананімізуе/);
});

test('a tor campaign with a login profile in its file warns about de-anonymization', async (t) => {
  const dir = makeTempDir();
  const { dispatcher } = await startTransportDispatcher(t, dir, {
    name: 'tor-profile.yaml',
    transport: 'tor',
    profile: true,
  });

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /праз Tor гэта дэананімізуе трафік/);
  // The profile path stays the campaign file's business: the warning names
  // the field, it never renders a local path.
  assert.ok(!response.body.includes('/home/editor/browser-profile'), 'the profile path never renders');
});

test('an unknown transport value in a row renders the raw key and the minimal block', async (t) => {
  const dir = makeTempDir();
  // A corrupt row (a foreign writer) carries a value the schema never allows:
  // the raw key shows as text, the page answers with the minimal block, not a
  // crash.
  const { dispatcher } = await startTransportDispatcher(t, dir, {
    name: 'odd.yaml',
    transport: 'vpn',
  });

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /<h3>gdansk — vpn <span class="key">\(vpn\)<\/span><\/h3>/);
  assert.doesNotMatch(response.body, /<ol>/);
  assert.doesNotMatch(response.body, /праз Tor/);
});

test('a store written before the transport column falls back to the direct default', async (t) => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, 'old.sqlite');
  // Built without the store helpers on purpose: openStore migrates in place,
  // while a dispatcher opens read-only — a database an old writer left behind
  // has no transport column, and the page must answer with the local default,
  // not a crash.
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE campaigns (id TEXT PRIMARY KEY, city TEXT NOT NULL, source_path TEXT NOT NULL, content_hash TEXT NOT NULL, seeds TEXT NOT NULL, topics TEXT NOT NULL, fence TEXT NOT NULL, youtube TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE raw_records (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE media (raw_record_id TEXT NOT NULL);
    CREATE TABLE run_log (id INTEGER PRIMARY KEY, campaign_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, status TEXT NOT NULL, error TEXT, finished_at TEXT);
  `);
  db.prepare(
    `INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at)
     VALUES ('c1', 'gdansk', 'old.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')`
  ).run();
  db.close();
  const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
  t.after(() => dispatcher.close());

  const response = await get(dispatcher, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /<h3>gdansk — напрамую <span class="key">\(direct\)<\/span><\/h3>/);
  assert.doesNotMatch(response.body, /праз Tor/);
});

test('no request writes the database or the campaign files it reads', async (t) => {
  const dir = makeTempDir();
  const { dispatcher, campaignYamlPath, dbPath } = await startTransportDispatcher(t, dir, {
    name: 'tor-profile.yaml',
    transport: 'tor',
    profile: true,
  });
  const dbHashBefore = sha256Hex(fs.readFileSync(dbPath));
  const yamlBefore = fs.readFileSync(campaignYamlPath);

  await get(dispatcher, '/');
  await get(dispatcher, '/records');

  assert.equal(sha256Hex(fs.readFileSync(dbPath)), dbHashBefore);
  assert.deepEqual(fs.readFileSync(campaignYamlPath), yamlBefore);
});
