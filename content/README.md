# Аўтарскі шаблон пакета кантэнту (G02.05)

Гэтая тэчка — стартавы набор для аўтара гіда KUDY: найменшы **валідны** пакет
`author-template/` і той жа пакет з сямю наўмыснымі памылкамі аўтара
`author-template-invalid/`. Абодва трымае камітнутая суіта
`tools/validate/author-template.test.mjs`, таму шаблон не адчапіцца ад
валідатара незаўважна.

Кантэнт прыкладу сінтэтычны: месцы выдуманыя, назвы маюць пазнаку
«(шаблон)». `city_id` — `gdansk`: адзіны актыўны горад MVP (21, разд. 3.2).

## Што дзе

| Тэчка | Што гэта |
|---|---|
| `author-template/` | валідны прыклад: гід з дзвюма кропкамі (base + extended), асобнае месца з offer-прапановай, Collection з `overlap_note`, адзін слоўнік тэм; `be/base` з аўдыё, `en/base` толькі тэкст — абодва рэжымы пласта |
| `author-template-invalid/` | копія прыкладу з сямю тыповымі памылкамі; валідатар адхіляе яе і называе правілы ў дыягностыках |

## Як карыстацца

1. Скапіруйце `author-template/` у асобнае дрэва (напрыклад, `my-guide/`).
2. Заменіце тэксты, назвы, каардынаты і файлы аўдыё — кода ў пакеце няма, JSON рэдагуецца рукамі, медыя — проста файлы ў тэчках.
3. Праверце:

```
node tools/validate/validate-package.mjs --in my-guide
```

Вердыкт — JSON `{ok, errors, warnings}`: `errors` блакіруюць пакет,
`warnings` (напрыклад, `radius-overlap`) — толькі падказка для палявой
праверкі. Кожная памылка нясе кароткае правіла (`rule`) і шлях да сутнасці
(`path`) без змесціва файлаў.

## Структура пакета

```
author-template/
├── route.json                 # гід: stops з стабільнымі id, duration_min, free_stop_count
├── places.json                # месцы: каардынаты, радыус запуску, kind
├── voices.json                # голас на кожную мову пакета
├── discovery.json             # тэмы, offers (гід/месца/падборка), collections
├── places/place-1/public.json # публічная праекцыя — толькі для месца з offer
├── collections/collection-template-1/public.json
└── <locale>/{base,extended}/
    ├── stops.json             # гісторыі пласта: тэкст, транскрыпт, крыніцы, review
    └── audio/<story_id>.m4a   # аўдыё гісторыі: калі тэчка ёсць, файл абавязковы
```

Локалі: `be`, `en`, `uk` (allowlist з 21, разд. 3.2). Пласт без тэчкі
`audio/` — тэкставы: так у прыкладзе жывуць `be/extended` і `en/base`.

## Правілы, якія лёгка парушыць

- **Адзін слоўнік тэм.** Усе тэмы жывуць у адным масіве `themes` у
  `discovery.json`; `offers[].themes` толькі спасылаецца на іх `id`. Назвы —
  у `labels` па мовах.
- **Час.** Дыяпазон `estimated_duration` гіда-прапановы павінен укрываць
  `route.duration_min`, інакш `guide-duration-not-in-range`. `basis`:
  `author_walk` — прайшоў сам, `author_estimate` — ацэнка.
- **Сезон.** `season_recommendations` — `[{season, reason}]`, season ∈
  spring | summer | autumn | winter, `reason` — лакалізаваны тэкст да 280
  знакаў. Пусты масіў азначае not_assessed (21, разд. 3.2); аўтаматычнай
  выставы «усе сезоны» няма.
- **Аўдыё.** Тэчка `audio/` аб'яўляе аўдыё-пласт: тады **кожная** гісторыя
  пласта мае файл `<story_id>.m4a` (`missing-media`); аўдыё без гісторыі —
  `orphan-media`.
- **Зацвярджэнне.** `review.decision` толькі `approved`
  (`content-not-approved`).
- **Шляхі.** У спасылках на файлы няма сегментаў `..`, `.`, `private`,
  `extended` (`unsafe-path`).
- **`schema_version` на аўтарскім discovery не пішуць.** Аўтарскі
  `discovery.json` — частковы індэкс: `schema_version`, `availability` і
  `access` вылічвае зборшчык падчас зборкі (G02.03). Невядомая
  `schema_version` сабранага індэкса бяспечна адхіляецца схемай
  `DiscoveryIndexV1` (21, разд. 3.3) — суіта правярае гэта штампаваннем
  `schema_version: 2`.

## Сем памылак прыкладу і іх правілы

| Дзе ў `author-template-invalid/` | Што сламана | Правіла дыягностыкі |
|---|---|---|
| `route.json` → `stops[0].place_id` | кропка спасылаецца на няіснае месца | `unknown-ref` |
| `route.json` → `cover` | шлях з сегментам `private` | `unsafe-path` |
| `places.json[0].photo` | файла `img/place-1.webp` ў пакеце няма | `missing-media` |
| `places.json[2]` | тое самае месца дададзенае двойчы | `duplicate-id` |
| `be/base/stops.json[0].tier` | base-гісторыя пазначаная як extended | `tier-mismatch` |
| `be/base/stops.json[0].review.decision` | `pending` замест `approved` | `content-not-approved` |
| `discovery.json` → guide offer `estimated_duration` | дыяпазон 90–120 не ўкрывае `duration_min` = 40 | `guide-duration-not-in-range` |

Побач прыклад дае і адно `radius-overlap` **папярэджанне**: дублікат месца
дзеліць каардынаты з арыгіналам. Папярэджанні не блакіруюць.

## Калі не хапае поля або магчымасці

- **Схемы закрытыя** (`additionalProperties: false`): невядомае поле ў JSON
  — памылка `additionalProperties`, а не цішыня.
- **Пашырэнне фармату** — змена кантракту, а не рэдагаванне шаблону: схемы
  `contracts/schemas/`, правілы `09`/`21` і валідатар змяняюцца асобнай
  задачай, і толькі потым абнаўляецца шаблон. Не дадавайце «часовых» палёў
  у свой асобнік — зборшчык іх адкіне.
- **Імпарцёра ў MVP няма.** Аўтар рэдагуе JSON напроста; чалавечы фармат
  (CSV/Markdown + медыя) і канвёртар — задача G12.01. У `content/` няма і
  не павінна быць кода — гэтую мяжу трымае тэст суіты.

## Чаго тут няма

- Зборкі і `lock.json` — G02.03 (`tools/build-bundle/`).
- Публікацыі і адкату каталога — G02.04.
- Рэальнага кантэнту і сапраўдных каардынат.
