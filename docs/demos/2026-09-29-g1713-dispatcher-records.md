# G17.13 — дыспетчар калектара: спіс запісаў з фільтрамі

*Showboat demo for issue #370 (`tools/collector/dispatcher.mjs`), created 2026-09-29.*

Старонка «Запісы» дыспетчара — табліца ўсіх запісаў усіх кампаній з фільтрамі
па статусе і горадзе праз адрасны радок. Абодва блокі ганяюць сапраўдны сервер
на эпемаральным порце над фікстурнай базай (тры запісы: gdansk/raw з двума
спасылкамі і адным фота, gdansk/cleaned з назвай у пошукавым індэксе,
krakow/used) і друкуюць толькі дэтэрмінаваныя радкі старонак — порт, ідэнты-
фікатары і тэмпавая тэчка ў выводзе не фігуруюць.

Спіс: кожны радок — назва (або URL без ачышчанай версіі), крыніца, статус,
правы, горад, дата збору, лікі фота і спасылак; спасылкі фільтраў нясуць поўны
стан вида:

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';
import { insertLink, insertMedia, openStore, upsertRawRecord } from './tools/collector/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
const campaign = (id, city) =>
  db.prepare(
    "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES (?, ?, ?, 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')"
  ).run(id, city, `demo-${city}.yaml`);
campaign('c1', 'gdansk');
campaign('c2', 'krakow');
const record = (id, campaignId, city, status, url) => ({
  id, campaign_id: campaignId, source_type: 'news', url, canonical_url: null,
  collected_at: '2026-09-23T00:00:00.000Z', city, topics: '["history"]',
  rights: 'research_only', content_hash: null, status, snapshot_path: null, media_dir: null,
});
upsertRawRecord(db, record('demo-raw-1', 'c1', 'gdansk', 'raw', 'https://news.example/shipyard'));
upsertRawRecord(db, record('demo-clean-1', 'c1', 'gdansk', 'cleaned', 'https://news.example/museum'));
upsertRawRecord(db, record('demo-used-1', 'c2', 'krakow', 'used', 'https://news.example/wawel'));
insertLink(db, { rawRecordId: 'demo-raw-1', anchorText: 'history', url: 'https://news.example/rel-1', context: 'p1' });
insertLink(db, { rawRecordId: 'demo-raw-1', anchorText: 'cranes', url: 'https://news.example/rel-2', context: 'p2' });
insertMedia(db, {
  rawRecordId: 'demo-raw-1', position: 1, alt: 'Stocznia', caption: 'Stocznia Gdańska, 1980',
  sourceUrl: 'https://news.example/shipyard/photo.jpg', file: 'shipyard-img-1.png',
  contentHash: 'hash', widthPx: 640, heightPx: 400, rights: 'research_only',
  collectedAt: '2026-09-23T00:00:00.000Z',
});
db.prepare('INSERT INTO cleaned_fts (raw_record_id, version, title, body) VALUES (?, ?, ?, ?)').run(
  'demo-clean-1', 1, 'Музей у Гданьску', 'тэкст ачышчанага дакумента'
);
db.close();

const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const base = `http://127.0.0.1:${dispatcher.port}`;
const get = (page) => fetch(base + page).then((response) => response.text());
const html = await get('/records');
const rowText = (id) =>
  new RegExp(`<td><a href="/record\\?id=${id}">([\\s\\S]*?)</tr>`)
    .exec(html)[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const rowIds = (page) => [...page.matchAll(/<td><a href="\/record\?id=([^"]+)">/g)].map((match) => match[1]);
console.log('title:', /<h1>([^<]+)/.exec(html)[1]);
console.log('raw row:', rowText('demo-raw-1'));
console.log('cleaned row:', rowText('demo-clean-1'));
console.log('used row:', rowText('demo-used-1'));

const raw = await get('/records?status=raw');
console.log('status=raw rows:', rowIds(raw).join(', ') || '(none)');
console.log('raw filter marked:', /class="on"[^>]*>сыравіна \(raw\)/.test(raw));
const krakow = await get('/records?city=krakow');
console.log('city=krakow rows:', rowIds(krakow).join(', ') || '(none)');
const both = await get('/records?status=cleaned&city=gdansk');
console.log('status=cleaned&city=gdansk rows:', rowIds(both).join(', ') || '(none)');
console.log('bar link keeps full state:', /href="\/records\?status=cleaned&amp;city=gdansk" class="on"/.test(both));
await dispatcher.close();
EOF
```

```output
title: Дыспетчар калектара
raw row: https://news.example/shipyard навіны (news) сыравіна (raw) толькі даследаванне (research_only) gdansk 2026-09-23T00:00:00.000Z 1 2
cleaned row: Музей у Гданьску навіны (news) ачышчана (cleaned) толькі даследаванне (research_only) gdansk 2026-09-23T00:00:00.000Z 0 0
used row: https://news.example/wawel навіны (news) выкарыстана (used) толькі даследаванне (research_only) krakow 2026-09-23T00:00:00.000Z 0 0
status=raw rows: demo-raw-1
raw filter marked: true
city=krakow rows: demo-used-1
status=cleaned&city=gdansk rows: demo-clean-1
bar link keeps full state: true
```

Невядомы параметр і нявядомы статус — чытальныя прыкметкі на старонцы з
нефільтраваным спісам, не 500; варожае значэнне трапляе ў прыкметку
экранаваным тэкстам, не як разметка:

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';
import { openStore, upsertRawRecord } from './tools/collector/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'records-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
db.prepare(
  "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c1', 'gdansk', 'demo.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')"
).run();
upsertRawRecord(db, {
  id: 'demo-raw-1', campaign_id: 'c1', source_type: 'news', url: 'https://news.example/shipyard',
  canonical_url: null, collected_at: '2026-09-23T00:00:00.000Z', city: 'gdansk',
  topics: '["history"]', rights: 'research_only', content_hash: null, status: 'raw',
  snapshot_path: null, media_dir: null,
});
db.close();

const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const base = `http://127.0.0.1:${dispatcher.port}`;
const get = (page) => fetch(base + page).then((response) => response.text());
const note = async (page) => /class="note">([^<]+)/.exec(await get(page))[1];

console.log('unknown param:', await note('/records?banana=1'));
console.log('unknown status:', await note('/records?status=banana'));
const hostile = await get('/records?status=%3Cscript%3E');
console.log('no raw script tag:', !/<script>/.test(hostile));
console.log('hostile note:', /class="note">([^<]+)/.exec(hostile)[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
const nowhere = await get('/records?city=nowhere');
console.log('unknown city:', /class="empty">([^<]+)/.exec(nowhere)[1]);
await dispatcher.close();
EOF
```

```output
unknown param: Невядомы параметр «banana» — ігнаруецца; вядомыя: status, city.
unknown status: Невядомы статус «banana» — вядомыя: raw, cleaned, used; фільтр статусу не прыменены.
no raw script tag: true
hostile note: Невядомы статус «<script>» — вядомыя: raw, cleaned, used; фільтр статусу не прыменены.
unknown city: Па гэтым фільтры запісаў няма.
```
