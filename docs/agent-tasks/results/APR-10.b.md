# APR-10.b — таблеткавая шырыня кантэнту: максімум і двухкалонная шчыльнасць (Tier 2)

Дата: 2026-11-02. Issue: [#959](https://github.com/vokhandcrafts/KUDY/issues/959). Эпік: #299.
Клон: `zcode-959`, галіна `zcode/959`, база main `f348e593`.

## Рэзюме

Кананічны максімум шырыні кантэнту для акна ≥600dp — **640dp** — запісаны ў канон
дызайну (токен `content.max-width` у машынным блоку `docs/design/visual-language.md`)
з люстрай `contentMaxWidth: 640` у `components/design-tokens.ts` (анкер-гейт
`test/design-tokens.test.mjs`). Кап ужыты адным безумоўным стылем
`components/content-width.ts` да чатырох паверхняў: галоўнае меню (explore),
спіс гідаў (rubric), прэв'ю гіда (route preview), налады (My KUDY). Ніжэй за кап
стыль інэртны, таму адзін кап абслугоўвае ўсе шырыні. Render-guard
`app/content-width.test.tsx` чырванее пры зняцці капа з любой з чатырох
паверхняў; тэлефонны рэндэр паўторна пацверджаны `visual:check` (PASS 12 · DIFF 0).

Інтэрпрэтацыя крытэрыю «налады»: асобнага маршруту Settings у main няма
(G27.02 — чарга); наладавыя элементы (выбар мовы UI) жывуць на паверхні
My KUDY, таму кап прыменены да яе.

## Табліца прыёмкі

| Крытэр | Стан | Доказ |
|---|---|---|
| AC1 — кананічнае значэнне запісанае | PASS | токен `content.max-width: 640px` з датай і use-правілам у `docs/design/visual-language.md`; люстра `contentMaxWidth` у `components/design-tokens.ts`; гейт `test/design-tokens.test.mjs` (18/18) |
| AC2 — чатыры паверхні ў выбранай шырыні на 800dp і 1280dp, шрыфт 1.0 і 2.0 | PASS | матрыца 16 здымкаў у `docs/testing/evidence/2026-11-02-issue959/`; вымярэнне: кантэнт ≤640dp, па цэнтру ±0px ва ўсіх здымках (табліца ніжэй) |
| AC3 — revert-праверка | PASS | зняцце `...contentWidthStyle` з `components/guide-card.tsx` давае `1 failed` на «the explore menu body caps at 1280 dp» (экспэрымэнт 2026-11-02 у сэсіі); аднаўленне — зялёна; guard у `npm test` (jest-фаза, суйт аўтазнойдзены) |

## Выбар значэння 640dp

- Мэта issue — радок 45–75 сімвалаў. Пры Golos Text 16dp шырыня 640dp мінус
  падшэўкі картак дае ≈55–70 сімвалаў у карткавых тэкстах — у цэлевым дыяпазоне.
- 640dp = 2 × 320dp: на 800dp акне пакідае па 80dp паляў, на 1280dp —
  сіметрычны цэнтраваны слупок; менш за 600dp-парог не апускаецца.
- Двухкалонная сетка (парог 821dp, `isWide`) не мяняецца: калонкі працягваюць
  лічыцца ад шырыні акна, цяпер унутры капа (≈296dp кожная на 1280dp).

## Змены

| Файл | Змена |
|---|---|
| `docs/design/visual-language.md` | токен `content.max-width: 640px` з use-правілам і датай |
| `components/design-tokens.ts` | люстра `contentMaxWidth: 640` (анкер `content.max-width`) |
| `components/content-width.ts` | новы: адзін стыль капа `contentWidthStyle` |
| `components/guide-card.tsx` | кап у `listContent` (CityCatalogBody — explore і rubric) |
| `app/(tabs)/my.tsx` | кап як `contentContainerStyle` FlatList-а |
| `app/route/[id].tsx` | кап як `contentContainerStyle` ScrollView-а |
| `app/content-width.test.tsx` | новы render-guard: 4 паверхні × 800/1280dp |
| `docs/testing/evidence/2026-11-02-issue959/` | 16 здымкаў матрыцы (даунскейл 0.5) |
| `docs/demos/2026-11-02-apr-10-b-content-width.md` | Showboat-дэма |

## Матрыца здымкаў (AC2)

Асяроддзе: AVD `kudy-813-tablet` (сістэмны вобраз android-36 google_apis
x86_64, `sdk_gphone64_x86_64`, Android 16, 2560×1600 @ 320dpi → акно
800×1280dp), dev-client APK `by.kudy.app` (зборка 27.10, JS з Metro), каталог —
фікстуры e2e-origin (`EXPO_PUBLIC_CATALOG_ORIGIN=http://10.0.2.2:8791`).
Прыродная арыентацыя AVD — ландшафт (1280dp), партрэт (800dp) — праз
`settings put system user_rotation`. Letterbox адсутнічае: акно дадатку
запаўняе дысплей у абедзвюх арыентацыях (targetSdk 36, ≥600dp).

Здымак: 4 паверхні (explore, guides, preview — `e2e-free-guide`, my) × 2
арыентацыі × 2 маштабы шрыфту (`settings put system font_scale`), 16 файлаў.
Вымярэнне (PIL на гаспадары, поўная раздзеленасць; межы белых картак):

| Паверхня | 800dp, шрыфт 1.0 | 800dp, шрыфт 2.0 | 1280dp, шрыфт 1.0 | 1280dp, шрыфт 2.0 |
|---|---|---|---|---|
| explore | 604dp, ±0px | 604dp, ±0px | 604dp, ±0px | 604dp, ±0px |
| guides | 604dp, ±0px | 604dp, ±0px | 604dp, ±0px | 604dp, ±0px |
| preview | 636dp, ±0px | 636dp, ±0px | 636dp, ±0px | 636dp, ±0px |
| my | 636dp, ±0px | 636dp, ±0px | 636dp, ±0px | 636dp, ±0px |

604dp — палотнішча картак унутры капа 640dp мінус падшэўка 16dp з абодвух
бакоў (CityCatalogBody); 636dp — картка ва ўсю шырыню капа мінус
антыаліясынг межы. Кап інварыянтны да шырыні акна і маштабу шрыфту.
Закоміцелыя доказы — даунскейл 0.5 (1px здымку = 1dp акна); поўная
раздзеленасць — у `.scratch/apr-10b-shots/ (не трэкуецца).

## Гейты

| Гейт | Вынік |
|---|---|
| `npm run typecheck` | зялёны (пасля `npm run storybook:generate` у клоне) |
| `npm test` | node-фаза: 2894 тэстаў, 2861 pass, 0 fail, 33 skipped; jest: 41 суйт, 319 тэстаў, 0 fail |
| `npm run arch:check` | OK — 683 modules, 0 violations |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | 0 clones |
| `uvx showboat==0.6.1 verify docs/demos/2026-11-02-apr-10-b-content-width.md` | exit 0 |
| `npm run visual:check` (тэлефонны профіль AVD `kudy-e2e`, 1080×2340@440) | PASS 12 · DIFF 0 · FAIL 0; a11y NOT-VERIFIED 1 (шчыльнасць прылады не вымераная інструментам) |

Заўвага пра няздзейны прагон: першы `visual:check` гэтай сэсіі быў выкананы на
планшэтным AVD і даў 12 FAIL «size mismatch: baseline 1080×2340, current
2560×1600» — несупадзенне прылады з базавай лініяй, не рэгрэс рэндэру;
паўтораны на тэлефонным профілі (радок вышэй). Справаздача няздзейнага прагону:
`tools/e2e-android/artifacts/2026-11-01T23-42-56-196Z-visual/report.md`.

## Design-QA

- Verdict: **NO_VERIFIED_RULE**
- Counts: RULE 0 · DIFF 0 · OPINION 2 · NOT-VERIFIED 4
- Scope: PR змены `docs/design/visual-language.md`, `components/design-tokens.ts`,
  `components/content-width.ts`, `components/guide-card.tsx`, `app/(tabs)/my.tsx`,
  `app/route/[id].tsx`; паверхні explore, guides rubric, route preview, My KUDY.
- Sources: `docs/design/visual-language.md` (машынны блок токенаў, SHA праз
  git HEAD zcode/959), `docs/design/screens-and-transitions.md` §Explore (радок
  «адна калонка < 821 px, дзве ≥ 821 px» — застаўся ісцінным), `docs/design-qa/exceptions.md` (каміт c9fdf54f).
- Environment: светлая тэма, локаль be, AVD kudy-813-tablet (Android 16,
  320dpi, акно 800×1280dp), шрыфт 1.0 і 2.0; тэлефонны рэгрэс — AVD kudy-e2e
  (1080×2340@440), шрыфт 1.0 і 1.5.

Дыферэнцыі колераў/шрыфтоў няма: змена дадае толькі геаметрычны кап; ролі
Golos/Alegreya/Caveat і папяровае зерне не закранутыя. DIFF-табліца пустая:
планшэтных ухваленых базавых ліній не існуе.

Пустая DIFF-табліца:

| surface/state | approved baseline | current PNG | difference PNG | region/threshold | owner verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Знаходкі:

- [OPINION] explore/guides/preview/my ≥600dp — BackButton застаецца ля краю
  акна, кантэнт цэнтруецца: хром і кантэнт у розных слупках на шырокім акне.
  Прычына некананічнасці: пра выраўнванне навігацыйнага хрому на ≥600dp канон
  маўчыць; UX 02 (#348) фіксуе толькі дасяжнасць back над скролам. Неблакавальна.
- [OPINION] guides ≥821dp — дзве калонкі ≈296dp унутры капа: кантраст з
  тэлефоннымі ≈380dp-калонкамі. Прычына: screens-and-transitions.md фіксуе
  толькі парог калонак, не шырыню; ніжэй за ўхваленыя значэнні. Неблакавальна.
- [NOT-VERIFIED] цёмная тэма на ≥600dp: здымкі толькі светлай тэмы (out of
  scope issue: #436); патрэбны здымкі цёмнай тэмы планшэта.
- [NOT-VERIFIED] TalkBack/клавіятура на планшэтных шырынях: прагон не рабіўся
  (гэта зона MAP-10/#891 і #958 для multi-window); патрэбны
  screen-reader крокі на 800dp/1280dp.
- [NOT-VERIFIED] iOS: праверана толькі Android-эмутатар; iPad-шырыні не праганяліся.
- [NOT-VERIFIED] ухваленыя планшэтныя базавыя лініі visual:check адсутнічаюць
  (DQ-04 адкрытае — першыя базавыя лініі чакаюць уладара).

Другі (адмаўляльны) прагон:

- Кандыдат RULE «радок >75 сімвалаў у картцы гіда на 1280dp» — адкінуты:
  45–75 сімвалаў — мэта issue, не прынятае правіла канона; вымярэнне мэтазгодна
  як OPINION-заўвага, а канон грунтуецца на токенах, не на падліку сімвалаў.
- Кандыдат RULE «дзве калонкі ў капе 640dp парушаюць screens-and-transitions
  §Explore» — адкінуты: радок дакументуе толькі парог 821px для колькасці
  калонак; колькасць і парог не змяніліся.
- Кандыдат RULE на hitSlop — адкінуты: змена не тыкаецца зон націскання;
  выключэнне hitSlop у рэестры тут не задзейнічаецца.

## Out of scope (вытрымана)

Цёмная тэма (#436), тэлефонныя раскладкі (рэндэр пацверджаны нязменным
visual:check), новыя функцыі, спліт-праверка (#958), маршрут Settings
(G27.02), place/discovery/map паверхні (не названыя ў issue).

## Гісторыя асяроддзя сэсіі

- Worktree Metro: node_modules клона — жорсткія спасылкі (`cp -al`), інакш
  launchAsset URL выходзіць за root Metro (404); `REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`
  для дасяжнасці з эмутатара; юніты `kudy-metro-959`/`kudy-emulator-959`
  спыненыя пасля здымкаў. Агульныя юніты іншай сэсіі (`kudy-metro`,
  `kudy-e2e-origin`) не закранутыя; фікстуры origin пераўжытыя толькі на чытанне.
