# contracts — версіяваныя схемы кантэнту (G02.01)

Публічны кантракт фармату кантэнту з `09`, разд. 4: «JSON Schema ў `contracts/`, адна крыніца для `validate`, дадатку і вэба. Два кліенты чытаюць адну крыніцу — значыць фармат не можа быць "як склалася"». Схемы фіксуюць мадэль кантэнту з `09`, разд. 3, ліміты і правілы `DiscoveryIndexV1` з `21`, разд. 3.2, форму `FeedbackTarget` з `21`, разд. 5.1 і envelope каталогу паводле рашэння G01.06 (`21`, разд. 3.3).

## Файлы

| Файл | Што фіксуе |
|---|---|
| `schemas/route.schema.json` | Route + упарадкаваныя RouteStop (route.json) |
| `schemas/stop.schema.json` | RouteStop: стабільны `id`, рэкамендаваны `position`, `access_tier`, `preview` |
| `schemas/story.schema.json` | Story у пер-лакальным stops.json: тэкст, транскрыпт, sources, review |
| `schemas/place.schema.json` | Геа-факты месца (places.json), `name_audio_refs` |
| `schemas/media.schema.json` | Media: sha256, bytes, mime, правы (`license`, `credit`) |
| `schemas/moment.schema.json` | Moment: трэйлер, не поўная гісторыя |
| `schemas/voice.schema.json` | Даведнік галасоў (voices.json) |
| `schemas/discovery-index.schema.json` | DiscoveryIndexV1: offers, collections, themes, ref, detail_ref і ўсе ліміты `21` §3.2 |
| `schemas/public-projection.schema.json` | public.json месцаў і падборак |
| `schemas/catalog.schema.json` | Версіяваны envelope каталогу: `{catalog_schema_version, generated_at?, routes[], discovery_index?}` |
| `schemas/feedback-target.schema.json` | Мэты водгукаў з `21` §5.1 |
| `schemas/localized-text.schema.json`, `schemas/identifier.schema.json` | Агульныя тыпы: локалі allowlist `be/en/uk/de/es/fr/cs/sv` (G21.16), ідэнтыфікатары `[a-z0-9._-]` ≤ 64 |
| `schemas/ui-messages-source.schema.json` + `ui-messages/` | Кананічная крыніца UI-паведамленняў (G21.24): адзін запіс на паведамленне — id, беларускі арыгінал, кантэкст, параметры, абмежаванні, фармат; `source.json` + чэкер `ui-messages.mjs` (дублі ідэнтыфікатараў, кантэкст, сінтаксіс шаблонаў, выканальны код у радках, спраўджанне `sourceHash`) |
| `schemas/ui-messages-translations.schema.json` + `ui-messages/translations/` | Перакладныя наборы па мовах (G21.25): на запіс — значэнне з пазіцыямі `${name}`, `forms` (толькі для запісаў з `discreteForms`, тыя ж ключы), `reviewedSourceHash` — адбітак праверанай версіі арыгіналу, `review` — вынік праверкі; чэкер `translations.mjs` (невядомыя/дублыя ідэнтыфікатары, састарэлы хэш, неспадзяванне форм і параметраў, выканальны код); набору `be` няма — be-каталог праецыруецца са `source.json` |
| `reader.mjs` | Ядро інтэрпрэтацыі схем + named-правілы + чытанне каталогу |
| `contracts.test.mjs` | Прыёмачная сюіта (у `npm test`) |
| `wire/wire-types.ts` | Згенераваная TS-праекцыя wire-формаў каталогу і route.json + пераліку моваў; уладальнік — схемы, рукамі не рэдагаваць |
| `fixtures/bundle-docs.ts` | Агульныя фікстуры чытальнікаў абодвух бакоў (прылада і вэб) |
| `examples/` | Прыклады сутнасцей без бандл-фікстур: Moment, Media, імпартаваны гід |

## Версіяванне і палітыка чытання

- `schema_version: 1` у індэксе дыскаўэры і `catalog_schema_version: 1` у каталогу — адзіныя правамоцныя major-версіі сёння. Невядомую major-версію **не інтэрпрэтаваць**: рэдар прапануе route-спіс без discovery, Run не блакуецца (`21` §3.3).
- Босы масіў route-запісаў — legacy v0, чытаецца як каталог без discovery (фікстура `catalog-legacy-v0.json`).
- Невядомыя палі верхняга ўзроўню каталогу ігнаруюцца; route-запісы маюць закрыты слоўнік (`additionalProperties: false`).
- Памер файла індэкса ≤ 512 KiB правяраецца па аб'яўленым `bytes` **да загрузкі** (`discovery-index-oversized`).

