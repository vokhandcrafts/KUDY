# Машынная праверка межаў слаёў (arch:check)

`npm run arch:check` правярае матрыцу слаёў — праекцыю кананічных крыніц
[09 §6](../../docs/architecture/09_technical_architecture.md) і
[19 §2 + §4.2](../../docs/architecture/19_class_and_module_map.md) — пры дапамозе
dependency-cruiser (пін-точна ў `devDependencies`; канфіг —
[`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs)). Спіс зон на скан:
`core services contracts tools web app controllers`. Правілы конфігу:

| Правіла | Кананічная крыніца | Сэнс |
|---|---|---|
| `core-zone-closed` | 09 §6; 19 §2.1 | прадукцыйны `core/` імпартуе толькі адносныя файлы ўсярэдзіне `core/` — не `node:*`, не RN/expo, не npm-пакеты |
| `core-test-no-npm`, `core-test-no-zones` | матрыца, радок `core/` | тэсты ў `core/` выключаныя толькі для `node:*` (`node:test`, `node:assert`, чытанне фікстур); npm і іншыя зоны — таксама не |
| `services-zone-closed` | матрыца, радок `services/`; 19 §4.2 | `services/` не імпартуе `web/`, `tools/`, `spikes/`, `app/`, `controllers/` |
| `contracts-zone-closed` | матрыца, радок `contracts/` | `contracts/` — толькі адносныя імпарты, ніякай зоны дадатку |
| `web-zone-closed` | матрыца, радок `web/` | `web/` не імпартуе `core/`, `services/`, `tools/`, `spikes/` |
| `app-no-services` | 19 §4.2 (правіла краю); G06.09.a | `app/` не імпартуе `services/` напрамую — экраны дасягаюць стану і эфектаў толькі праз кантролеры |
| `app-no-core` | 19 §4.2 (правіла краю); G06.09.b | `app/` не імпартуе `core/` напрамую — разам з `app-no-services` гэта край «экраны імпартуюць толькі `controllers/` (плюс React/Expo)» |
| `controllers-services-type-only` | 19 §2.2, §2.6; issue #209 AC1 | `controllers/` бярэ `services/` тыпамі (`import type`) — value-імпарт і канструяванне дазволеныя толькі кампазіцыйнаму кораню `controllers/createServices.ts` і тэстам (яны падключаюць фэйкі). type-only імпарты не ўваходзяць у граф пакуль `tsPreCompilationDeps` выключаны (яго ўключэнне давала б 2 новыя no-cycles запісы ў `web/lib/i18n` — свядома не ўключалася); дазвол `dependencyTypesNot: ['type-only']` трымае правіла карэктным, калі гэта зменіцца |
| `tools-zone-closed` | матрыца, радок `tools/`; 19 §2.4 | `tools/` — асобны працэс без агульнага коду з дадаткам; не імпартуе `core/`, `services/`, `web/`, `spikes/` |
| `no-cycles` | 19 §4.2 | цыклы забароненыя ўсярэдзіне і праз усе правераныя зоны |

Правілы зоны `controllers/` (`app-no-core`, `controllers-services-type-only`)
увайшлі разам з першым кантролерам-узорам і кампазіцыйным коранем G06.09.b;
`app/` мае `app-no-services` з G06.09.a. Глыбіня імпартаў (`deep imports`) і
скан `spikes/` з `docs/run-model` — наўмысна па-за межамі.

## Базавая лінія

`tools/arch/baseline.json` — датаваны спіс існых парушэнняў; **новыя** блакуюць
(nonzero), старыя праходзяць. Абнаўленне базавай лініі — толькі ўсвядома, у
рэв'ю: `npm run arch:baseline` рэгенеруе файл (захоўвае дату `since` старых
запісаў), але тлумачэнне кожнага запісу жыве тут, у гэтай табліцы, і мусіць
з'явіцца ў тым жа рэв'ю, што дадае запіс. Запіс, які знік са скану, — змыць і
з табліцы.

## Запісы базавай лініі (стан на 2026-09-22 — 6 запісаў)

Знаходка прыёмкі G18.01: брыф чакаў пустую базавую лінію, але поўны скан па
матрыцы знайшоў 6 перакрыжаваных імпартаў `web/` ↔ `tools/` — вузкае знямак
з брыфа («па-за `core/` ніхто не імпартуе `core/`; прадукцыйны `core/` без
`node:*`») быў сапраўдным, але няпоўным. Выпраўленне парушэнняў — па-за межамі
задачы G18.01 (issue: «baseline only»), таму запісы прынятыя ўсвядома і чакаюць
уласных рашэнняў:

| # | Запіс (`rule: from -> to`) | Тлумачэнне |
|---|---|---|
| 1 | `web-zone-closed: web/lib/content/interim-catalog.ts -> tools/build-bundle/build-bundle.mjs` | **Прадукцыйны файл.** interim-чытальнік каталога карыстаецца дапаможнікам з аўтарскага зборшчыка бандла. Разнесці агульную логіку (у `contracts/` ці асобны агульны модуль) — асобнае рашэнне; сёння гэта свядомы доўг. |
| 2 | `web-zone-closed: web/scripts/build-content.ts -> tools/build-bundle/build-bundle.mjs` | Прэбілд вэба кампануе аўтарскі зборшчык in-process, хоць 19 §2.4 вызначае `tools/` як асобны працэс. Вынас у асобны выклік CLI — асобная задача. |
| 3 | `web-zone-closed: web/lib/content/leak-parity.test.ts -> tools/build-bundle/build-bundle.mjs` | Guard-тэст парытэту: параўноўвае leak-сканер вэба з leak-сканерам аўтарскіх інструментаў на агульных фікстурах. Перасячэнне — сутнасць тэсту. |
| 4 | `web-zone-closed: web/lib/content/leak-guard.test.ts -> tools/build-bundle/build-bundle.mjs` | Таго ж класу guard-парытэту, што і №3. |
| 5 | `web-zone-closed: web/lib/content/test-fixture.ts -> tools/build-bundle/build-bundle.mjs` | Тэставы дапаможнік suite-а парытэту (№3–4): гатуе фікстуры праз зборшчык. Не `.test.`-файл, таму бачны правілу. |
| 6 | `tools-zone-closed: tools/publish-catalog/publish-catalog.test.mjs -> web/lib/content/interim-catalog.ts` | Тэст парытэту з боку інструментаў: звярае вынік publish-catalog з interim-чытальнікам вэба (№1). |

Запіс 6 разам з №1 утварае двухбаковую збежнасць зон праз розныя файлы (не
цыкл — `no-cycles` гэта пацвярджае).

## Выключэнне праверкі = праверка

Канфіг, скрыпты і падключэнне — самі пад гвардай (implementation-rules §1,
«канфігурацыя = код»): тэст `tools/arch/arch-check.test.mjs` у glob `npm test`
правярае скрыпты `arch:check`/`arch:baseline` і запіс `tools/arch` у `npm test`,
саднічае конфіг у пясочніцу з падсажанымі парушэннямі (цыкл, `node:fs` у `core/`,
парушэнне напрамку зоны) і павінен бачыць nonzero з назвай правілы;
`tools/ci/check-required-checks.mjs` красіцца, калі з `package.json` знікае
`arch:check` ці запіс `tools/arch` з `npm test`. Тэст на зварот:

```
node --test tools/arch/arch-check.test.mjs
```
