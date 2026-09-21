# Аўтарская прастора — працэс Source → Fragment → Claim → Draft → approved

Працоўныя файлы вытворчасці кантэнту па [07_content_pipeline](../docs/07_content_pipeline.md).
Гэта **не** кантэнт-бандл і **не** аўтарскі пакет з `content/`: сюды нічога не збираецца і
нічога не публікуецца. Адзіны шлях у бандл — аўтар сам пераносіць зацверджаны тэкст у
аўтарскі пакет (`content/`), дзе яго чакае брама `content-not-approved` валідатара.
Праверка прасторы: `node tools/validate/validate-authoring.mjs --in authoring/gdansk`.

## Этапы і файлы

| Этап | Файл | Што нясе |
|---|---|---|
| Source | `sources.json` | `source_id`, бібліяграфія, `rights` (`public_domain` / `licensed` / `research_only` / `author_own`), спасылка на файл/URL |
| Fragment | `fragments.json` | `fragment_id`, `source_id`, локатар (`volume`/`page`/`paragraph`), дакладная цытата |
| Claim | `claims.json` | `claim_id`, атамарнае цверджанне, `support` (фрагменты), `mark` (`ok`/`rejected`) ад аўтара |
| Draft | `drafts/<draft_id>.json` | блокі тэксту; факт-блокі цягнуць `claims`; `tier` (`base`/`extended` — канон `contracts/schemas/story.schema.json`); у extended — `value`; `review` паводле канону `09` §3 (`by`/`at`/`decision`) |
| Агляд | `review/<draft_id>.review.md` | згенераваны агляд: кожны факт побач з цытатай і локатарам — тое, што чытае аўтар |
| Сцэнар | `scenarios/<scenario_id>.json` | праект гіда: тэма, кропкі (`place_id`, `walk_minutes`), спасылкі на драфты і крыніцы, сезонныя рэкамендацыі |

Локатар: `paragraph` лічыцца ад пачатку артыкула крыніцы, перанос сказа на наступную
старонку друку новы абзац не пачынае; `page` — старонка друку, дзе літарна стаіць цытата.

## Статусы і хто іх ставіць

- `review.decision` — канонічны слоўнік са схем гісторыі: `pending` / `approved` / `rejected`.
- `mark` цвярджэння — `ok` / `rejected`, ставіць толькі чалавек-аўтар падчас рэвю, з
  `mark_by` і `mark_at` (`YYYY-MM-DD`).
- «Зацвердзіў» у гэтым дрэве — толькі запіс чалавека ў `review`: без `by` і `at`
  зацвярджэнне не прайдзе праверку. Ніякі скрыпт не ставіць `approved` сам.

## Правілы, якія машына правярае (validate-authoring)

- спасылкі цэлыя: фрагмент → крыніца, цвярджанне → фрагмент, блок → цвярджанне,
  пераклад → драфт (`unknown-*-ref`);
- у кожнага факта ёсць цвярджэнні (`fact-without-claim`), нефакт-блок цвярджэнняў
  не нясе (`claims-on-non-fact-block`), у цытаты і локатара няма
  пустых (`missing-quote`, `missing-locator`);
- прычынна-выніковыя пабудовы ў факт-блоках павінны стаяць у тэксце цытаванага
  цвярджэння (`unbacked-connection`) — галоўная скупая памылка з `07`, раздзел «Рызыкі»;
- зацверджаны драфт цягне толькі адзначаныя аўтарам (`ok`) цвярджэнні
  (`unmarked-claim-in-approved`) і ніякіх адхіленых (`rejected-claim-cited`);
- зацвярджэнне без запісу чалавека (`by`/`at`) не праходзіць (`approval-without-reviewer`);
- адзнака аўтара (`ok`/`rejected`) нясе запіс чалавека — непусты `mark_by` і дату
  `mark_at` (`mark-without-reviewer`);
- пераклад — новы Draft: уласны запіс рэвю, не скапіраваны з мовы-крыніцы
  (`translation-copied-review`), спасылка `source_draft_id` цэлая (`unknown-draft-ref`);
- ідэнтыфікатары ўнікальныя (`duplicate-id`), `draft_id` супадае з імём файла
  (`<draft_id>.json`, `draft-id-mismatch`), слоўнікі (`rights`, `kind`, `tier`,
  `decision`, `mark`) — толькі дапушчальныя значэнні (`invalid-value`).