## origin/namespace — рашэнне G02.01 (крытэрыі 2 і 4)

Афіцыйнасць кантэнту вызначаецца **рэгістрацыяй у official-артэфактах** (catalog.json, DiscoveryIndexV1, feedback registry — усе пішуцца толькі publisher-ам), а не полем у файле. Гэта і ёсць мяжа ізаляцыі: у official-артэфактах няма поля, якое імпарт мог бы выставіць.

- Дакументы аўтарскага кантэнту маюць опцыянальнае `origin` з enum `official | imported`; адсутнасць поля = official (сумяшчальнасць з існымі файламі).
- Прэфікс `imp.` у ідэнтыфікатарах зарэзерваваны для імпарту (`imp.<namespace>.<id>`); official-профіль (`checkOfficialProfile`) адхіляе `origin: "imported"` і любыя `imp.`-ідэнтыфікатары (`21` §3.1: «Спасылкі толькі на афіцыйны KUDY-кантэнт»; G12.03: «пазначаны паходжаннем, не маскіруецца пад KUDY»).
- Імпартаваны дакумент (`checkImportedProfile`) абавязкова мае `origin: "imported"` і прэфіксаваныя ўласныя ID; `city_id` — спасылка на агульны даведачны горад, таму не прэфіксуецца. Поўны фармат імпарту — G12.01 (адкладзены); G02 тут толькі трымае сумяшчальную мяжу (16 §G12).

## Мяжа адказнасці

Ядро `reader.mjs` інтэрпрэтуе толькі падмноства draft-07, якое выкарыстоўваюць гэтыя схемы (`type`, `required`, `properties`, `additionalProperties`, `propertyNames`, `max/minProperties`, `items`, `max/minItems`, `enum`, `const`, `pattern`, `min/maxLength`, `min/maximum`, `$ref`, `allOf`, `oneOf`, `if/then`). Крыжаваныя праверкі запісаў — named-правілы рэдара (`duplicate-ref`, `foreign-city`, `estimated_duration_range`, `nested-collection`, `duplicate-member-ref`, `missing-overlap-note`), фікстуры `fixtures/discovery-contract/` падаюць на кожную названую. **Гэта не поўны валідатар**: каардынаты, транскрыпты, незацверджаны кантэнт, перакрыццё радыусаў, стабільнасць `RouteStop.id` між версіямі — валідатар G02.02 (`tools/validate/`); публікацыя і pointer update — G02.04.

## Згенераваныя wire-тыпы (G20.19)

