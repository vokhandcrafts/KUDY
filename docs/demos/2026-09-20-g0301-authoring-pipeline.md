# G03.01 — працэс Source → Fragment → Claim → Draft → approved

Дэма правярае аўтарскі працэс кантэнту па `docs/07_content_pipeline.md`
(issue #123). Першы рэальны ўваход — публічнадаменая крыніца 1911 года
(Encyclopædia Britannica, том VII, ст. 824–825) прайшла ўсе этапы:
рэгістр крыніц → фрагменты з дакладнымі цытатамі і локатарамі друку →
атамарныя цвярджэнні → беларускі драфт пра касцёл Св. Марыі + пераклад-драфт.
Чэкер правярае цэласнасць спасылак, факт-без-цвярджэння, прычынныя пабудовы
без апоры ў цвярджэннях і запіс чалавека ў зацвярджэнні. Вывад дэтэрмінаваны.

Прастора праходзіць праверку цалкам (ніводная выдуманая сувязь не прайшла
за факт):

```sh
node tools/validate/validate-authoring.mjs --in authoring/gdansk
```

```output
{"ok":true,"errors":[],"warnings":[]}
```

Выдуманая прычынна-выніковая сувязь у драфце падае з іменаванай
дыягностыкай `unbacked-connection` (фікстура з сеянай памылкай — сказ
«таму што», якога няма ў цытаваным цвярджэнні):

```sh
node tools/validate/validate-authoring.mjs --in fixtures/authoring-pipeline/invalid-unbacked-connection | grep -o 'unbacked-connection'
```

```output
unbacked-connection
```

Агляд аўтара — тое, што бачыць чалавек на рэвю-кроку: тэкст факта побач з
дакладнай цытатай, локатарам друку і правамі крыніцы (раздзел «Блокі»
згенераванага агляду):

```sh
node tools/validate/authoring-review-report.mjs --in authoring/gdansk --draft gdansk-stmary-be | sed -n '16,23p'
```

```output
### bl-002 — fact — факт

> Стары горад сустрэне вас сярэднявеччам: энцыклапедыя 1911 года адзначала, што сярод вялікіх гарадоў Германіі Данциг амаль адзін захаваў той выгляд.

- [cl-001] На 1911 год Данциг амаль адзін з вялікіх гарадоў Германіі захоўваў маляўнічы сярэднявечны выгляд.
  - Адзнака аўтара: не адзначана
  - Цытата: „Danzig almost alone of larger German cities still preserves its picturesque medieval aspect.“
  - Локатар: том VII, ст. 824, абзац 2 — src-eb1911-danzig — Danzig. — In: Encyclopædia Britannica. 11th ed. Vol. 7 (Converse, George Thomas — Day, Ernest) (public_domain, 1911)
```

Поўная прыёмачная сюіта: 15 негатыўных фікстур (па адной парушэнні),
сінтэтычны цыкл да approved, брама `content-not-approved` на адзіным шляху
ў бандл, вартавы «бандл не чытае authoring/», пераклад асобным драфтам,
пашкоджаны ўвод — дыягностыкі, не крэх:

```sh
node --test --test-reporter=tap --test-concurrency=1 tools/validate/authoring.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 23
# pass 23
# fail 0
```