Правілы ўзроўню гісторый (G03.02, issue #58):

- base-драфт пачынаецца з блока `orientation` (`missing-orientation`) — гісторыя
  зразумелая пры падыходзе з любога боку (`13` §2);
- у base-драфце няма гандлёвага закліку (`base-purchase-hook`) і не вісяць
  «працяг у пашыранай версіі» (`base-paid-dangle`) — бясплатная гісторыя
  завершаная сама па сабе і не абрываецца дзеля пакупкі (`13` §3–§4);
- extended-драфт мае непустае `value` (`extended-without-value`) — пазначанае
  каштоўнасць, якую дадае платнае.

Правілы сцэнара (G03.02): сцэнар спасылаецца толькі на існыя драфты
(`scenario-unknown-draft-ref`) і крыніцы (`scenario-unknown-source-ref`); кожная
кропка нясе спасылы на крыніцы (`scenario-place-without-source-refs`), а
`place_id` яе драфтаў супадае з кропкай (`scenario-draft-place-mismatch`); імя
файла супадае з `scenario_id` (`scenario-id-mismatch`); сезонная рэкамендацыя —
толькі з прычынай (`season-recommendation-without-reason`); сцэнар з платнымі
кропкамі мае `paid_note` (`scenario-paid-note-missing`). Слоўнік сезонаў і форма
`{season, reason}` — канон `contracts/schemas/discovery-index.schema.json`
(`21` §3.2): пусты масіў азначае «не ацэнена», не «падыходзіць заўсёды» (`20`).

Слоўнік блокаў: `orientation` (увага без фактаў), `fact` (толькі з цвярджэннямі),
`artistic` (пазначаная аўтарская асацыяцыя — не факт, паводле `13` §2).

## Сцэнар гіда (G03.02)

`scenarios/<scenario_id>.json` — **праект** сцэнара гіда, не зацверджаны сцэнар:
тэму, назву і склад кропак вызначае аўтар (`13` §1), сцэнар толькі рыхтуе гэты
выбар да рэвю. Кожны драфт мае `tier`: `base` — бясплатная гісторыя, завершаная
сама па сабе (`13` §4), `extended` — платнае пашырэнне, якое дадае асобную
гісторыю той самай кропкі (P01 у `15`), з пазначаным `value` — што дадае платнае.

Палі сцэнара: `city` — горад (`city_id`), `locale` — мова гіда; `theme` — тэма
прапановы; `path_minutes` — арыенцір рэкамендаванага
шляху (40–60 хвілін, `13` §1); `stops[]` — кропкі ў рэкамендаваным парадку:
`place_id`, `title`, `walk_minutes` (уласная ацэнка аўтара, чакае пацверджання),
`drafts` (драфты кропкі, base і extended), `refs` (спасылы на крыніцы з
`sources.json` — «правераны refs» для уваходу G15.02), `season_recommendations`
— форма `{season, reason}` з канону `21` §3.2: `season` — слоўнік канону
(spring/summer/autumn/winter), `reason` — радок (заготовка аўтара) або канонавы
лакалізаваны аб'ект (be/en/uk, як у `discovery-index.schema.json`); пры экспарце
ў discovery-index `reason` робіцца аб'ектам; пусты масіў = «не ацэнена»;
`paid_note` —
адзін сказ пра тое, што дадае платны пласт усяго гіда. Кропкі сцэнара — будучыя
уваходы G15.02: свае тэксты, правераныя спасылы, сезонныя прычыны; нічога не
капіруецца з рэферэнснага сайта (`20`).

## Каманды

```
node tools/validate/validate-authoring.mjs --in authoring/gdansk
node tools/validate/authoring-review-report.mjs --in authoring/gdansk --draft gdansk-stmary-be
```

Агляд перакладу генеруюць гэтай жа камандай па яго `draft_id` — ён таксама чакае
паўторнага рэвю аўтара, хоць бы мова-крыніца ўжо была зацверджаная.

## Правы і межы

- Дакладныя цытаты ў фінальным тэксце — толькі з `public_domain` ці `licensed` з
  атрыбуцыяй; з `research_only` бяруць факт, а тэкст пішуць сваімі словамі (`07`).
- Тэксты крыніц захоўваюцца па-за рэпазітарыем з рэгулярным бэкапам; у рэпазітар
  трапляе толькі рэгістр з метаданымі і цытаты-фрагменты.
- LLM працуе толькі ў вытворчасці (ingest, extract, compose): ніякі выклік мадэлі не
  трапляе ў дадатак і не адкрывае рэвю-крок сам.
