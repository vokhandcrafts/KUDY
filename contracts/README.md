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
| `schemas/catalog.schema.json` | Versіяваны envelope каталогу: `{catalog_schema_version, generated_at?, routes[], discovery_index?}` |
| `schemas/feedback-target.schema.json` | Мэты водгукаў з `21` §5.1 |
| `schemas/localized-text.schema.json`, `schemas/identifier.schema.json` | Агульныя тыпы: локалі allowlist `be/en/uk`, ідэнтыфікатары `[a-z0-9._-]` ≤ 64 |
| `reader.mjs` | Ядро інтэрпрэтацыі схем + named-правілы + чытанне каталогу |
| `contracts.test.mjs` | Прыёмачная сюіта (у `npm test`) |
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

## Запуск

```
npm test   # уключае contracts/contracts.test.mjs
```
