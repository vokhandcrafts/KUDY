# APR-08.c — Android mediaPlayback foreground service

Задача: [#854](https://github.com/vokhandcrafts/KUDY/issues/854). Працоўная галіна: `codex/854`. Статус: **часткова праверана; натыўная прыёмка яшчэ не завершана**.

## Рашэнне і межы доказу

Для аўдыяпрагулкі захаваны `mediaPlayback` FGS з архітэктуры §6.3. Адаптар пасля фізічнага `play()` выклікае падтрыманы Expo Audio 1.1.1 `setActiveForLockScreen(true, { title: 'KUDY' })`. Ён прыбірае lock-screen controls пры канцы або памылцы трэка, замене крыніцы, Stop і dispose. Паўза і працяг пакідаюць той самы media session. Памылка актывацыі ідзе ў існы `failed`-шлях і вызваляе плэер.

Frozen unit-тэсты, зыходнік SDK і Android debug-прагон пацвердзілі актывацыю: mediaPlayback FGS і медыякартка KUDY былі бачныя на заблакаваным экране. Сінтэтычны ўваходны званок спыніў debug-прайграванне без аўтаматычнага працягу. Гэта яшчэ не release-доказ; канчатковы стан сэрвісу пасля Stop патрабуе асобнай натыўнай праверкі. Асобна варта праверыць імгненны Stop пасля Play: сэрвіс ствараецца асінхронна.

## Праверкі па крытэрыях #854

1. **Натыўны lifecycle — ЧАСТКОВА ПРАВЕРАНА.** [Android CI run 41311807431](https://github.com/vokhandcrafts/KUDY/actions/runs/41311807431) прайшоў на Android 36 з debug APK `by.kudy.app`, SHA-256 `70538f0e70abb1d2fa0f7fa61be5e1b57805e22dad69b5a9ec6d8c008c6ab8ab`. [Санітызаваны Stop trace](../../testing/evidence/2026-11-01-apr08c/android-debug-stop-trace.txt) фіксуе `AudioControlsService isForeground=true`, type `0x2` і foreground-медыяапавяшчэнне падчас Pause; праз 2 секунды пасля Stop foreground-радок не знойдзены ў фрагменце запісу сэрвісу і медыяапавяшчэнне знікла. [Відэа](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.mp4) (SHA-256 `c0f2be119e793e08aad29c1a809e0b8ad7d8ef0f8caf90ca00332e40ae868e3c`) і [кадр](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.png) папярэдняга CI-прагону паказваюць медыякартку KUDY з кнопкай Play на PIN-заблакаваным экране пасля Pause. [Android CI run 41316777091](https://github.com/vokhandcrafts/KUDY/actions/runs/41316777091) пацвердзіў [перапыненне ўваходным званком](../../testing/evidence/2026-11-01-apr08c/android-debug-call-trace.txt): media session перайшла ў PAUSED на 382 мс шасцісекунднага трэка і не аднавілася аўтаматычна пасля званка. Гэты CI-прагон не апублікаваў SHA свайго APK. Запіс сэрвісу пасля Stop застаўся, таму яго поўнае выдаленне не пацверджана. Release-білд таксама не правераны. Лакальны AVD выключаны пасля перагрузкі хоста.
2. **Падключэнне SDK — выканана на ўзроўні кода.** Адаптар выкарыстоўвае афіцыйны метад Expo Audio 1.1.1 і lifecycle cleanup. Чатыры зафіксаваныя да рэалізацыі acceptance-тэсты былі чырвоныя на базе і прайшлі пасля змены; файл тэстаў не змяняўся пасля фіксацыі ў `424825f0`.
3. **Production release manifest — праверана.** `:app:processReleaseMainManifest` прайшоў у абмежаваным scope. [Зліты маніфест](../../testing/evidence/2026-11-01-apr08c/AndroidManifest-production.xml) мае SHA-256 `879cf3ef3cc611fc992df48ba9f5d41b08f5c5120e1cef335f2ad04d0f23588e`. У ім ёсць location і mediaPlayback FGS, адзін неэкспартаваны `AudioControlsService`; няма microphone FGS, `AudioRecordingService` і `RECORD_AUDIO`. `test/android-merged-media-fgs.test.mjs` прайшоў на фактычным злітым XML і праваліўся пры кантрольным выдаленні mediaPlayback permission.
4. **[Перадача #299](https://github.com/vokhandcrafts/KUDY/issues/299#issuecomment-6558657499) — частковая.** Core use-case: карыстальнік запускае аўдыяпрагулку і чуе аповед пры заблакаваным экране. Трыгер: ручны Play або аўтаматычны старт гісторыі падчас запушчанай прагулкі. Затрымка або спыненне сэрвісу абрывае фонавае прайграванне і lock-screen кіраванне. Медыякартка на [Android-відэа](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.mp4) застаецца на заблакаваным экране ў стане Pause з кнопкай Play; пасля Stop foreground-апавяшчэнне знікла з журнала. **Production AAB з SHA адсутнічае; гэтае відэа не дае дазволу на Play Console submission.**
5. **Праверкі.** 24 мэтавыя Node-тэсты і Jest `app/device-root-audio.test.tsx` прайшлі лакальна; `npm run typecheck`, `npm run arch:check` (666 модуляў, 0 парушэнняў), `jscpd` (0 clones) прайшлі. [Showboat proof](../../demos/2026-11-01-apr08c-media-playback.md) прайшоў `verify` (4/4 unit-тэсты). [Design-QA](../../testing/evidence/2026-11-01-apr08c/design-qa.md) фіксуе даступны debug-здымак і адсутныя release/accessibility доказы. Лакальны поўны `npm test` быў спынены пры перагрузцы хоста і не залічваецца. Для head `455d3f0d` [CI required-checks](https://github.com/vokhandcrafts/KUDY/pull/948/checks) матрыца зялёная, уключаючы `tests (22)` і `tests (24)`; Android smoke 11/11, walk 6/6, discovery 4/4. Release Android праверка па-ранейшаму адсутнічае.

## Рэсурсны рэжым

Пасля перагрузкі ўсе ўласныя цяжкія працэсы і AVD былі спынены. Production manifest збіраўся з `MemoryMax=3G`, `MemorySwapMax=0`, `CPUQuota=100%`, адным Gradle worker; атрымаўся за 2 хвіліны 12 секунд. Поўны demo APK на тым самым хосце не атрыманы: `:app:packageRelease` адзначыў FAILED пасля ~24 хвілін пад 4 ГБ, а вузкі паўтор `packageRelease` спынены timeout-ам праз 3 хвіліны на `expo-constants:createExpoConfig`. У scope не было OOM або swap. Ніводзін з гэтых запускаў не пацвярджае runtime. Далейшыя Android build і E2E патрэбна запускаць на GitHub runner, не сумяшчаючы іх з лакальным эмулятарам.

Аддалены EAS не даў release-шляху: `eas-cli@24.7.0 project:info` адхіліў існы `eas.json` праз палі `build.*.android.package` і `build.*.ios.bundleIdentifier`. Чытальны запуск у часовай копіі без гэтых палёў паказаў, што EAS project не падключаны; новы праект не ствараўся. Існая GitHub workflow `android-e2e.yml` збірае толькі debug APK, а змяненне `.github` па-за межамі #854.

## Невыкананае перад закрыццём

- Праверыць на Android release APK/AAB з вядомым SHA start, pause, resume, stop, screen lock, interruption, notification і фактычны FGS lifecycle; запісаць санітызаваны trace і Android-відэа.
- На фінальным head паўтарыць поўную CI-матрыцу пасля з'яўлення release-доказу.
- Паўтарыць design-QA пасля з'яўлення натыўных capture; Showboat ужо правераны.

## Voka High: pending-media-session-after-stop (2026-11-01)

На head `b9a62f55` Voka знайшоў асінхронную гонку: `AudioControlsService.pendingPlayer` мог перажыць хуткі Play → Stop і аднавіць сесію пры пазнейшым `onCreate`. У PR дададзены ідэмпатэнтны натыўны патч, прывязаны да Expo Audio **1.1.1**, праз існы Android config plugin: `clearPlayer(player)` скасоўвае толькі адкладзеную або актыўную сесію гэтага плэера, а пусты сэрвіс пасля адкладзенага запуску спыняецца ў `onStartCommand`. Замена плэера не павінна адключаць іншага ўладальніка. Памылка распазнавання SDK спыняе prebuild, замест частковай падмены.

Даказальная лакальная праверка: `node --test tools/android-build/expo-audio-fgs-patch.test.mjs tools/e2e-android/walk.test.mjs tools/e2e-android/media-service-state.test.mjs` — **15/15**. Патч двойчы паспяхова прымяняўся да асобнай часовай копіі сапраўдных Kotlin-файлаў Expo Audio 1.1.1 (без змен у ўсталяванай залежнасці). Android E2E пасля двух хуткіх тапанняў Play/Stop правярае стан сэрвісу і апавяшчэння двойчы з затрымкай; вынік аддаленага запуску **NOT-VERIFIED**. Release-runtime па-ранейшаму **NOT-VERIFIED**.

## Voka High: service-stop-race-on-replacement (2026-11-01)

Пасля фіксацыі `f5a08704` Voka знайшоў другую гонку: `clearPlayer(A)` выклікаў `stopSelf()` да актывацыі B, і Android мог знішчыць новы MediaSession пры закрыцці старога сэрвісу. Прамы `stopSelf()` заменены на запланаванае праз 1000 мс завяршэнне, якое выконваецца толькі калі адсутнічаюць `currentPlayer` і `pendingPlayer`. Актывацыя B скасоўвае запланаванае завяршэнне; `onDestroy` выдаляе callback. Асобны Android E2E-сцэнар па чарзе запускае A і B, ставіць B на паўзу і двойчы правярае, што застаюцца foreground media service і notification.

Натыўныя Android вынікі на новым head, уключаючы гонкі замены і выпускны APK/AAB, пакуль **NOT-VERIFIED**. Лакальныя Node-тэсты правяраюць змест патча і яго паўторнае прымяненне, але не даказваюць паводзіны Android-сэрвісу; аддалены runner абавязковы перад закрыццём #854.

## Voka High + Medium (2026-11-01, head `1830b459`)

- **High — stop ужо запытаны да запуску B.** Папярэдняя 1000-мс адтэрміноўка не скасоўвала `stopSelf()` пасля яго выкліку. Натыўны патч цяпер пазначае сэрвіс як `stopRequested`; пры новым Play плэер захоўваецца ў `pendingPlayer`, а Android атрымлівае новы `startForegroundService`. Адкладзеную актывацыю прымаюць і `onStartCommand`, і `onCreate`. Калі стары сэрвіс усё ж выкліча `onDestroy` з актыўным B, ён перадасць B у новы lifecycle, не падмяняючы ўжо чаканага ўладальніка. Дададзены Node-guard для абодвух шляхоў і Android E2E пасля межы idle-stop. Рэальны Android-эксперымент пакуль **NOT-VERIFIED**.
- **Medium — release manifest check раней прапускаўся.** У існы абавязковы job `lint` workflow `required-checks.yml` дадзены Android prebuild, `:app:processReleaseMainManifest`, строгі `test -s` і запуск `android-merged-media-fgs.test.mjs` з відавочным `KUDY_RELEASE_MANIFEST`. Тэст-ахоўнік правярае звязку і адхіляе выдаленне любога кроку. Вынік GitHub CI для новага SHA пакуль **NOT-VERIFIED**.

Лакальныя Node-тэсты не замяняюць натыўнае пацвярджэнне і не пацвярджаюць release runtime. Поўная Android-зборка і эмулятар на гэтай машыне не запускаліся.
