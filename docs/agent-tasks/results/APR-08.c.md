# APR-08.c — Android mediaPlayback foreground service

Задача: [#854](https://github.com/vokhandcrafts/KUDY/issues/854). Працоўная галіна: `codex/854`. Статус: **часткова праверана; натыўная прыёмка яшчэ не завершана**.

## Рашэнне і межы доказу

Для аўдыяпрагулкі захаваны `mediaPlayback` FGS з архітэктуры §6.3. Адаптар пасля фізічнага `play()` выклікае падтрыманы Expo Audio 1.1.1 `setActiveForLockScreen(true, { title: 'KUDY' })`. Ён прыбірае lock-screen controls пры канцы або памылцы трэка, замене крыніцы, Stop і dispose. Паўза і працяг пакідаюць той самы media session. Памылка актывацыі ідзе ў існы `failed`-шлях і вызваляе плэер.

Frozen unit-тэсты, зыходнік SDK і Android debug-прагон пацвердзілі актывацыю: mediaPlayback FGS і медыякартка KUDY былі бачныя на заблакаваным экране. Гэта яшчэ не release-доказ; перапыненне і канчатковы стан сэрвісу пасля Stop патрабуюць асобнай натыўнай праверкі. Асобна варта праверыць імгненны Stop пасля Play: сэрвіс ствараецца асінхронна.

## Праверкі па крытэрыях #854

1. **Натыўны lifecycle — ЧАСТКОВА ПРАВЕРАНА.** [Android CI run 41307042352](https://github.com/vokhandcrafts/KUDY/actions/runs/41307042352) прайшоў на Android 36 з debug APK `by.kudy.app`, SHA-256 `5b3fff8eb97716e9a908c5d815ce4f939f2e2807f3469291ce6016865730181b`. [Відэа](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.mp4) (SHA-256 `c0f2be119e793e08aad29c1a809e0b8ad7d8ef0f8caf90ca00332e40ae868e3c`) і [кадр](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.png) паказваюць медыякартку KUDY з кнопкай Play на сапраўдным PIN-заблакаваным экране пасля Pause. У журнале runner ёсць foreground-апавяшчэнне падчас Pause і яго адсутнасць пасля Stop; [папярэдні санітызаваны trace](../../testing/evidence/2026-11-01-apr08c/android-debug-paused-trace.txt) фіксуе `AudioControlsService isForeground=true`, type `0x2` і `PAUSED` media session на папярэднім debug APK. Скрыпт не вывёў у кароткі журнал `isForeground` пасля Stop; запіс сэрвісу яшчэ існуе, таму яго канчатковы foreground-стан не пацверджаны. Натыўнае перапыненне і release-білд таксама не правераны. Лакальны AVD выключаны пасля перагрузкі хоста.
2. **Падключэнне SDK — выканана на ўзроўні кода.** Адаптар выкарыстоўвае афіцыйны метад Expo Audio 1.1.1 і lifecycle cleanup. Чатыры зафіксаваныя да рэалізацыі acceptance-тэсты былі чырвоныя на базе і прайшлі пасля змены; файл тэстаў не змяняўся пасля фіксацыі ў `424825f0`.
3. **Production release manifest — праверана.** `:app:processReleaseMainManifest` прайшоў у абмежаваным scope. [Зліты маніфест](../../testing/evidence/2026-11-01-apr08c/AndroidManifest-production.xml) мае SHA-256 `879cf3ef3cc611fc992df48ba9f5d41b08f5c5120e1cef335f2ad04d0f23588e`. У ім ёсць location і mediaPlayback FGS, адзін неэкспартаваны `AudioControlsService`; няма microphone FGS, `AudioRecordingService` і `RECORD_AUDIO`. `test/android-merged-media-fgs.test.mjs` прайшоў на фактычным злітым XML і праваліўся пры кантрольным выдаленні mediaPlayback permission.
4. **Перадача #299 — частковая.** Core use-case: карыстальнік запускае аўдыяпрагулку і чуе аповед пры заблакаваным экране. Трыгер: ручны Play або аўтаматычны старт гісторыі падчас запушчанай прагулкі. Затрымка або спыненне сэрвісу абрывае фонавае прайграванне і lock-screen кіраванне. Медыякартка на [Android-відэа](../../testing/evidence/2026-11-01-apr08c/android-debug-lockscreen.mp4) застаецца на заблакаваным экране ў стане Pause з кнопкай Play; пасля Stop foreground-апавяшчэнне знікла з журнала. **Production AAB з SHA адсутнічае; гэтае відэа не дае дазволу на Play Console submission.**
5. **Праверкі.** 24 мэтавыя Node-тэсты і Jest `app/device-root-audio.test.tsx` прайшлі лакальна; `npm run typecheck`, `npm run arch:check` (666 модуляў, 0 парушэнняў), `jscpd` (0 clones) прайшлі. [Showboat proof](../../demos/2026-11-01-apr08c-media-playback.md) прайшоў `verify` (4/4 unit-тэсты). [Design-QA](../../testing/evidence/2026-11-01-apr08c/design-qa.md) фіксуе даступны debug-здымак і адсутныя release/accessibility доказы. Лакальны поўны `npm test` быў спынены пры перагрузцы хоста і не залічваецца. Для head `6c0a49b1` CI required-checks матрыца зялёная, уключаючы `tests (22)` і `tests (24)`; Android smoke 11/11, walk 5/5, discovery 4/4. Новы head пасля захавання відэа трэба праверыць нанова.

## Рэсурсны рэжым

Пасля перагрузкі ўсе ўласныя цяжкія працэсы і AVD былі спынены. Production manifest збіраўся з `MemoryMax=3G`, `MemorySwapMax=0`, `CPUQuota=100%`, адным Gradle worker; атрымаўся за 2 хвіліны 12 секунд. Поўны demo APK на тым самым хосце не атрыманы: `:app:packageRelease` адзначыў FAILED пасля ~24 хвілін пад 4 ГБ, а вузкі паўтор `packageRelease` спынены timeout-ам праз 3 хвіліны на `expo-constants:createExpoConfig`. У scope не было OOM або swap. Ніводзін з гэтых запускаў не пацвярджае runtime. Далейшыя Android build і E2E патрэбна запускаць на GitHub runner, не сумяшчаючы іх з лакальным эмулятарам.

## Невыкананае перад закрыццём

- Праверыць на Android release APK/AAB з вядомым SHA start, pause, resume, stop, screen lock, interruption, notification і фактычны FGS lifecycle; запісаць санітызаваны trace і Android-відэа.
- Атрымаць вынік Android suite і поўнага `npm test` на CI для таго ж head SHA.
- Паўтарыць design-QA пасля з'яўлення натыўных capture; Showboat ужо правераны.
