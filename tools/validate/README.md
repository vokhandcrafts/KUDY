# tools/validate — валідатар пакета кантэнту з дыягностыкай (G02.02)

Поўны валідатар аўтарскага пакета кантэнту перад зборкай (G02.03) і публікацыяй (G02.04). Адзін крыніца інтэрпрэтацыі схем — `contracts/reader.mjs` (`09`, разд. 4: фармат — публічны кантракт, validate/дадатак/вэб чытаюць адну крыніцу). Валідатар правярае ўвесь пакет цалкам: тое, што асобная JSON Schema на адзін дакумент выказаць не можа.

## Што правяраецца

- **Схемы** — route, places, voices, per-locale stops (stories), public-праекцыі праз `contracts/reader.mjs`. Аўтарскі `discovery.json` — частковы індэкс: `schema_version`, `availability`, `access` вылічвае зборшчык, таму поўная схема `DiscoveryIndexV1` прымяняецца да сабранага індэкса (канформацны набор — `fixtures/discovery-contract/`, гл. ніжэй), а да аўтарскага дакумента ідуць крыжаваныя праверкі.
- **Невядомыя спасылкі** (`unknown-ref`): кропка → месца; гісторыя → голос, месца; rescue спасылак марш­рута ва ўсіх лакалах; offer ref → route/place/collection; тэмы; `suggested_start_place_id`; члены collection; файл `detail_ref`.
- **Дублікаты ID** (`duplicate-id`, `duplicate-stop-id`): месцы, галасы, кропкі, гісторыі ў адным файле, тэмы, collections, offers.
- **Каардынаты** — межы схем месца (lat/lng).
- **Транскрыпт і медыя**: транскрыпт — схемай гісторыі; `missing-media` для `cover`/`photo` па-за пакетам; `orphan-media` для аўдыё без гісторыі; `voice-locale-mismatch`; `tier-mismatch`.
- **Незацверджаны кантэнт** (`content-not-approved`): `review.decision` толькі `approved` — інварыянт 5 з `09`, разд. 3.
- **Небяспечныя шляхі** (`unsafe-path`): сегменты `..`, `.`, `private`, `extended` — `..` праходзіць праз charset-патэрны схем, таму гэта праверка валідатара.
- **Стабільнасць `RouteStop.id`** (`--against`): `stop-id-drift` (той самы id іншага месца/наратыву), `stop-id-renumbered` (кропка вярнулася пад новым id — дэфект TourForge), `route-id-changed`.
- **Перакрыццё радыусаў** (`radius-overlap`, **папярэджанне**): геафенсы месцаў напя́рэз — гэта палявая праверка, не забарона дзвюх гісторый на адной плошчы (інварыянт 6).
- **Discovery**: named-правілы рэдара (`checkIndexRules`) + `guide-duration-not-in-range` (`21`, разд. 3.2) + рэестр feedback-мэт (`release/feedback-target-registry.json`): wrong-kind запіс падае на схеме `FeedbackTarget` (collections — не мэты водгукаў, `21`, разд. 5.2).

Дыягностыка нясе толькі стабільныя правілы і шляхі сутнасцяў, без змесціва файлаў — тая ж мяжа ўцечак, што і ў зборшчыку G02.03.

## Запуск

```
node tools/validate/validate-package.mjs --in fixtures/content/demo-route
node tools/validate/validate-package.mjs --in <пакет> --against <папярэдне апублікаваны пакет>
```

JSON-вердыкт `{ ok, errors, warnings }`; код выхаду 1 — ёсць памылкі, папярэджанні не блакіруюць.

## Канформацны набор

`validateDiscoveryIndex(index)` — уваход для фікстур `fixtures/discovery-contract/` (крытэрый 5 з G01.06): `index-valid.json`, `catalog-legacy.json`, `catalog-with-discovery.json`, `catalog-legacy-v0.json` праходзяць; кожны `index-invalid-*.json` падае на правіла, названае ў яго тэксце; `catalog-invalid-oversized.json` падае на `discovery_index.bytes` да загрузкі.

## Межы

Публікацыя, pointer update і адкат каталога — G02.04; зборка і lock.json — G02.03; поўны фармат імпарту — G12.01. Валідатар не пераўвасабляе праверкі зборшчыка: ён правярае аўтарскае дрэва да яго.
