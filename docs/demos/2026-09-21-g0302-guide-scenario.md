# G03.02 — сцэнар бясплатнага гіда і склад платнага матэрыялу

Дэма правярае кампазіцыю першага гіда ў аўтарскай прасторы (issue #58) на базе
пайплайну G03.01. Да трох кропак Гданьска — ратуша, двор Артуса, касцёл Св. Марыі —
дададзеныя base/extended-драфты з цытатамі і локатарамі друку (крыніца тая ж:
EB1911, том VII, ст. 824–825), а файл `scenarios/gdansk-first-walk.json` звязвае
кропкі ў праект прагулкі: парадак, час, крыніцы, платная каштоўнасць. Чэкер
пашыраны правіламі ўзроўню гісторый і сцэнара. Вывад дэтэрмінаваны.

Прастора праходзіць праверку цалкам — разам з новым сцэнарам:

```sh
node tools/validate/validate-authoring.mjs --in authoring/gdansk
```

```output
{"ok":true,"errors":[],"warnings":[]}
```

Base-гісторыя, якая гандлюе, падае з іменаванай дыягностыкай `base-purchase-hook`
(13 §3: у наратыве няма рэкламнага закліку купіць пашырэнне):

```sh
node tools/validate/validate-authoring.mjs --in fixtures/authoring-pipeline/invalid-base-purchase-hook | grep -o 'base-purchase-hook'
```

```output
base-purchase-hook
```

Сцэнар, што згубіў рэальны драфт кропкі, падае з `scenario-unknown-draft-ref`:

```sh
node tools/validate/validate-authoring.mjs --in fixtures/authoring-pipeline/invalid-scenario-unknown-draft-ref | grep -o 'scenario-unknown-draft-ref'
```

```output
scenario-unknown-draft-ref
```

Праект прагулкі: тэма і тры кропкі з base/extended-складам і ўласнай ацэнкай
часу (усё чакае рэвю аўтара):

```sh
node --input-type=module -e "import fs from 'node:fs'; const s = JSON.parse(fs.readFileSync('authoring/gdansk/scenarios/gdansk-first-walk.json', 'utf8')); console.log(s.theme); for (const st of s.stops) console.log(st.place_id, st.walk_minutes + ' хв', st.drafts.join(', '));"
```

```output
Ганзейскае багацце: вуліца, рынак і храм
place_gdansk_townhall 15 хв gdansk-townhall-base-be, gdansk-townhall-extended-be
place_gdansk_artushof 10 хв gdansk-artushof-base-be, gdansk-artushof-extended-be
place_gdansk_stmary 20 хв gdansk-stmary-be, gdansk-stmary-extended-be, gdansk-stmary-en
```

Усе прызнаненыя агляды аўтара супадаюць з перагенераванымі:

```sh
node --input-type=module -e "import fs from 'node:fs'; import { renderReviewReport } from './tools/validate/authoring-review-report.mjs'; let n = 0; for (const name of fs.readdirSync('authoring/gdansk/drafts').filter(x => x.endsWith('.json')).sort()) { const d = JSON.parse(fs.readFileSync('authoring/gdansk/drafts/' + name, 'utf8')); if (fs.readFileSync('authoring/gdansk/review/' + d.draft_id + '.review.md', 'utf8') !== renderReviewReport('authoring/gdansk', d.draft_id) + '\n') throw new Error(d.draft_id); n++; } console.log(n + ' review reports are in sync');"
```

```output
7 review reports are in sync
```

Поўная прыёмачная сюіта: 28 негатыўных фікстур (па адной парушэнні),
пазітыўныя праверкі крытэраў #58, сінтэтычны цыкл да approved, брама
`content-not-approved`, вартавы «бандл не чытае authoring/», пашкоджаны ўвод —
дыягностыкі, не крэх:

```sh
node --test --test-reporter=tap --test-concurrency=1 tools/validate/authoring.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 41
# pass 41
# fail 0
```
