# G21.24 (issue #557): кананічная крыніца UI-паведамленняў

*Showboat дэма задачи #557: `contracts/ui-messages/source.json` + чэкер
`ui-messages.mjs` — адзін асноўны запіс на кожнае UI-паведамленне (234
запісы: усяго фактычнага інвентару сямі каталогаў + картка падказак), з
кантэкстам, параметрамі і дэтэрмініраваным `sourceHash`. Праверка зачыненая:
змена арыгіналу без перахэшавання — іменаваны правал. Створана 2026-10-04.*

<!-- showboat-id: g2124-source-record -->

Фактычны інвентар зашытай крыніцы: колькасць запісаў і размеркаванне па
каталогах (чытач зараджае рэальны файл і правярае кантракт кожнага запісу):

```sh
node -e "import('./contracts/ui-messages/ui-messages.mjs').then(m => { const d = m.loadUiMessagesSource(); const byDomain = {}; for (const r of d.records) { const dom = r.id.split('.').slice(0,2).join('.'); byDomain[dom] = (byDomain[dom]||0)+1; } console.log('records', d.records.length); console.log(Object.entries(byDomain).map(([k,v])=>k+'='+v).join(' ')); })"
```

```output
records 234
native.chrome=72 native.guideHint=4 native.nearby=18 native.offer=9 native.place=23 native.preview=12 native.run=50 web.ui=46
```

Крытэр 5 — дублі ідэнтыфікатараў адхіляюцца іменаваным правілам (адкрытая
захвятка чэкера на фікстуры з двума запісамі аднаго id):

```sh
node -e "import('./contracts/ui-messages/ui-messages.mjs').then(m => { const r = { id: 'test.x', source: 'Слова', context: 'Кантэкст', format: 'plain', parameters: [], migratedFrom: ['t#x'], sourceHash: '' }; r.sourceHash = m.sourceHash(r); const dup = { ...r, context: 'Іншы кантэкст' }; dup.sourceHash = m.sourceHash(dup); const v = m.checkUiMessages({ source_schema_version: 1, source_locale: 'be', records: [r, dup] }); console.log(v.ok, '|', v.errors.map(e => e.rule + ' at ' + e.path).join(', ')); })"
```

```output
false | duplicate_key_denied at $.records[id=test.x].id
```

Крытэры 3–4 — адбітак: змена арыгіналу мяняе `sourceHash`, рэдакцыя
паходжання (`migratedFrom`) — не:

```sh
node -e "import('./contracts/ui-messages/ui-messages.mjs').then(m => { const r = { id: 'test.x', source: 'Слова', context: 'Кантэкст', format: 'plain', parameters: [], migratedFrom: ['t#x'], sourceHash: '' }; const before = m.sourceHash(r); r.source = 'Іншае слова'; console.log('source edit changes hash:', m.sourceHash(r) !== before); r.source = 'Слова'; r.migratedFrom.push('other#x'); console.log('provenance edit keeps hash:', m.sourceHash(r) === before); })"
```

```output
source edit changes hash: true
provenance edit keeps hash: true
```

Зачыненая праверка (implementation-rules 1): тэхнічны эксперымант рэверту —
падмена аднаго слова ў `source.json` без перахэшавання ламае прыёмку
`source_hash_mismatch_denied` (зачырваненне іменаванае; эксперымент
сканчаўся аднаўленнем файла). Сют чэкера і інвентару на чыстым дрэве:

```sh
node --test --experimental-strip-types contracts/ui-messages/ui-messages.test.mjs test/ui-messages-inventory.test.mjs 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

```output
ℹ tests 22
ℹ pass 22
ℹ fail 0
```
