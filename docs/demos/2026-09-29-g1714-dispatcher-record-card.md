# G17.14 — дыспетчар калектара: картка запіса

*Showboat demo for issue #371 (`tools/collector/dispatcher.mjs`), created 2026-09-29.*

Картка запіса (`/record?id=…`) — чытэльнае месца рэдактара для аднаго запіса.
Абодва блокі ганяюць сапраўдны сервер на эпемаральным порце над фікстурнай
базай і друкуюць толькі дэтэрмінаваныя радкі старонак — порт, ідэнтыфікатары і
тэмпавая тэчка ў выводзе не фігуруюць.

Поўная картка: тэкст здымку блокамі (абзацы з анкерамі, выява на сваёй
пазіцыі з подпісам), табліца спасылак, метаданыя з крыніцай і атрыбуцыяй,
журнал крокаў запіса з дыягностыкай; выява аддаецца маршрутам `/media`:

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';
import { insertLink, openStore, upsertRawRecord } from './tools/collector/store.mjs';
import { enqueueStep, claimStep, failStep, completeStep } from './tools/collector/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
db.prepare(
  "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c1', 'gdansk', 'demo.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')"
).run();
const snapshot = path.join(dir, 'snapshots', 'c10000000000', 'shipyard-abc123');
fs.mkdirSync(path.join(snapshot, 'media'), { recursive: true });
fs.writeFileSync(
  path.join(snapshot, 'metadata.json'),
  JSON.stringify({
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
    source_url: 'https://news.example/shipyard',
  }, null, 2)
);
fs.writeFileSync(
  path.join(snapshot, 'text.md'),
  'Першы абзац пра верф.\n\n![Stocznia](media/shipyard-img-1.png)\n_Stocznia Gdańska, 1980_\n\nДругі абзац са [спасылкай](https://news.example/museum).\n'
);
fs.writeFileSync(path.join(snapshot, 'media', 'shipyard-img-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
upsertRawRecord(db, {
  id: 'demo-card-1', campaign_id: 'c1', source_type: 'wiki', url: 'https://news.example/shipyard',
  canonical_url: null, collected_at: '2026-09-23T00:00:00.000Z', city: 'gdansk',
  topics: '["history"]', rights: 'licensed', content_hash: null, status: 'raw',
  snapshot_path: snapshot, media_dir: path.join(snapshot, 'media'),
});
insertLink(db, { rawRecordId: 'demo-card-1', anchorText: 'history', url: 'https://news.example/rel-1', context: 'p1' });
const now = '2026-09-23T00:00:00.000Z';
enqueueStep(db, 'c1', 'seed', 'https://news.example/shipyard', now);
const seed = db.prepare("SELECT id FROM run_log WHERE kind = 'seed'").get();
claimStep(db, seed.id, now);
failStep(db, seed.id, 'HTTP 503: backend unavailable', now);
enqueueStep(db, 'c1', 'image', 'demo-card-1:0', now);
const image = db.prepare("SELECT id FROM run_log WHERE kind = 'image'").get();
claimStep(db, image.id, now);
completeStep(db, image.id, now, 'wrote shipyard-img-1.png');
db.close();

const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const base = `http://127.0.0.1:${dispatcher.port}`;
const html = await fetch(`${base}/record?id=demo-card-1`).then((r) => r.text());
const strip = (s) => s.replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('heading:', /<h2>([^<]+)/.exec(html)[1]);
console.log('paragraph:', strip(/<p class="text">([^<]+)<\/p>/.exec(html)[1]));
console.log('figure:', strip(/<figure>[\s\S]*?<\/figure>/.exec(html)[0]));
const row = (needle) => {
  const chunk = html.split('<tr>').find((r) => r.includes(needle));
  return strip(`<tr>${chunk.slice(0, chunk.indexOf('</tr>') + 5)}`);
};
console.log('link row:', row('<td>history</td>'));
console.log('step row:', row('<code>seed</code>'));
const media = await fetch(`${base}/media/c10000000000/shipyard-abc123/media/shipyard-img-1.png`);
console.log('media route:', media.status, media.headers.get('content-type'), (await media.arrayBuffer()).byteLength);
await dispatcher.close();
EOF
```

```output
heading: Верф Гданьска
paragraph: Першы абзац пра верф.
figure: Stocznia Gdańska, 1980
link row: history https://news.example/rel-1 p1
step row: 2026-09-23T00:00:00.000Z seed: https://news.example/shipyard упаў HTTP 503: backend unavailable
media route: 200 image/png 4
```

Адсутныя файлы — чытальныя прыкметкі на картцы, сервер не падае: пашкоджаны
`metadata.json`, выява, якой няма на дыску, запіс без здымку, нявядомы
ідэнтыфікатар (шлях тэмпавай тэчкі ў прыкметках адразаецца пры друку):

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';
import { openStore, upsertRawRecord } from './tools/collector/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
db.prepare(
  "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c1', 'gdansk', 'demo.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')"
).run();
const broken = path.join(dir, 'snapshots', 'c10000000000', 'broken-abc123');
fs.mkdirSync(broken, { recursive: true });
fs.writeFileSync(path.join(broken, 'metadata.json'), 'не-JSON');
fs.writeFileSync(path.join(broken, 'text.md'), '![заставка](media/broken-img-1.png)\n_Від верфі_\n');
const record = (id, snapshotPath) =>
  upsertRawRecord(db, {
    id, campaign_id: 'c1', source_type: 'news', url: `https://news.example/${id}`,
    canonical_url: null, collected_at: '2026-09-23T00:00:00.000Z', city: 'gdansk',
    topics: '["history"]', rights: 'research_only', content_hash: null, status: 'raw',
    snapshot_path: snapshotPath ?? null, media_dir: null,
  });
record('demo-broken', broken);
record('demo-bare');
db.close();

const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const base = `http://127.0.0.1:${dispatcher.port}`;
const get = (page) => fetch(base + page).then((r) => r.text());
const status = (page) => fetch(base + page).then((r) => r.status);
const strip = (s) => s.replace(/<\/?code>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cardNotes = async (page) =>
  [...(await get(page)).matchAll(/class="note">([\s\S]*?)<\/p>/g)].map((m) =>
    strip(m[1]).replace(/ у \S+\.$/, ' (шлях адрэзаны).')
  );
const brokenNotes = await cardNotes('/record?id=demo-broken');
console.log('broken card:', brokenNotes.length, 'notes');
for (const note of brokenNotes) console.log('  -', note);
const bare = await get('/record?id=demo-bare');
console.log('bare note:', strip(/class="note">([\s\S]*?)<\/p>/.exec(bare)[1]));
console.log('absent status:', await status('/record?id=demo-absent'));
console.log('absent note:', strip(/class="note">([\s\S]*?)<\/p>/.exec(await get('/record?id=demo-absent'))[1]));
const list = await fetch(`${base}/records`);
console.log('records page after all that:', list.status);
await dispatcher.close();
EOF
```

```output
broken card: 2 notes
  - Метаданыя здымку не прачытаны: няма ці пашкоджаны metadata.json (шлях адрэзаны).
  - Выява адсутнічае на дыску: media/broken-img-1.png — подпіс: Від верфі.
bare note: Здымак не запісаны — тэксту здымку няма.
absent status: 404
absent note: Запіс demo-absent у сховішчы не знойдзены.
records page after all that: 200
```
