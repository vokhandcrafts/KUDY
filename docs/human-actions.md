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

### 2026-10-04 — G16.03: змержыць рэндэр-тэст прэсу Back (задача #599)
Што зрабіць: праглядзі і змержы PR #602 у main. Змена дробная (новы тэст + must-flag радок, бяз продакшн-кода), пайплайн па hook v3 крок 0 ідзе без рэвью-агентаў і без аўтамержу, таму мерж за чалавекам; пасля мержу задача #599 закрываецца аўтаматычна (Closes #599).
PR: https://github.com/vokhandcrafts/KUDY/pull/602 (issue: https://github.com/vokhandcrafts/KUDY/issues/599)

### 2026-10-04 — G21.20: зацвердзі ADR ідэнтычнасці моў гіда
Што зрабіць: прачытай `docs/architecture/decisions/G21.20-language-identity.md` (кантракт §3) і запішы ў issue выразнае зацвярджэнне або правкі; пасля прыняцця перавядзі статус файла ў шапцы ў «прынята». Рэалізацыя G21.21 пачынаецца толькі пасля гэтага зацвярджэння.
Issue: https://github.com/vokhandcrafts/KUDY/issues/552 (PR: https://github.com/vokhandcrafts/KUDY/pull/593; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-03 — G21.07: пацвердзі на Windows-хасце named-скіпы filesystem-сютаў
Што зрабіць: на сваёй Windows-машыне прабягі `node --test --experimental-strip-types web/lib/content/entry-boundary.test.ts` і `node --test tools/collector/cli.test.mjs` і пераканайся, што дзесяць capability-тэстаў з #540 даюць именаваныя скіпы (EPERM / EINVAL / «mode bits are not enforced»), а астатнія тэсты зялёныя. Альтэрнатыўна — аўтарызуй агенту даданне абодвух сют у job `windows-portable` (`.github/workflows/required-checks.yml` без аўтарызацыі змяняць забаронена). Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #540.
PR: https://github.com/vokhandcrafts/KUDY/pull/575 (issue: https://github.com/vokhandcrafts/KUDY/issues/540; эпік: https://github.com/vokhandcrafts/KUDY/issues/532)

### 2026-10-03 — G21.08: пацвердзі на Windows-хасце, што карпусныя сьюты зялёныя без EPERM
Што зрабіць: на сваёй Windows-машыне прабягі `node --test tools/corpus/store.test.mjs tools/corpus/backup.test.mjs` (або поўны `npm test`) і пераканайся, што cleanup прыбірае часовыя тэчкі без восьмі EPERM-няўдач, запісаных у #541, а тэстар не пакідае жывых хэндлаў. Пры зелёных вердыктах рэвью і суддзі пайплайн мержыць PR сам, гэта закрывае #541.
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