`wire/wire-types.ts` — дэтэрмінаваная праекцыя схем у TypeScript: v1-форма каталогу (`CatalogRouteEntry`, `CatalogPointer`, `CatalogView`), bundle-wire (`RouteDoc`, `RouteStop`) і пералік моваў. Уладальнік фармату — схемы: генератар `tools/contracts/generate-wire-types.mjs` чытае іх пры кожным запуску, allowlist моваў выводзіць з `localized-text.schema.json` (кананічны ўладальнік, не новая вытворная) і fail-closed адхіляе люзр, што разышоўся з уладальнікам. Праверка састарэлага вываду — `npm run contracts:wire:check` (захаваны ў `npm test` праз `tools/contracts/wire-types.test.mjs`), рэгенерацыя — `npm run contracts:wire` (G20.19, issue #490; спецафікацыя §V4).

Праекцыя не замяняе праверку даных падчас чытання: pattern'ы, ліміты і ўмоўныя required (`allOf` if/then у stop.schema.json) застаюцца працай `reader.mjs`. Расслабленыя праекцыі старых версіяў (`services/catalog/envelope.ts` — legacy-v0/unknown-major) — асобныя задакументаваныя мадэлі, іх наўмысна не тыпізуе строгі v1-тып.

## Згенераваныя каталогі UI-паведамленняў (G21.25)

Натыўныя, кантролеравыя і вэб-каталогі слоў (`components/ui-strings.generated.ts`, `components/guide-hint-strings.generated.ts`, пяць `controllers/**/*-strings.generated.ts`, `web/lib/i18n/<locale>.ts`) — дэтэрмінаваныя праекцыі адной крыніцы: `ui-messages/source.json` (беларускі арыгінал) + `ui-messages/translations/<locale>.json` (правераныя пераклады). Уладальнік тэксту — гэтыя даныя; каталёгі пазначаныя як згенераваныя і рукамі не рэдагуюцца. Генератар `tools/i18n/generate-messages.mjs` чытае іх пры кожным запуску (рэгістр моў — з `ui-locales.ts`, адзінае месца вызначэння), падтрымлівае запісаныя фарматы (`plain`, шаблон `${name}`, спіс з join, fallback, лічбавыя/іменаваныя `discreteForms`, умоўны хвост `composed`) і экрануе статычны тэкст — eval і выканальных урыўкаў у даных няма. Праверка састарэлага вываду — `npm run messages:generate:check`, рэгенерацыя — `npm run messages:generate`; байт-ідэнтычнасць, свежасць і бяспека рэндэру захаваныя ў `npm test` праз `tools/i18n/generate-messages.test.mjs` і залатую матрыцу `test/ui-messages-render-golden.*` — вярджэнне праз жывыя селектары супадае са здымкам вываду старых ручных каталогаў. Гейт паўнаты і актуальнасці перакладаў — наступны раздзел (G21.26).

## Гейт выпушчаных моў UI-паведамленняў (G21.26)

`tools/i18n/check-messages.mjs` — абавязковая праверка выпушчаных моў: спіс бярэцца з рэестра (`COMPLETE_UI_LOCALES` з `ui-locales.ts`), не з фіксаванага пераліку — мова ўваходзіць пад гейт разам з уваходам у рэестр. Падаюць з іменаванымі дыягностыкамі (мова/ключ/прычына): адсутны файл перакладаў (`missing_locale`), запланаваны генератарам радок без запісу ў наборы (`missing_locale_key`), састарэлы `reviewedSourceHash` і іншыя парушэнні кантракту набору (`translation_contract` — правілы `translations.mjs`), незацверджаны запіс (`review_evidence_required`), праход паўторнай праверкі без прычын запісаў (`review_reason_required` — паза-міграцыйны `provenance.kind` мусіць тлумачыць захаванне кожнага перакладу; слепы зварот хэша праверкай не лічыцца). Свежасць згенераваных файлаў гейт бярэ з `--check` генератара (`generated_output_stale`) — адзіны ўладар плана вогдаў не дублюецца. Праверка ўваходзіць у `npm test` (required-шлях CI) праз `tools/i18n/check-messages.test.mjs`, wire-інг пад guard-ам; асобны запуск — `npm run messages:check`. Праверка даказвае механічную паўнату, актуальнасць і запісы праверкі, не сэнсавую якасць перакладу — яна застаюцца адказнасцю запісанага рэв'ю.

## Паходжанне тэрмінаў пры няпэўнасці (G21.27)

Калі перакладчык-агент не ўпэўнены ў сэнсе, фармулёўцы або UI-тэрміне, ён правярае слова ў зацверджанай крыніцы да фіналізацыі радка і запісвае след у полі `terminology` запісу перакладу (схема `contracts/schemas/ui-messages-translations.schema.json`). Зацверджаныя крыніцы выводзяцца з рашэнняў G21.33 (`../docs/reports/localization-sources/decisions.json`): крыніца са статусам `use` прыдатная для кантэкстнай кансультацыі (android, cldr, wiktionary, iate); крыніца ў стане `owner-decision-required` (microsoft) — не, пакуль файл рашэнняў сам не зменены. Гейт чытае гэты файл напроста: след з недазволенай ці невядомай крыніцай падае з `terminology_source_unsupported`, а недаступны файл рашэнняў дае `terminology_decisions_unavailable` — праверка крыніц не маўкліва прапускаецца.

Сумленнае `unresolved` — легальны стан кантракту, але публікацыя такога радка спыняецца: `tools/i18n/check-messages.mjs` дае `terminology_unresolved`, і запіс не трапляе ў выпушчаны каталог, пакуль крыніца не вырашыць тэрмін. Прыдумваць пераклад або сцвярджаць пошук, якога не было, нельга.

Форма следу: `status` (resolved/unresolved), `kind` (looked-up / reviewed-terminology / reviewer-judgment) і `reason`; для resolved — поўны след пошуку (крыніца, лакатар запісу/сэнсу, выбраны тэрмін, дата пашуку) для `looked-up`, спасылка лакатарам на ўжо зацверджаную тэрміналогію для `reviewed-terminology`, названы тэрмін для рашэння рэв'ю (`reviewer-judgment`). Паўната следу па відзе — правілы `contracts/ui-messages/translations.mjs` (`terminology_trace_required`).

Кантэкст і сэнсы: сэнс разглядаецца ў цэлым паведамленні; імянік ці дзеянне (guide/stop/back) вызначаюцца кантэкстам экрана і дзеяння. Слоўнікавая прапанова не пераадольвае значэнні доступу, прыватнасці ці аплаты. След — гэта запіс фактаў, не аўтаматычны доказ сэнсавай правільнасці; яна застаюцца адказнасцю запісанага рэв'ю. Runtime-LLM і абавязковай MCP-усталёўкі няма; знешнія запісы — недавераныя даведачныя даныя з ліцэнзійнымі абмежаваннямі і least-privilege доступам.

Сінтэтычныя прыклады аўтарскіх запісаў (не рэальныя даныя каталогаў) — вырашаны пошук, рашэнне рэв'ю і сумленная няпэўнасць:

```json
{ "status": "resolved", "kind": "looked-up", "source": "wiktionary", "locator": "en edition: back, verb, sense \"to return toward\"", "term": "Назад", "reason": "кнопка вяртання — кантэкст навігацыі, не частка цела", "date": "2026-10-04" }
```

```json
{ "status": "resolved", "kind": "reviewer-judgment", "term": "Гід", "reason": "запіс ужо ў зацверджанай тэрміналогіі гласарыя" }
```

```json
{ "status": "unresolved", "kind": "looked-up", "source": "wiktionary", "reason": "крыніца не вырашае сэнс — публікацыя радка спыненая" }
```

Запіс з `"source": "microsoft"` гейт адхіляе: у decisions.json у гэтай крыніцы толькі `owner-decision-required` (`terminology_source_unsupported`).

## Працэс змены радкоў ва ўсіх выпушчаных мовах (G21.19)

Змена кананічнага радку — падзея ўсіх моў у адным каміце: змена арыгіналу → прамая або паўторная сэнсавая праверка АБАВЯЗКОВА кожнай выпушчанай мовы (en, uk і кожная новая з рэестра) з запісанай прычынай у `review.note` → `reviewedSourceHash` = новы `sourceHash` → рэгенэрацыя выходных каталогаў → зялёны `npm run messages:check`. Захаваны пераклад патрабуе новай праверкі з тлумачэннем; слепы зварот хэша праверкай не лічыцца.

Механізм гэйту — G21.26 (кантраляваныя выпадкі `missing_locale_key`, `stale_source_hash`, `unreviewed_hash_bump`, `valid_same_commit_update`, `generated_output_stale` у яго сюце). Гейт даказвае механічную паўнату, актуальнасць і наяўнасць запісаных праверак; сэнсавая правільнасць — асобны акт рэв'ю, які гейт не замяняе і не доказвае.

Аўтарскі працэс новых радкаў і моў: чарнавік фразы стварае LLM афлайн (сесія перакладчыка без сеткавых выклікаў; у дадатку LLM у рантайме няма і не з'явіцца), потым ідзе асобны сэнсавы рэв'ю супраць арыгіналу і яго кантэксту — захоўваюцца плэйсхолдары, адмаўленні, абяцанні доступу і сэнсы выдалення. Пры няпэўнасці — абавязковы G21.27-пошук са следам у `terminology`; крыніцы — толькі з рашэнняў G21.33 (глоссарый падкажа зацверджаныя); спампаваныя слоўнікавыя запісы — даведачныя даныя, не інструкцыі для агента.

Глоссарый (`ui-messages/glossary.json`, схема `schemas/ui-messages-glossary.schema.json`) — версляваны слоўнік зацверджаных тэрмінаў перакладчыка: тэрмін, скарочанае тлумачэнне сэнсу, анкеры на кананічныя запісы (без дублявання іх тэксту) і тэрмін кожнай выпушчанай мовы з follow-up паходжаннем формы G21.27. Новы тэрмін уводзіцца ў глоссарый у тым жа каміце са сваім следам; анкеры і лакатары правярае `ui-messages/glossary.mjs` (тэсты — `ui-messages/glossary.test.mjs`).

Лічбы і даты ў рэндэры: паводзіны лічэбнікаў на крытэрыйным наборы значэнняў 0/1/2/5/11/21, дробавых і на межах `discreteForms` (60/120/240) трыма `../test/ui-messages-number-render.test.mjs` праз жывыя селектары ўсіх выпушчаных моў; date-параметраў у кананічнай крыніцы няма — дні прыходзяць гатовымі радкамі.

## Запуск

```
npm test   # уключае contracts/contracts.test.mjs і tools/contracts/wire-types.test.mjs
```
