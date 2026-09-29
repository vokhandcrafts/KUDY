# G17.12 — дыспетчар калектара: агляд кампаній у браўзеры

*Showboat demo for issue #369 (`tools/collector/dispatcher.mjs`), created 2026-09-29.*

Каманда `dispatch` паднімае чытэльны сервер на `127.0.0.1` — каркас дыспетчара
для рэдактара-гуманітарыя. База адкрываецца з `readOnly: true`, таму ніводзін
запыт не піша ў сховішча; адсутная база — гэта бачны стан «яшчэ нічога не
сабрана», не памылка 500. Абодва блокі ганяюць сапраўдны сервер на эпемаральным
порце і друкуюць толькі дэтэрмінаваныя радкі старонкі (партам і тэмпавая тэчка
ў выводзе не фігуруюць).

Агляд з данымі: кампанія з лічбамі запісаў па статусах, фота, упалыя крокі —
і апошнія крокі журналу з дыягностыкай памылкі:

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';
import { enqueueStep, claimStep, failStep, insertMedia, openStore, upsertRawRecord } from './tools/collector/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
db.prepare(
  "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c1','gdansk','demo.yaml','hash','[]','[]','{}','[]','2026-09-23T00:00:00.000Z')"
).run();
const record = {
  id: 'demo-record-1', campaign_id: 'c1', source_type: 'news', url: 'https://news.example/shipyard',
  canonical_url: null, collected_at: '2026-09-23T00:00:00.000Z', city: 'gdansk',
  topics: '["history"]', rights: 'research_only', content_hash: null, status: 'raw',
  snapshot_path: null, media_dir: null,
};
upsertRawRecord(db, record);
upsertRawRecord(db, { ...record, id: 'demo-record-2', url: 'https://news.example/museum', status: 'cleaned' });
insertMedia(db, {
  rawRecordId: 'demo-record-1', position: 1, alt: 'Stocznia', caption: 'Stocznia Gdańska, 1980',
  sourceUrl: 'https://news.example/shipyard/photo.jpg', file: 'shipyard-img-1.png',
  contentHash: 'hash', widthPx: 640, heightPx: 400, rights: 'research_only',
  collectedAt: '2026-09-23T00:00:00.000Z',
});
const now = '2026-09-23T00:00:00.000Z';
enqueueStep(db, 'c1', 'seed', 'https://news.example/shipyard', now);
const step = db.prepare("SELECT id FROM run_log WHERE kind = 'seed'").get();
claimStep(db, step.id, now);
failStep(db, step.id, 'HTTP 503: backend unavailable', now);
db.close();

const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const html = await (await fetch(`http://127.0.0.1:${dispatcher.port}/`)).text();
await dispatcher.close();
const row = (city) => {
  const cell = new RegExp(`<td>${city}</td>([\\s\\S]*?)</tr>`).exec(html)[1];
  return cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};
console.log('title:', /<h1>([^<]+)/.exec(html)[1]);
console.log('gdansk:', row('gdansk'));
console.log('diagnostic:', /class="diagnostic">([^<]+)/.exec(html)[1]);
console.log('empty state shown:', /Яшчэ нічога не сабрана/.test(html));
EOF
```

```output
title: Дыспетчар калектара
gdansk: 1 (сыравіна) 1 (ачышчана) 0 (выкарыстана) 1 1 c1
diagnostic: HTTP 503: backend unavailable
empty state shown: false
```

Адсутная база — чытэльны прадукт, не збой: сервер падымаецца і паказвае,
што рабіць далей:

```sh
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDispatcher } from './tools/collector/dispatcher.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-demo-'));
const dispatcher = await startDispatcher({
  dbPath: path.join(dir, 'absent.sqlite'),
  snapshotsRoot: path.join(dir, 'snapshots'),
  port: 0,
});
const html = await (await fetch(`http://127.0.0.1:${dispatcher.port}/`)).text();
await dispatcher.close();
const text = html
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&')
  .trim();
console.log('empty page says:', /Яшчэ нічога.*?запісы\./.exec(text)[0]);
console.log('journal says:', /Журнал пусты\./.exec(text)[0]);
EOF
```

```output
empty page says: Яшчэ нічога не сабрана — запусціце run --campaign <файл> , каб назбіраць запісы.
journal says: Журнал пусты.
```
