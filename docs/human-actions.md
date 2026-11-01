# Ручныя дзеянні для чалавека

Куды агенты пасля сканчэння задачы запісваюць тое, што павінен зрабіць сам чалавек:
мерж або закрыццё PR, крок у інтэрфейсе GitHub, змена налад, каманда на сваёй машыне
і г. д. Правіла — у `AGENTS.md`, раздзел «Record human follow-up actions after a task».

## Фармат

Адзін запіс на задачу, каротка, па-беларуску; навейшыя — уверх. Калі дзеянне зроблена,
запіс выдаляюць.

```
### YYYY-MM-DD — кароткая назва
Што зрабіць: адзін-тры сказы загадным ладам.
PR: спасылка (калі ёсць звязаны issue — дадаць і яго)
```

## Што трэба зрабіць

### 2026-11-01 — мерж мяжы падтрымкі Android UI (APR-10)
Што зрабіць: калі аўтаматычны мерж пайплайна не адбудзецца (branch protection ці чырвоны CI) — замерж PR рукамі пасля зелёнага суддзі і знімі лэйбл `agent:running` з issue. Калі PR ужо змержаны аўтаматам — запіс састарэлы, выдалі яго.
PR: [#960](https://github.com/vokhandcrafts/KUDY/pull/960) · Issue: [#813](https://github.com/vokhandcrafts/KUDY/issues/813)

### 2026-11-01 — мерж Storybook на прыладзе (DQ-13)
Што зрабіць: калі аўтаматычны мерж пайплайна не адбудзецца (branch protection ці чырвоны CI) — замерж PR рукамі пасля зелёнага суддзі і знімі лэйбл `agent:running` з issue. Калі PR ужо змержаны аўтаматам — запіс састарэлы, выдалі яго.
PR: [#957](https://github.com/vokhandcrafts/KUDY/pull/957) · Issue: [#914](https://github.com/vokhandcrafts/KUDY/issues/914)

### 2026-11-01 — мерж праверак даступнасці з дампа (DQ-06)
Што зрабіць: калі аўтаматычны мерж пайплайна не адбудзецца (branch protection ці чырвоны CI) — замерж PR рукамі пасля зелёнага суддзі і знімі лэйбл `agent:running` з issue. Калі PR ужо змержаны аўтаматам — запіс састарэлы, выдалі яго.
PR: [#950](https://github.com/vokhandcrafts/KUDY/pull/950) · Issue: [#916](https://github.com/vokhandcrafts/KUDY/issues/916)

### 2026-10-31 — прыёмка меню-карты перад production (MAP-02)
Што зрабіць: перад production-прыёмкай правер кампанент на фізічнай прыладзе, зацвердзі гістарычную рамку і перыяд ды правер правы на аснову. Кампанент яшчэ трэба падключыць да навігацыі, шрыфты застаюцца драфтам.
PR: [draft #924](https://github.com/vokhandcrafts/KUDY/pull/924) · Issue: [#885](https://github.com/vokhandcrafts/KUDY/issues/885) · Кампанент: [інтэграцыя](design/brand/outputs/menu-map-city-only/native/README.md)


### 2026-10-30 — змержы спецыфікацыю праверкі дызайну (DQ-00)
Што зрабіць: прагледзь і змержы PR #923 — спецыфікацыя, 14 задач DQ і карта; пасля мержу задачы DQ разблакуюцца па чарзе. Пасля мержу знімі `agent:running` са звязанага issue #909, калі пазнака ёсць. Асобна вырашы, ці рабіць мішэнь 48 dp правілам канона §9; адказ запішы ў #908.
PR: https://github.com/vokhandcrafts/KUDY/pull/923 · Issue: https://github.com/vokhandcrafts/KUDY/issues/909

### 2026-10-30 — правер натыўную светлую і цёмную тэмы KUDY (#436)
Што зрабіць: збяры Android-версію з PR #907 і на прыладзе правер Explore, прэв'ю, статус-бар, Run, кантраст і павялічаны шрыфт у абедзвюх сістэмных тэмах; захавай скрыншоты і вынікі ў #436. Запусці і пацвердзі Showboat-дэманстрацыю перад пераводам PR з Draft; без гэтых доказаў не мержы. Пасля дазволенага мерджу знімі `agent:running` з issue #436.
PR: https://github.com/vokhandcrafts/KUDY/pull/907 · Issue: https://github.com/vokhandcrafts/KUDY/issues/436

### 2026-10-30 — зацвердзі рамку гістарычнай карты Гданьска (MAP-01)
Што зрабіць: выберы варыянт A (толькі Główne Miasto) ці B (Stare Miasto разам з Główne Miasto), гістарычную эпоху і пачатковыя 4–5 частак. Асобна пацвердзі дапушчальную схематызацыю і крыніцу production-асновы пасля праверкі правоў на канкрэтны скан; занясі рашэнні ў issue #882.
PR: https://github.com/vokhandcrafts/KUDY/pull/906 · Issue: https://github.com/vokhandcrafts/KUDY/issues/882

### 2026-10-30 — завяршы прыёмку G20.35 пасля новага рэв'ю
Што зрабіць: перад зліццём PR #903 правер паўторны CI на апошнім каміце пасля выпраўлення заўваг Voka/Judge і атрымай новы незалежны станоўчы вердыкт Judge. Папярэднія Android CI і Showboat ужо былі зялёныя на `eaf061e`; свежыя вынікі занясі ў `docs/agent-tasks/results/G20.35.md`. Лакальны эмулятар не запускай; пасля merge здымі `agent:running` з #815.
PR: https://github.com/vokhandcrafts/KUDY/pull/903 · Issue: https://github.com/vokhandcrafts/KUDY/issues/815

### 2026-10-29 — змержы праўку літарала ў гараўчым тэсце MAP-05
Што зрабіць: змержы PR #900 — літарал `$` у ахоўным тэсце MAP-05 больш не схаваны пад String.fromCharCode(36), у must-flag дададзены пункт для рэв'ю і суддзі. Змена дробная (тэст + дакументацыя), пайплайн рэв'ю не гнаўся. Пасля мержу знімі `agent:running` са звязанага issue #896.
PR: https://github.com/vokhandcrafts/KUDY/pull/900 · Issue: https://github.com/vokhandcrafts/KUDY/issues/896

### 2026-10-28 — абнаві KUDY на Android для праверкі іконкі
Што зрабіць: пасля зліцця PR #872 перазбяры Android APK з Expo prebuild і ўсталюй яго нанова на тэлефон. Правер, што медная круглая рамка супадае з мяжой круглай іконкі, а квадратная — з мяжой квадратнай.
PR: https://github.com/vokhandcrafts/KUDY/pull/872

### 2026-10-28 — змержы фікс заставкі «KUDY»
Што зрабіць: змержы PR #873 — заставка пры старце абразала слова «KUDY» да «KUD», радок цяпер поўнай шырыні экрана. Пасля зліцця перазапусці аплікацыю на эмулятары або тэлефоне і правер, што слова бачна цалкам.
PR: https://github.com/vokhandcrafts/KUDY/pull/873

### 2026-10-23 — праверы натыўны фонавы GPS на прыладзе
Што зрабіць: на фізічнай Android-прыладзе праверы позні background-grant падчас Run (без страты GPS-фіксаў), адмову (foreground працягваецца), паўторны grant (без дублявання background-task) і Pause/End падчас чакання дазволу — сцэнары раздзела «Асобная натыўная прыёмка» ў `docs/demos/2026-10-22-g20-30-background-gps-promotion.md`; вынік дашлю ў `docs/agent-tasks/results/G20.30.md`. Адкладзена ўладаром 2026-10-24 — G20.30/#792 лічыцца ўмоўна выкананым, гэты крок нічога не блакуе ([рашэнне](https://github.com/vokhandcrafts/KUDY/issues/792#issuecomment-6378072568)); Showboat-праверка па #841/#857 ужо выкананая, яе не паўтараць.
PR: https://github.com/vokhandcrafts/KUDY/pull/857 · Issue: https://github.com/vokhandcrafts/KUDY/issues/792

### 2026-10-22 — завершы Play-дэкларацыі APR-08
Што зрабіць: перад Play submission правер production AAB, SDK network flows OpenFreeMap/RevenueCat, prominent disclosure і кожны выкарыстаны FGS з Android video; узгадні privacy ў #853, mediaPlayback ў #854, device-delete ў #835/#836 і retention/orphan cleanup ў #849. Занясі вынікі ў #299, не называй дакументальны інвентар production approval.
PR: https://github.com/vokhandcrafts/KUDY/pull/850 · Issue: https://github.com/vokhandcrafts/KUDY/issues/811

### 2026-10-20 — праводзь праверкі брэнда G26
Што зрабіць: калі ёсць час засяродзіцца, бяры па адной задачы з ⚠️ (#765–#773, #776) і праводзь яе разам з агентам у жывой сесіі: агент рыхтуе матэрыял, рашэнне — тваё.
PR: https://github.com/vokhandcrafts/KUDY/pull/779 · Issue: [#764](https://github.com/vokhandcrafts/KUDY/issues/764)

### 2026-10-19 — выберы напрамак заставы KUDY
Што зрабіць: параўнай [дзесяць мабільных напрамкаў](design/brand/outputs/brand-splash-directions-2026-10-19/all-ten.png) і [іх тлумачэнні](design/brand/outputs/brand-splash-directions-2026-10-19/README.md) у PR #802. Назаві адзін або некалькі для развіцця ў пару «чаканне → Explore»; асобна вызначы тэксты B06. Ранейшыя заставы з асобным драконам і мясцовай панарамай адхіленыя.
PR: https://github.com/vokhandcrafts/KUDY/pull/802

### 2026-10-17 — правер Android-задачы і выпуск
Што зрабіць: правер у GitHub Project, што #804–#813 бачныя ў backlog без запуску выканаўцаў; токен гэтай сесіі не мае `read:project`. Звяры дэкларацыі фонавай лакацыі, усіх выкарыстаных тыпаў foreground service і Data safety з [матрыцай аўдыту](audits/android-google-guidelines.md). Перадай вынік праверкі production AAB і Play Console, каб закрыць пункты доказамі.
PR: https://github.com/vokhandcrafts/KUDY/pull/803 · [Індэкс задач](agent-tasks/android-play-readiness/README.md) · Issues: [#804](https://github.com/vokhandcrafts/KUDY/issues/804), [#805](https://github.com/vokhandcrafts/KUDY/issues/805), [#806](https://github.com/vokhandcrafts/KUDY/issues/806), [#807](https://github.com/vokhandcrafts/KUDY/issues/807), [#808](https://github.com/vokhandcrafts/KUDY/issues/808), [#809](https://github.com/vokhandcrafts/KUDY/issues/809), [#810](https://github.com/vokhandcrafts/KUDY/issues/810), [#811](https://github.com/vokhandcrafts/KUDY/issues/811), [#812](https://github.com/vokhandcrafts/KUDY/issues/812), [#813](https://github.com/vokhandcrafts/KUDY/issues/813)

### 2026-10-17 — узгадні налады KUDY і правер backlog G27
Што зрабіць: праглядзі светлы і цёмны макеты ды канцэпцыю ў PR #790 і запішы ў [#781](https://github.com/vokhandcrafts/KUDY/issues/781), якія часткі прынятыя або адкладзеныя. Правер, што #780–#789 і #798 бачныя ў backlog GitHub Project; токен гэтай сесіі не мае `read:project`.
PR: https://github.com/vokhandcrafts/KUDY/pull/790 · Issue: [#781](https://github.com/vokhandcrafts/KUDY/issues/781)

### 2026-10-15 — усталюй дэманстрацыйную версію KUDY
Што зрабіць: збяры дэма-APK паводле [інструкцыі](demo-preview.md), затым усталюй `android/app/build/outputs/apk/release/app-release.apk` на Android-прыладу. Гэта асобны пакет `by.kudy.app.demo` з прыкладным кантэнтам; не выкарыстоўвай яго маршрут для навігацыі.
PR: https://github.com/vokhandcrafts/KUDY/pull/760

### 2026-10-14 — правер бачнасць #751 і #752 на дошцы
Што зрабіць: адкрый GitHub Project і правер, што #751 бачны ў backlog, а #752 — у працы. Калі картак няма, дадай іх у адпаведныя калонкі, не змяняючы статусных пазнак issues. CLI-токен выканаўцы не мае `read:project`, а публічны прагляд не паказвае дошку.
PR: https://github.com/vokhandcrafts/KUDY/pull/753 · Issues: [#751](https://github.com/vokhandcrafts/KUDY/issues/751), [#752](https://github.com/vokhandcrafts/KUDY/issues/752)

### 2026-10-13 — праверка Project пасля #746
Што зрабіць: Правер бачнасць і статус #746 і #662 у GitHub Project або дай CLI права `read:project`, каб агент мог праверыць дошку. У гэтай сесіі даступныя толькі issue і іх пазнакі; запыт Project адхілены праз адсутнае права.
Issue: https://github.com/vokhandcrafts/KUDY/issues/746

### 2026-10-12 — G24.05: вырашы межы пілота A1
Што зрабіць: Калі A1 ухвалены ў #695, прачытай [вынік G24.05](agent-tasks/results/G24.05.md) і запішы ў [рэестр рашэнняў](design/brand/decisions.md), дзе паказваць картку, ці яна даступная пры паўзе і ці захоўваць адказ пасля перазапуску. Правер бачнасць #696 у GitHub Project: токен гэтай сесіі не мае `read:project`.
PR: https://github.com/vokhandcrafts/KUDY/pull/744 · Issue: [#696](https://github.com/vokhandcrafts/KUDY/issues/696)

### 2026-10-12 — G24.04: зацвердзі ці адхілі пілот узаемадзеі дракона
Што зрабіць: прачытай раздзел «Што просіць уладар» у [выніку G24.04](docs/agent-tasks/results/G24.04.md) і каментаром у [#695](https://github.com/vokhandcrafts/KUDY/issues/695) прымі ці адхілі рэкамендаваны пілот A1 «Падні вочы» (чарга пасля яго: A4 → A2 → A5; гукі чакаюць #694).
PR: https://github.com/vokhandcrafts/KUDY/pull/740 · Issue: [#695](https://github.com/vokhandcrafts/KUDY/issues/695)

### 2026-10-11 — G25.02: выберы набор назваў меню, калекцыі і тагляйн
Што зрабіць: праглядзі дошку трох набораў назваў і глосарый васьмі моваў у PR і выберы варыянт — рэкамендацыя набор A (фіксы «праходы»→«прагулкі» і «гайд»→«гід», калекцыя «Знаходкі», тагляйн «Горад расказвае.»). Пасля выбару запішы рашэнне ў B06 (`docs/design/brand/decisions.md`); асобны PR па be-крыніце каталогаў робіцца толькі пасля запісу.
PR: https://github.com/vokhandcrafts/KUDY/pull/725 (issue #701)
### 2026-10-11 — G24.01: прымі рашэнні па KUDY-брэндзе з брыфа
Што зрабіць: прачытай брыф і вырашы — заняць kudy.pl (вольны на 2026-10-11, прадаўжэнне ~179–221 zł/год) і ці падаць польскую марку да публічнага анонсу; раздзел 5 брыфа мае гатовыя 8 пытанняў да патэнтнага паверанага. Купля дамена і падача маркі — дзеянні чалавека, брыф іх не выконвае.
PR: https://github.com/vokhandcrafts/KUDY/pull/720 (issue #692)

### 2026-10-11 — дошкі: вырашы лёс старога клейма #695
Што зрабіць: Codex узяў #695 (G24.04) 10.10, але ў issue і worktree бяз артэфактаў, PR і каментароў больш за 27 гадзін. Або знімі `agent:running` і верні задачу ў `agent:ready`, або дамовіся з Codex-сэсіяй пра працяг.
Issue: https://github.com/vokhandcrafts/KUDY/issues/695

### 2026-10-09 — G21.42: змержуй дэльту рашэння і ўнясі Blocked-by у #669 і #670
Што зрабіць: змержуй PR — ён запісвае твой адказ на квіз #623 і закрывае issue. Потым унясі ў целы #669 і #670 радкі `Blocked-by: #711` для бачных частак; дакладны тэкст у `docs/agent-tasks/results/G21.42.md`. Токен сесіі атрымаў 403 на абнаўленне issue. Пасля мержу здымі з #623 пазнаку `agent:blocked`.
PR: https://github.com/vokhandcrafts/KUDY/pull/712 — issue #623

### 2026-10-08 — правер бачнасць дызайн-задач G25 на дошцы
Адкрый GitHub Project і правер, што #700–#708, а таксама #693 і #694 бачныя ў backlog; калі карткі не дададзеныя, дадай іх без пазнак запуску. Аўтаматычная праверка дошкі недаступная: токен не мае `read:project`; самі Issues створаныя і перачытаныя.
Issue: https://github.com/vokhandcrafts/KUDY/issues/699

### 2026-10-08 — змержуй PR пра мяжу часу тэстаў
Што зрабіць: змержуй PR. Ён абмяжоўвае чаканне Chrome у доказе карты і ставіць мяжу часу на job `tests` і на `node --test`, каб завіслы файл не трымаў required-checks да адмены на 360 хвілінах.
PR: https://github.com/vokhandcrafts/KUDY/pull/698

### 2026-10-08 — G21.36: змержуй PR па Android-зборцы на Windows і, калі хочаш, прыбяры старыя junction
Што зрабіць: прагледзь і змержуй PR — ён дадае `tools/android-build/` (праверка, скопавая чыстка, абмежаваная
зборка, сцэнарыі на эмулятары) і раздзел у `docs/development_setup.md`; закрывае #592. Па жаданні: у агульным
checkout `C:\Users\kamyl\WebstormProjects\KUDY` з рэтэсту засталіся junction-тэчкі `build` у `node_modules`, якія
вядуць у `D:\KUDY-Android\build`. Калі той checkout будзе на `main` з гэтым PR і без незавершанай працы, паглядзі спіс
камандай
`node tools/android-build/android-build.mjs clean --build-root D:\KUDY-Android --sdk <SDK> --jdk <JDK17>` (без `--apply`
нічога не выдаляецца) і толькі потым вырашай пра `--apply`.
PR: https://github.com/vokhandcrafts/KUDY/pull/689 (issue #592)

### 2026-10-08 — G21.44.b: змержуй PR #690
Што зрабіць: змержуй PR. Ён кладзе на публічны origin толькі запісы `public/` у `release-manifest.json`; поўны маніфест застаецца ўнутраным файлам staging. Мерж закрые #682.
PR: https://github.com/vokhandcrafts/KUDY/pull/690 (issue #682)

### 2026-10-07 — G21.45: змержуй PR #686 і вырашы калізію ідэнтыфікатара з #669
Што зрабіць: змержуй PR — ён дадае ў цела ADR G21.20 датаваныя зносіны §3.2/§3.4
па тваёй рэзалюцыі (#552) і закрывае #678; фармулёўку зносінаў праглядзі перад
мержам (гэта рашэнне-дакумент). Таксама вырашы калізію ідэнтыфікатара G21.45:
яго носяць #678 (гэтая, вынікі ў `docs/agent-tasks/results/G21.45.md`) і #669
(zh, яшчэ не пачатая) — перанумаруй #669 або яўна пакінь як ёсць.
PR: https://github.com/vokhandcrafts/KUDY/pull/686 (issue #678)

### 2026-10-07 — G21.44: змержуй PR #677
Кантракт абароны кантэнту прыняты і запісаны (рашэнне ў #657), задачы G21.44.a–c (#681–#683), адкладзены эпік маніторынгу (#684) і даследаванне ватэрмаркавання (#685) публікаваныя ў backlog. Засталося толькі змержыць PR — ён закрывае #657.
PR: https://github.com/vokhandcrafts/KUDY/pull/677 (issue #657)

### 2026-10-07 — G21.30: вырашы, ці перанумастроўваць #675 (калізія ідэнтыфікатара з #562)
Што зрабіць: ідэнтыфікатар G21.30 носаць дзве задачы — закрытая #562 (ацэнка CLDR, вынікі ў `docs/agent-tasks/results/G21.30.md`) і змержаная сёння #675 (сінхранізм run-мадэлі, вынікі ў `G21.30-run-model-sync.md`). Калі ласка, перанумаруй загаловак #675 на вольны нумар (напрыклад G21.51; G21.50 заняты #711) або яўна пакінь як ёсць — каб будучыя пошукі вынікаў па ідэнтыфікатары не блыталі дзве задачы.
PR: https://github.com/vokhandcrafts/KUDY/pull/679 — issue #675

### 2026-10-05 — stale-restatement: каментар інвентарызацыйнага тэсту (issue #644)
Што зрабіць: змержыць PR #645 — дробны фікс каментара `registryProjected`
(дапоўнены пералік fr і cs) + must-flag запіс `key: stale-restatement`.
PR: https://github.com/vokhandcrafts/KUDY/pull/645 — issue #644

### 2026-10-05 — G21.19: змержыць глоссарый і працэс змены мов (задача #543)
Што зрабіць: праглядзі і змержы PR #628 у main, каб глоссарый тэрмінаў, працэс змены радкоў ва ўсіх выпушчаных мовах і крытэрыйны рэндэр лічэбнікаў сталі даступныя выканаўцам. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам; мерж закрывае #543 і разблакіруе каталогі G21.10–G21.14.
PR: https://github.com/vokhandcrafts/KUDY/pull/628 (issue: https://github.com/vokhandcrafts/KUDY/issues/543; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-05 — G22.08: змержыць выдаленне дзвюх нявыкарыстаных абгортак (задача #613)
Што зрабіць: праглядзі і змержы PR #627 у main. Змена дробная і толькі адымальная (2 runtime-файлы, 22 радкі; прадукцовае паводзіны і кантракты не кранутыя), таму па hook v3 крок 0 яна ідзе без рэвью-агентаў і без аўтамержу — мерж за чалавекам; пасля мержу задача #613 закрыецца аўтаматычна (Closes #613).
PR: https://github.com/vokhandcrafts/KUDY/pull/627 (issue: https://github.com/vokhandcrafts/KUDY/issues/613)

### 2026-10-05 — G21.43: праглядзі план даследавання кітайскай
Што зрабіць: праглядзі і змержы PR #624 пасля паспяховых праверак, каб спецыфікацыя і брыфы кітайскіх даследаванняў былі даступныя ў галоўнай галіне. Гэта закрые перадумову #619; запуск даследаванняў патрабуе асобнага рашэння.
PR: https://github.com/vokhandcrafts/KUDY/pull/624 (issue: https://github.com/vokhandcrafts/KUDY/issues/619)

### 2026-10-04 — G20.14: змержыць гарды адкату Expo-адаптараў (задача #485)
Што зрабіць: праглядзі і змержы PR #615 у main. Змена дробная (адзін тэставы гард + results-файл, бяз продакшн-кода), ідзе без рэвью-пайплайну па hook v3 крок 0, таму мерж за чалавекам; гейты на галінцы зялёныя (npm test, arch:check, jscpd). Пасля мержу задача #485 закрываецца аўтаматычна (Closes #485).
PR: https://github.com/vokhandcrafts/KUDY/pull/615 (issue: https://github.com/vokhandcrafts/KUDY/issues/485; эпік: https://github.com/vokhandcrafts/KUDY/issues/470)

### 2026-10-04 — G16.03: змержыць рэндэр-тэст прэсу Back (задача #599)
Што зрабіць: праглядзі і змержы PR #602 у main. Змена дробная (новы тэст + must-flag радок, бяз продакшн-кода), пайплайн па hook v3 крок 0 ідзе без рэвью-агентаў і без аўтамержу, таму мерж за чалавекам; пасля мержу задача #599 закрываецца аўтаматычна (Closes #599).
PR: https://github.com/vokhandcrafts/KUDY/pull/602 (issue: https://github.com/vokhandcrafts/KUDY/issues/599)

### 2026-10-04 — Праверка GPS і «Побач», PR #517
Праглядзі PR #517 і вынікі праверак GitHub перад мержам. На Android/iOS правер позні запуск GPS пасля спынення і пераход «Побач» у фон з дзейнай прагулкай: тэсты з заменнікамі даказваюць толькі парадак аперацый і вызваленне падпісак.
PR: https://github.com/vokhandcrafts/KUDY/pull/517 (задача: https://github.com/vokhandcrafts/KUDY/issues/479)

### 2026-10-04 — Уключы спецыфікацыю эфектыўнасці ў галоўную галіну
Што зрабіць: злій PR #601 пасля паспяховых праверак, каб спецыфікацыя і задачы былі даступныя выканаўцам у галоўнай галіне. Гэта закрые перадумову #605; запуск задач патрабуе асобнага рашэння.
PR: https://github.com/vokhandcrafts/KUDY/pull/601

### 2026-10-03 — G21.07: пацвердзі на Windows-хасце named-скіпы filesystem-сютаў
Што зрабіць: на сваёй Windows-машыне прабягі `node --test --experimental-strip-types web/lib/content/entry-boundary.test.ts` і `node --test tools/collector/cli.test.mjs` і пераканайся, што дзесяць capability-тэстаў з #540 даюць именаваныя скіпы (EPERM / EINVAL / «mode bits are not enforced»), а астатнія тэсты зялёныя. Альтэрнатыўна — аўтарызуй агенту даданне абодвух сют у job `windows-portable` (`.github/workflows/required-checks.yml` без аўтарызацыі змяняць забаронена). Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #540.
PR: https://github.com/vokhandcrafts/KUDY/pull/575 (issue: https://github.com/vokhandcrafts/KUDY/issues/540; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-03 — G21.08: пацвердзі на Windows-хасце, што карпусныя сьюты зялёныя без EPERM
Што зрабіць: на сваёй Windows-машыне прабягі `node --test tools/corpus/store.test.mjs tools/corpus/backup.test.mjs` (або поўны `npm test`) і пераканайся, што cleanup прыбірае часовыя тэчкі без васьмі EPERM-няўдач, запісаных у #541, а тэстар не пакідае жывых хэндлаў. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #541.
PR: https://github.com/vokhandcrafts/KUDY/pull/574 (issue: https://github.com/vokhandcrafts/KUDY/issues/541; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-03 — G21.05: пацвердзі на Windows-хасце, што дзве CI-гварды зялёныя
Што зрабіць: на сваёй Windows-машыне прабягі `node --test tools/ci/deno-typecheck.test.mjs tools/ci/test-discovery.test.mjs` (або поўны `npm test`) і пераканайся, што тэсты з пазнакай (G21.05) зялёныя, а дзве няўдачы з лагу рэтэсту 2026-10-03 (`device\index.ts` і `app\…`-прэфіксы) зніклі. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #538.
PR: https://github.com/vokhandcrafts/KUDY/pull/572 (issue: https://github.com/vokhandcrafts/KUDY/issues/538; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-02 — Engine mutation gate: дадай `engine-regressions` у required statuses (задача #501)
Што зрабіць: у GitHub UI (Settings → Branches → protection галіны main) дадай новы статус `engine-regressions` да required checks поруч з `server-typecheck` — бачнасць branch protection з сесіі не праверыць (токен без адпаведных scope), а без гэтага новы job застаецца неабавязковым. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #501.
PR: https://github.com/vokhandcrafts/KUDY/pull/529 (issue: https://github.com/vokhandcrafts/KUDY/issues/501; эпік: https://github.com/vokhandcrafts/KUDY/issues/470)

### 2026-10-02 — Deno type-check: дадай `server-typecheck` у required statuses (задача #484)
Што зрабіць: у GitHub UI (Settings → Branches → protection галіны main) дадай новы статус `server-typecheck` да required checks — з сесіі бачнасць branch protection не праверыць (токен без адпаведных scope), а без гэтага новы job застаецца неабавязковым. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #484.
PR: https://github.com/vokhandcrafts/KUDY/pull/519 (issue: https://github.com/vokhandcrafts/KUDY/issues/484; эпік: https://github.com/vokhandcrafts/KUDY/issues/470)

### 2026-10-02 — Ліміт grant-запытаў: правераная ква deployment-а (задача #499)
Што зрабіць: перад рэальным запускам grant-функцыі запішы ў задачу #499 правераную квоту RevenueCat гэтага deployment-а і, калі дэфолт 30 запытаў/год на прыладу (канстанты ў `grant-core.ts`) не пасуе, назаві патрэбнае значэнне — агульнай праверанай квоты зараз няма, і агент наўмысна яе не выдумаў. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #499.
PR: https://github.com/vokhandcrafts/KUDY/pull/514 (issue: https://github.com/vokhandcrafts/KUDY/issues/499; эпік: https://github.com/vokhandcrafts/KUDY/issues/470)

### 2026-10-02 — Правер раздзеленых скопаў дазволу GPS і мерж PR G20.07 (закрывае #478)
Што зрабіць: праглядзі дэма і выніковы файл задачы — раздзяленне foreground/background дазволаў у GPS-адаптары, фонавая адмова больш не дэзармуе жывую сесію (дыялогі Android/iOS і фізічная фонавая праца свядома не правераныя мокамі і застаюцца прыёмкай на прыладзе). Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #478.
PR: https://github.com/vokhandcrafts/KUDY/pull/509 (issue: https://github.com/vokhandcrafts/KUDY/issues/478; эпік: https://github.com/vokhandcrafts/KUDY/issues/470)
### 2026-10-02 — Хук `run-gitleaks-git.py` блакуе пуш squash-комітаў main з `Co-authored-by:`
Што зрабіць: у `C:\Users\kamyl\.githooks\run-gitleaks-git.py` зрабі праверку трэйлера email-адчувальнай да рэгістра (GitHub піше `Co-authored-by:`, а хук дазваляе толькі кананічнае `Co-Authored-By:`) — зараз кожны пуш, што нясе мерж main з чужымі squash-комітамі, спыняецца з «Push blocked … email». Каманда для хуткай праверкі: `grep -n "Co-Authored-By" C:\\Users\\kamyl\\.githooks\\run-gitleaks-git.py`.
PR: https://github.com/vokhandcrafts/KUDY/pull/512 (задача #475 — пуш фіксаў упёрсяся ў хук; абмінуты праз адмову ад лакальнага мержу main, не праз --no-verify)

### 2026-10-02 — Прагляд спецыфікацый выпраўленняў архітэктуры і чаргі G20
Паўторна праглядзі выпраўленні рэвью, тры спецыфікацыі і чаргу G20 у PR #494: дададзеныя G20.23–28, бясплатнае падключэнне больш не чакае акаўнтаў крам. Калі патрэбныя праўкі або публікацыю трэба спыніць — скажы агенту да мержу; пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #471. Пазнакі гатоўнасці задач не дадавай да праверкі іх перадумоў; дазвол на дакладныя змены workflow запісваецца асобна ў #493.
PR: https://github.com/vokhandcrafts/KUDY/pull/494 (бацькоўская задача: https://github.com/vokhandcrafts/KUDY/issues/470)

### 2026-10-02 — Рэв'юй uk-радкі як носьбіт і смержы PR G14.04.d (закрывае #305)
Што зрабіць: прачытай uk-радкі ў трох зонах — `components/ui-strings.ts`, пяць кантролер-слоўнікаў (`previewController`, `runMap`, `placeDetailController`, `nearbySurfaceController`, `commerceController`) і `web/lib/i18n/uk.ts` — і папраў мову дзе трэба: рэв'ю носьбіта uk належыць табе па рашэнні 6.4 uk-release-scope. Пасля правак (або без іх) смержы PR squash-мержам пасля зелёнага CI — ён закрые issue #305.
PR: https://github.com/vokhandcrafts/KUDY/pull/469 (issue: https://github.com/vokhandcrafts/KUDY/issues/305)

### 2026-10-01 — Прагледзь спецыфікацыю даследчай бібліятэкі G19
Што зрабіць: прагледзь спецыфікацыю `docs/25_content_research.md` і план `docs/superpowers/plans/2026-10-01-content-research.md`; пацвердзі іх або пазнач патрэбныя праўкі. Пасля прагляду і рэв'ю зліце PR дакументаў, каб яны сталі даступнымі выканаўцам; запуск задач і мадэльныя рашэнні G19.08 застаюцца асобным рашэннем.
PR: https://github.com/vokhandcrafts/KUDY/pull/467 (issue: https://github.com/vokhandcrafts/KUDY/issues/457; эпік: https://github.com/vokhandcrafts/KUDY/issues/456)

### 2026-10-01 — Правядзі uk-рэв'ю трох новых драфтаў першага гіда (G14.04.c)
Што зрабіць: ты — названы uk-рэв'юер-носьбіт (§6.4 uk-release-scope). Праглядзі `authoring/gdansk/review/gdansk-{townhall-base-uk,artushof-base-uk,stmary-uk}.review.md` (кожны факт побач з цытатай і локатарам), правер uk-формы ўласных назваў (табліца ў `docs/agent-tasks/results/G14.04.c.md`) і паставь пазнакі claims (`mark` з `mark_by`/`mark_at`) ды рашэнні рэвю (`review.decision`) у драфтах — без гэтага пераклад не прыняты. Пры заўвагах паправі тэкст драфтаў у тым жа каміце.
PR: https://github.com/vokhandcrafts/KUDY/pull/468 (issue: https://github.com/vokhandcrafts/KUDY/issues/304)

### 2026-10-01 — Вырашы лёс кода G17.17: issue #407 закрыта без дастаўкі
Што зрабіць: issue #407 закрыта 29.09, але яе рэалізацыя (паўзук спасылак са старонак без артыкульнага тэксту — змены ў `tools/collector/crawler.mjs` і `extract.mjs` з тэстамі) існуе толькі незакомічанай у галоўным чэкаўце — гэтай копіі няма ні ў адной галінцы, ні ў main. Скажы агенту зрабіць ратавальны PR з новай галінкі ад main (код + правілы `.gitignore`/AGENTS пра parsed-content), альбо адкінь код.
PR: няма (issue: https://github.com/vokhandcrafts/KUDY/issues/407)

### 2026-10-01 — Закрый завершаныя эпікі #400/#346/#154 і паглядзі лэйбл #283
Што зрабіць: усе даччыныя задачы закрытыя — закрый эпік #400 (G06.10, дзеці #401–#406), эпік #346 (дызайн-выпраўленні, дзеці #347–#355) і эпік #154 (G17, задачы закрытыя). Заразом паглядзі закрытую #283: на ёй вісяць лэйбл agent:ready — зняць ці пакінуць, рашэнне аператара.
PR: няма (issues: https://github.com/vokhandcrafts/KUDY/issues/400, https://github.com/vokhandcrafts/KUDY/issues/346, https://github.com/vokhandcrafts/KUDY/issues/154, https://github.com/vokhandcrafts/KUDY/issues/283)

### 2026-09-30 — Смержыць PR #420: даслоўная цытата канона ў results G06.10.b (issue #412)
Змержы PR #420 squash-мержам пасля зелёнага CI — ён закрывае issue #412: цытата радка канона `fontLicenses.*.selfHost` у results G06.10.b замененая на даслоўную, у must-flag дададзены клас `canon-quote-truncated`. Пасля мержу знімі лэйбл `agent:running` з issue #412.
PR: https://github.com/vokhandcrafts/KUDY/pull/420 (issue: https://github.com/vokhandcrafts/KUDY/issues/412)
### 2026-09-30 — Перабудаваць development build перад прыладным тэстам (G06.10.f)
У PR #419 з'явіўся першы натыўны модуль анімацыі (`react-native-reanimated` + `react-native-worklets`) — стары dev-client APK на эмулятары/прыладзе яго не мае і экран Run упадзе. Перабудуй dev-кліент (`npx expo run:android`) перад чарговым прыладным прагонам.
PR: https://github.com/vokhandcrafts/KUDY/pull/419 (issue: https://github.com/vokhandcrafts/KUDY/issues/406)
### 2026-09-30 — Рашэнне па AC4 у issue #403 (G06.10.c, іконкі)
Адкажы на blocked-каментар у issue #403: прыняць render-узровень як выкананне крытэра 4 (жывыя скрыншоты прэв'ю немагчымыя без digest-порта прылады і L02 — гл. каментар) з пераносам скрыншотаў у будучую задачу, альбо дай іншую пастанову. Пасля адказу знімі agent:blocked — пайплайн (суддзя + мерж PR #417) даб'е задачу сам.
PR: https://github.com/vokhandcrafts/KUDY/pull/417 (issue: https://github.com/vokhandcrafts/KUDY/issues/403)
### 2026-09-29 — Прагляд пілотнай выбаркі Гданьска (крытэр 5 спецы 24)
Адкрый аглядны бандл пілотнай кампаніі (`tools/collector/runtime/snapshots/392c8f36aa3f/review/index.md` на машыне аўтара, 90 дакументаў) і пазнач, што выбарка чыстая: без меню і рэкламы, змест поўны, фотам пілот свядома не мае (межа транспарту медыя — вынікі G17.08, знаходка F-1). Подпіс пад выбаркай закрывае крытэр 5 спецы 24.
PR: спасылка дадасца ў каменце issue #163 (issue: https://github.com/vokhandcrafts/KUDY/issues/163)

### 2026-09-29 — Смержыць PR #388: спека 24 прынятая + чыстка human-actions (закрыццё issue #153)
Што зрабіць: смержы PR #388 squash-мержам — чарнавік-банеры спецы 24 знятыя (спека зацверджана 2026-09-29), з гэтага файла прыбраныя пяць выкананых запісаў (#382/#364/#333/#327 мержы, прыняцце ADR G01.05), у .gitguard-allow дазволены мід-дот. Пасля мержу issue #153 закрыецца (`Closes #153`), але пытанні 2 (партал) і 5 (крыніцы фота) у ім застаюцца адкрытымі — рашэнне за табой.
PR: https://github.com/vokhandcrafts/KUDY/pull/388 (issue #153)

### 2026-09-27 — Юрыдычная праверка тэксту прыватнасці перад рэлізам
Што зрабіце: перад падачай у крамы (G11.04, #299) дайце тэкст старонкі прыватнасці (`web/lib/i18n/be.ts`, `web/lib/i18n/en.ts` — ключы `privacy*`) на праверку вонкаваму адвакату; пры заўвагах паправіце тэкст і запішыце вынік каментарам у issue. Рашэнне пра платную праверку — ваша (out of scope задачы #331).
PR: https://github.com/vokhandcrafts/KUDY/pull/332 (issue #331)

### 2026-09-26 — Пазначыць новыя issues #278–#307 для дыспетчара
Праглядзі 30 новых issues #278–#307 (нерэалізаваныя радкі `docs/16`) і паставь ім `agent:ready` + `prio:N` на свой выбар — пазнакі ставіць толькі аператар. Хуткі старт: #62 (G06.01); і падумай пра закрыццё tracking-бацькоў #188/#204/#205, чые дзеці даўно змержаныя — іх закрыццё разблакіруе хвалю #278 → #285.
Issue: https://github.com/vokhandcrafts/KUDY/issues/278 (далей па нумарах да #307)

### 2026-09-25 — Чыстка гісторыі: падтрымка GitHub і git config на Windows
Што зрабіце: 1) дашліце запыт у GitHub Support (https://support.github.com/request, «Remove data from GitHub») на вычышчанне недасяжных камітаў — у закрытых PR трох рэпаў старыя каміты з viktar.kamylevich@seranking.com застаюцца даступнымі праз refs/pull/* і кэш, пакуль GitHub іх не счасце. 2) На Windows-машыне заменіце `git config --global user.email` на `293595955+vokhandcrafts@users.noreply.github.com` — seranking-адрас прыехаў у гісторыю адтуль; на гэтай машыне лакальныя канфігі ўжо выстаўлены. Бэкап старой гісторыі да перапісу: /home/viktar/backups/repo-rewrite-2026-09-25/.
PR: няма (пераюз гісторыі: KUDY main 3f85707, ai-company-infrastructure main 9558bda, vok-handcrafts main c6ef4b0)

### 2026-09-25 — G17.05: устанавіць yt-dlp для жывых запускаў
Што зрабіце: устанавіце `yt-dlp` на гэтай машыне (напрыклад, `pip install yt-dlp` або pacman-сборку) — без яго `run` кампаніі з YouTube-ідэнтыфікатарамі адказвае дыягностыкай «binary not found» і крокі ідуць у `failed` (транскрыпты не губляюцца, крокі можна паўтарыць новым `run` толькі для pending; ужо failed-крокі не перазапускаюцца). Пасля ўстаноўкі запішыце запінаваную версію ў `docs/agent-tasks/results/G17.05.md` (раздзел Decisions) — патрабаванне брыфа G17.05.
PR: https://github.com/vokhandcrafts/KUDY/pull/263 (issue #160)

### 2026-09-25 — G17.02: рашэнне пра сеткавы транспарт фота
Што зрабіце: вырашыце, ці заводзіць задачу на сеткавую загрузку фота ў паўзуку — зараз мяжа медыя-лойдара засталася `file://`-фікстурай G17.03, таму image-крокі жывога кралу ідуць у `failed` з іменаванай дыягностыкай, а крал, здымкі і `raw_records` працуюць. Калі так — сфармулюйце крытэры (browers як loadImage праз той самы кантэкст Playwright); калі не — запіс выдаляецца.
PR: https://github.com/vokhandcrafts/KUDY/pull/257 (issue #157, суддзёўскія issues #259–#261)

### 2026-09-25 — G05.01.d: рашэнне пра замарозку run-model
Што зрабіць: вырашыце, ці замарожваць `docs/run-model/` як гістарычную даведку — парытэт даказаны (67/67 сцэнарыяў праз прадакшн `step()`, інварыянты 1–9, 21/21 мутацый), таму README называе гэты перанос выкананым. Калі так — гэта асобная задача ўласніка дакумента (адзіны дазволены спосаб мець run-model файлы).
PR: https://github.com/vokhandcrafts/KUDY/pull/256 (issue #201)

### 2026-09-25 — G05.02.c: прыладавыя праверкі адаптара лакацыі
Што зрабіць: калі з'явіцца Android-тэлефон — прайсці дзевяць клетак матрыцы G00.01.b, якія абслугоўвае адаптар лакацыі (foreground+dwell, заблакаваны экран, фон, адмова/адкліканне дазволу, GPS-прабел, зняцце з recent apps, force-stop, перазагрузка, battery saver) па кроках з табліцы ў выніковым файле `docs/agent-tasks/results/G05.02.c.md` і запоўніць фактычныя вынікі. Да таго ўсе клеткі застаюцца `not-run` (blocked-external); да мержу нічога рабіць не трэба.
PR: https://github.com/vokhandcrafts/KUDY/pull/253 (issue #212)

### 2026-09-24 — G05.03.b: прыладавыя праверкі аўдыё-адаптара
Што зрабіць: калі з'явіцца Android-тэлефон і development build — прайсці шэсць клетак матрыцы G00.01.b, якія абслугоўвае аўдыё-адаптар (заблакаваны экран, фон, званок/іншае аўдыё, Pause/End/яўны Resume, хуткія Play/Stop і паўтор файла, battery saver) па кроках з табліцы ў выніковым файле `docs/agent-tasks/results/G05.03.b.md` і запоўніць фактычныя вынікі ў матрыцы. Да таго ўсе клеткі застаюцца `not-run` (blocked-external).
PR: https://github.com/vokhandcrafts/KUDY/pull/242 (issue #214)

### 2026-09-23 — пятая хваля задач дадатку: пазнакі па меры разблакіроўкі
Што зрабіць: брыфы ўжо ў main, `agent:ready` стаіць на #208 — адзінай частцы без Blocked-by. Астатнім частакам #209–#221 пазнаку ставіць пасля закрыцця іх Blocked-by. Прыладных праверак гэтая хваля не робіць (ваша рашэнне): G05.02.c і G05.03.b пакінуць спіс `not-run` клетак для запуску на тэлефоне.
Issue: https://github.com/vokhandcrafts/KUDY/issues/208 (адсочвальныя #202–#207)

(пуста — усе астатнія запісаныя дзеянні зроблены)
### 2026-09-22 — зацвердзіць пратотып G06.08 (крытэрый 3 issue #61)
Праглядзіце пратотып у `spikes/G06.08-prototype/` (запуск: `npm run prepare` і `npm run serve` у тэчцы спайка; сцэнары — у `package/screens.md`) і ў рэвю PR скажыце, ці зацвярджаеце пратотып для задач G06.01+. Без вашага зацвярджэння крытэрый 3 застаецца адкрытым; заўвагі па зрэзе дызайну запішыце ў рэвю — G06.06/G06.07 іх павінны ўлічыць.
PR: https://github.com/vokhandcrafts/KUDY/pull/175 (issue #61)


### 2026-09-21 — спецыфікацыя збору сыравіны з сеткі: рэвю PR #152 і рашэнні заснавальніка (G17)
Што зрабіць: PR #152 змержаны — засталося адказаць у tracking-ісью #153 на пяць рашэнняў заснавальніка: зацвярджэнне спецыфікацыі, пілотны навінны партал, патрэба ў распазнанні голасу, слоўнік тэм, крыніцы фота для гайдаў — без іх пілот G17.08 не стартуе. Каб запусціць распрацоўку, паставьце на эпік #154 пазнаку `epic`, а на задачах #155–#163 — `agent:ready`/`prio:*` (пазнакі ставіць толькі аператар).
Issue: https://github.com/vokhandcrafts/KUDY/issues/153 (эпік #154, задачы #155–#163)

### 2026-09-21 — рэв'ю сцэнара першага гіда (G03.02)
Што зрабіць: правядзіце аўтарскае рэвю кампазіцыі першага гіда — адзначце ў `authoring/gdansk/claims.json` усе 16 цвярджэнняў (`mark` ok/rejected з `mark_by` і `mark_at`), прыміце рашэнні па сямі драфтах і праекце сцэнара `scenarios/gdansk-first-walk.json` (тэма, склад і парадак кропак вызначае аўтар, 13 §1); агляды з цытатамі і локатарамі друку — у `authoring/gdansk/review/`.
PR: https://github.com/vokhandcrafts/KUDY/pull/150 (issue #58)


### 2026-09-21 — аўтарскае рэвю discovery-кантэнту пасля мержу PR #151 (G15.02)
Што зрабіць: PR #151 ужо змержаны ў main (e6f4777) — правядзіце аўтарскае рэвю першага рэальнага discovery-кантэнту па `docs/content/discovery-editorial-log.md`: паставьце `mark` цвярджэнням EB1911 у `authoring/gdansk/claims.json` (гэтыя факты анкераваны на карткі месцаў і гіда), праверце каардынаты/час/адлегласці для палявой праверкі і прыміце так/не па падборцы «Гданьск за паўдня». Дадаткова: вырашыце лёс накіду паралельнай сесіі — ён захаваўся ў гісторыі git (дададзены fe68aaf, зняты a55f213), у main не трапілі; ці засталіся яго файлы на дыску іншай сесіі — невядома. Дублетная заяўка на #69 задакументаваная ў каментарах PR #151 і issue #69.
PR: https://github.com/vokhandcrafts/KUDY/pull/151 (issue #69, закрыты)

### 2026-09-21 — перанос Blocked-by паводле TR-10 (4 issue)
Што зрабіць: прачытай пералікі TR-10 у каментарах [#56](https://github.com/vokhandcrafts/KUDY/issues/56#issuecomment-5753677647), [#58](https://github.com/vokhandcrafts/KUDY/issues/58#issuecomment-5753677741), [#61](https://github.com/vokhandcrafts/KUDY/issues/61#issuecomment-5753677833), [#68](https://github.com/vokhandcrafts/KUDY/issues/68#issuecomment-5753677908) і прымі рашэнне пра звужэнне; пры згодзе перанесі пазнакі `Blocked-by` сам (змены пазнак — за дыспетчарам). Для #68 дадаткова: знімі супярэчнасць task-файла з `blocked-external` G00.04 і паправі уваход `contracts/discovery.ts`.
Пералікі: каментары ў #56, #58, #61, #68; PR няма, звязаныя issue — тыя самыя.

(пуста — усе астатнія запісаныя дзеянні зроблены)


(пуста — усе астатнія запісаныя дзеянні зроблены)
### 2026-09-23 — адчапіць памяць ZCode ад рэпы Tool-Lib на Windows
Што зрабіць: на Windows-машыне замяні сімлінк/junction `~/.zcode/cli/memories` (вёў у `Tool-Lib/ai/zcode/memories`) на звычайную лакальную тэчку — рэпа пасле pull болей не змяшчае памяць, і аўтапуш яе не здымае. Патрэбныя старыя памяці аднойчы аднаві з гісторыі (`git show f950005^:ai/zcode/memories/projects/<праект>/...`). На CachyOS ужо перанесена (лакальная тэчка, 107 файлаў).
Tool-Lib: https://github.com/vokhandcrafts/Tool-Lib/commit/f950005b0d12936c63cc411e7adb3d81d9659f70



(пуста — усе астатнія запісаныя дзеянні зроблены)
