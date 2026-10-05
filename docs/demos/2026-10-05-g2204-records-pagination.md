# G22.04 — старонкі /records і індэкс спасылак

*2026-10-05T12:53:08Z by Showboat 0.6.1*
<!-- showboat-id: 0f763b70-637d-4108-b3d6-372e0bff0709 -->

G22.04 (issue #609): старонка «Запісы» больш не чытае сховішча цэлікам — правераны ліміт, keyset-курсор апошняга ключа (collected_at з пустымі датамі, url, id) і нармалізаваныя фільтры нясуцца ўнутры курсора; нядопустыя значэнні адхіляюцца з чытэльнай прычынай да любога SQL. Індэкс links(raw_record_id) ствараецца ідэмпатэнтна пры кожным адкрыцці сховішча. Дэма сее сінтэтычную краму (прыкладныя адрасы news.example), падымае рэальны дыспетчар на лакальным порце, праходзіць усе старонкі па курсары і паказвае план запыту падліку спасылак:

```python
import os, pathlib, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8', newline='\n')

SCRIPT = '''
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, upsertRawRecord } from 'file://__ROOT__/tools/collector/store.mjs';
import { startDispatcher } from 'file://__ROOT__/tools/collector/dispatcher.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2204-demo-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = openStore(dbPath);
db.prepare("INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c1', 'gdansk', 'campaign.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')").run();
db.prepare("INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, created_at) VALUES ('c2', 'krakow', 'other.yaml', 'hash', '[]', '[]', '{}', '[]', '2026-09-23T00:00:00.000Z')").run();
const records = [];
const seed = (campaignId, city, url, collectedAt, status) => {
  const record = {
    id: randomUUID(), campaign_id: campaignId, source_type: 'news', url,
    canonical_url: url, collected_at: collectedAt, city, topics: '[]',
    rights: 'research_only', content_hash: null, status,
    snapshot_path: null, media_dir: null,
  };
  upsertRawRecord(db, record);
  records.push(record);
};
for (let k = 0; k < 120; k += 1) {
  seed(k % 2 === 0 ? 'c1' : 'c2', k % 2 === 0 ? 'gdansk' : 'krakow',
    `https://news.example/r${String(k).padStart(3, '0')}`,
    k % 10 === 0 ? null : `2026-09-${String(20 - (k % 20)).padStart(2, '0')}T00:00:00.000Z`,
    k % 3 === 0 ? 'cleaned' : 'raw');
}
for (const campaignId of ['c1', 'c2']) {
  seed(campaignId, campaignId === 'c1' ? 'gdansk' : 'krakow',
    'https://news.example/repeated', '2026-09-15T12:00:00.000Z', 'raw');
}
const dispatcher = await startDispatcher({ dbPath, snapshotsRoot: path.join(dir, 'snapshots'), port: 0 });
const send = async (p) => {
  const r = await fetch(`http://127.0.0.1:${dispatcher.port}${p}`);
  return { status: r.status, body: await r.text() };
};
const rows = (b) => (b.match(/<td><a href="\\/record\\?id=/g) ?? []).length;
console.log(`total=${records.length}`);
const first = await send('/records');
console.log(`default_page_status=${first.status} rows=${rows(first.body)} next=${/Наступная старонка/.test(first.body) ? 'yes' : 'no'}`);
let walked = 0;
const seen = new Set();
let page = '/records?limit=3';
while (page) {
  const r = await send(page);
  walked += rows(r.body);
  for (const m of r.body.matchAll(/\\/record\\?id=([0-9a-f-]{36})/g)) seen.add(m[1]);
  const href = r.body.match(/href="(\\/records\\?[^"]*cursor=[^"]*)"/)?.[1];
  page = href ? href.replaceAll('&amp;', '&') : null;
}
console.log(`traversal_rows=${walked} unique=${seen.size}`);
console.log(`limit0_status=${(await send('/records?limit=0')).status}`);
console.log(`oversized_status=${(await send('/records?limit=101')).status}`);
const p1 = await send('/records?status=raw&limit=10');
const cursor = p1.body.match(/cursor=([A-Za-z0-9_-]+)/)[1];
console.log(`mismatch_status=${(await send(`/records?status=raw&city=gdansk&limit=10&cursor=${cursor}`)).status}`);
const ro = new DatabaseSync(dbPath, { readOnly: true });
const plan = ro.prepare('EXPLAIN QUERY PLAN SELECT (SELECT COUNT(*) FROM links l WHERE l.raw_record_id = r.id) AS links FROM raw_records r').all().map((x) => x.detail).join('\\n');
ro.close();
console.log(`plan=${/SEARCH l USING .*INDEX links_record/.test(plan) ? 'indexed-seek' : 'NO-INDEX'}`);
await dispatcher.close();
'''

root = pathlib.Path.cwd()
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / 'report.mjs').write_text(SCRIPT.replace('__ROOT__', root.as_posix()), encoding='utf-8')
run = subprocess.run(
    ['node', str(tmp / 'report.mjs')],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env, timeout=120)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
report = {}
for line in run.stdout.strip().splitlines():
    for pair in line.split(' '):
        key, _, value = pair.partition('=')
        report[key] = value
assert report['total'] == '122', report
assert report['default_page_status'] == '200', report
assert report['rows'] == '50', report
assert report['next'] == 'yes', report
assert report['traversal_rows'] == report['total'], report
assert report['unique'] == report['total'], report
assert report['limit0_status'] == '400', report
assert report['oversized_status'] == '400', report
assert report['mismatch_status'] == '400', report
assert report['plan'] == 'indexed-seek', report
print(run.stdout.strip())
```

```output
total=122
default_page_status=200 rows=50 next=yes
traversal_rows=122 unique=122
limit0_status=400
oversized_status=400
mismatch_status=400
plan=indexed-seek
```
