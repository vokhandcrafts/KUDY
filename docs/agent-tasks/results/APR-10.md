# APR-10 — мяжа падтрымкі Android UI: вялікі шрыфт, арыентацыя, планшэты

Дата: 2026-11-01. Задача: [#813](https://github.com/vokhandcrafts/KUDY/issues/813). Эпік: #299. Клон: `/home/viktar/worktrees/KUDY-813`, ветка `zcode/813` ад main `ff9cea15`.

Вынік: запісанае рашэнне ўладара (крытэрый 3, прынята ў жывой сэсіі 2026-11-01), матрыца сцэнарыяў на трох эмулятарах API 36 са здымкамі, дэфектаў вялікага шрыфту не знойдзена, заведзеныя дзве задачы-наступствы [#958](https://github.com/vokhandcrafts/KUDY/issues/958), [#959](https://github.com/vokhandcrafts/KUDY/issues/959). Runtime не крануты (правіла эпіка: APR-06–APR-10 — задачы рашэнняў).

## Рашэнне ўладара (крытэрый 3)

**«Тэлефон вертыкальна, вялікія экраны — абедзве арыентацыі»**, прынята ўладарам прадукта 2026-11-01 у сэсіі выканання (выбар з трох варыянтаў, рэкамендаваны варыянт прыняты).

Падтрыманы ўзровень і паводзіны:

| Вобласць | Мяжа | UX-наступствы |
| --- | --- | --- |
| Арыентацыя тэлефона | `orientation: portrait` захоўваецца (`app.json:7`, маніфест `screenOrientation=portrait`) | Аднаручная ўстойлівасць; гарызанталь на тэлефоне не падтрымліваецца свядома |
| Арыентацыя ≥600dp (планшэт, разгорнуты фолд) | Не фіксуецца: сістэма API 31+ ігнаруе `screenOrientation` на вялікіх экранах — абедзве арыентацыі | Прылады вяртаюцца, стан захоўваецца (засталяна); двухкалонныя варыяцыі — добраахвотныя |
| Сістэмны шрыфт | Да 200% уключна; UI-тэкст праз `ScaledText` з капам `font.big-text-factor` 1.25 (`components/scaled-text.tsx`) | Пры 200% тэкст расе да 1.25×, раскладкі трымаюцца (засталяна); uncapped `Text` забаронены ў production (гейт #718, G21.50 для zh) |
| Display size | Правераны крок ≈максімальны (`wm density 540` на базе 420) | Без абразання; рады дзеянняў пераносяцца |
| Multi-window / split-screen | `RESIZEABLE_VIA_SDK_VERSION`; split-screen на эмулятары NOT-VERIFIED → [#958](https://github.com/vokhandcrafts/KUDY/issues/958) | Прабел зафіксаваны, не залічваецца як pass |
| Шырыня кантэнту на планшэце | Поўная шырыня акна без капа — Tier-2 паляпшэнне → [#959](https://github.com/vokhandcrafts/KUDY/issues/959) | Line_Length (45–75 сімв.) на 800dp трымаецца фактычна; паліпшэнне шчыльнасці адкладзенае |
| TalkBack/ Accessibility Scanner | Па-за гэтай задачай (UX-01) | Прабел у матрыцы UX-01 захоўваецца |

Наступствы для напісання кода: uncapped `Text` і фіксаваныя без пераносу рады дзеянняў — адзіныя вядомыя дэфекты 200%, абодва маюць межу ў ідыёме `ScaledText` + фіксы #719; партрэт-лак тэлефона не знімаць без новага рашэння; на ≥600dp нельга дадаваць код, што абапіраецца на забарону павароту або спрабуе адключыць multi-window.

## Крытэрый 1 — супастаўленне зыходнікаў і гайдлайнаў

Крыніцы прачытаны 2026-11-01 па `ff9cea15`:

- `app.json:7` — `orientation: portrait`; `userInterfaceStyle: automatic`.
- `components/scaled-text.tsx` — адзіны ідыём карыстальніцкага тэксту: `maxFontSizeMultiplier={tokens.fontBigTextFactor}` (1.25, G06.05).
- Дэфекты 200%: #718 (закрыты) — uncapped `Text` на font_scale 2.0 дае ≈1.762× і абрэз гліфаў праз Fabric-cache; production бяспечны (ідыёма + G21.50), дэфект жыве толькі ў dev-probe экранах. #719 (закрыты) — фіксаваныя рады дзеянняў перапаўняліся на 200%; выправлена пераносам.
- Маніфест усталяванага APK (debug, 27.10): `targetSdk=36`, `minSdk=24`, `screenOrientation=1 (portrait)` на галоўнай актыўнасці, `RESIZE_MODE_RESIZEABLE_VIA_SDK_VERSION`, `supportsScreens=[small…xlarge, resizeable, anyDensity]` (aapt2 dump + `dumpsys package`).
- Android core app quality (2026-11-01): абавязковыя — `Orientation_Transitions` (у т.л. fold/unfold без страты стану), `Display_State_Parity`, `Fullscreen_Display` (без letterbox ад канфігурацыйных зменаў), `State_Preservation`, `Touch_Target_Size` ≥48dp, `Line_Length` 45–75 сімвалаў, `Theme_Support` (цаляпад → #436, па-за гэтай задачай).
- Adaptive app quality Tier 3 (2026-11-01): усе патрабаванні абавязковыя — `Config_Changes` (запаўненне акна, без letterbox/compat, resize + стан), `Config_Combinations`, `Multi-Window_Functionality`, `Multi-Resume`, клавіятура/мыш; на экранах sw ≥600dp (API 31+) усе арыентацыі абавязковыя незалежна ад `android:screenOrientation`, і multi-window дзейнічае нават пры `resizeableActivity="false"`. Маштаб шрыфту ў Tier 3 не ўваходзіць — гэта core/accessibility.
- Размежаванне: абавязковая сумяшчальнасць = core + Tier 3 (малюнак вышэй); **пажаданыя Tier 2** — desktop windowing, двухпанэльныя раскладкі і зместавая шчыльнасць (#959), стылус-паляпшэнні. Гэтыя не мяжа выпуску.

## Крытэрый 2 — матрыца прылад і станаў (эмулятары, здымкі)

Асяроддзе: Linux-хост, API 36 (`system-images;android-36;google_apis;x86_64`), `-gpu swiftshader_indirect`. APK: debug `by.kudy.app` ад 27.10 (без перазборкі). Metro з клону `ff9cea15` на :8081; кантэнт — G23.01 e2e-origin :8791 (catalog sha256 `c5774ecc…`, маршруты 2). Здымкі: `docs/testing/evidence/2026-11-01-issue813/`.

Сцэнарыі з issue: прагляд гідаў (галоўнае меню + горад + спіс), Run (прагулка: старт, прыпыніць/завяршыць, дыялаг, рэзюме), карта (рэзюме прагулкі з MapLibre-картай), пакупка (платны гід: поўнае + закрытая кропка), налады (экран KUDY: мова 8 шт., бягучая прагулка, гісторыя).

| Прылада (AVD) | Стан | Сцэнарыі | Вынік | Здымкі |
| --- | --- | --- | --- | --- |
| Тэлефон `kudy-test` (Pixel 6, 1080×2400 @420) | font 1.0 | усе 5 | чыста | phone/01,02,04,05,06,07,08 |
| тое ж | font 2.0 (сістэмны максімум) | усе 5 | чыста; рады дзеянняў Run пераносяцца ў дзве наступныя радкі (фіксы #719); дыялагі і поўнае чыстыя | phone/11,12,14,15,17,18 |
| тое ж | display size ≈макс (`wm density 540`) | дом, гід, Run, рэзюме, поўнае | чыста; кнопкі stacked | phone/21,24,25,27 |
| тое ж | font 2.0 + 540dpi (камбінацыя) | дом, гід, Run | чыста | phone/31,32,34 |
| Фолд `kudy-813-fold` (7.6", унутраны 1768×2208 @420 = 673dp) | разгорнуты, портрэт | дом | поўная шырыня без letterbox | fold/41 |
| тое ж | разгорнуты, landscape (user_rotation) | дом | дадатак паварочваецца нягледзячы на портрэт-лак (адпавядае паводзінам API 36 на ≥600dp); гіды ў дзве калонкі, без абразання | fold/42 |
| тое ж | fold/unfold дысплея | — | **прабел**: профіль не пераключае дысплеі (`DeviceStateToLayoutMap` пусты); пакрыта Resizable AVD | fold/43 (факт: пераключэнне не эмулюецца) |
| Resizable `kudy-813-resizable` | OPENED (1080×2400) ↔ CLOSED (1080×2092) з адкрытым прэв'ю гіда | гід | стан захаваны ў абодвух пераходах, без краху — fold-частка `Orientation_Transitions` | fold/44,45 |
| Планшэт `kudy-813-tablet` (2560×1600 @320 = 800dp портрэт / 1280dp landscape) | landscape, портрэт | дом, горад, прэв'ю | поўны экран без letterbox у абедзвюх арыентацыях; горад і прэв'ю захоўваюць стан праз паварот | tablet/50,51,52,53,54 |
| тое ж | split-screen | спроба | **NOT-VERIFIED**: сэанс пікера лаўнчара скідаецца пры скрыптаванні → #958 | tablet/55 |
| Фізічныя тэлефон/фолд/планшэт | — | — | **прабел** (адсутнасць прылады; не pass) — трэк рэлізу #299/#330 | — |
| TalkBack поўны праход | — | — | **прабел** (UX-01) | — |

Дэфектаў на 200% не знойдзена. Назіранні (не дэфекты): menu-карткі на 1280dp расцягваюцца на ўсю шырыню (→ #959); першы запуск на кожнай прыладзе паказвае dev-меню лаўнчара — артефакт dev-зборкі, не production.

## Крытэрый 3 — праверка выканання

Рашэнне прынятае і запісанае (раздел «Рашэнне ўладара»): узровень, паводзіны арыентацыі і шрыфту, прынятыя абмежаванні з UX-наступствамі і датай 2026-11-01.

## Крытэрый 4 — fix-issues

Створаныя асобныя задачы без зменаў runtime:

1. [#958](https://github.com/vokhandcrafts/KUDY/issues/958) — split-screen доказ + камітная ахова «без letterbox/compat» + паўтор матрыцы Resizable на фінальнай зборцы.
2. [#959](https://github.com/vokhandcrafts/KUDY/issues/959) — кананічны максімум шырыні кантэнту на ≥600dp + revert-праверка.

## Абнаўленні дакументаў у гэтым PR

- `docs/audits/android-google-guidelines.md` — радкі UX-02/UX-03/UX-05: стан на 2026-11-01 са спасылкай на гэты results і рашэнне; сцяжкі не пераводзяцца (TalkBack/фізічныя прылады/split — прабелы).
- `docs/agent-tasks/android-play-readiness/README.md` — радок UX-02/03/05: рашэнне APR-10 прынятае, наступствы #958/#959.

## Scope і мяжы

Змены толькі ў дакументах і evidence-здымках; runtime, схемы, пераклады і .github не кранутыя. Усе прыладныя сцвярджэнні — эмулятары API 36 на x86_64 са swiftshader; фізічныя прылады, TalkBack і split-screen — зафіксаваныя прабелы, не залічаныя як pass.

## Proof

Факт мантрыцы аднаўляецца кантролем файлаў і здымкаў:

```sh
node -e "const a=require('node:assert/strict'),f=require('node:fs');const base='docs/testing/evidence/2026-11-01-issue813/';for(const p of ['phone/11-font200-home.png','phone/14-font200-run.png','phone/31-combined-home.png','fold/42-unfolded-landscape.png','fold/45-resizable-reopened-guide.png','tablet/52-tablet-rotated-portrait.png','tablet/53-tablet-landscape-city-preserved.png']) a.ok(f.existsSync(base+p),'missing '+p);const s=f.readFileSync('components/scaled-text.tsx','utf8');a.ok(s.includes('maxFontSizeMultiplier={tokens.fontBigTextFactor}'));const j=f.readFileSync('app.json','utf8');a.ok(j.includes('\"orientation\": \"portrait\"'));console.log('APR-10 proof: OK')"
```

Падае, калі здымкі матрыцы выдаленыя або межа (`ScaledText`-кап 1.25, портрэт-лак) зменена без новага рашэння.
