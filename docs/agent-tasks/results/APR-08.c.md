# APR-08.c — Android mediaPlayback foreground service

Задача: [#854](https://github.com/vokhandcrafts/KUDY/issues/854). Працоўная галіна: `codex/854`. Статус: **часткова праверана; натыўная прыёмка яшчэ не завершана**.

## Рашэнне і межы доказу

Для аўдыяпрагулкі захаваны `mediaPlayback` FGS з архітэктуры §6.3. Адаптар пасля фізічнага `play()` выклікае падтрыманы Expo Audio 1.1.1 `setActiveForLockScreen(true, { title: 'KUDY' })`. Ён прыбірае lock-screen controls пры канцы або памылцы трэка, замене крыніцы, Stop і dispose. Паўза і працяг пакідаюць той самы media session. Памылка актывацыі ідзе ў існы `failed`-шлях і вызваляе плэер.

Гэта пацверджана frozen unit-тэстамі і зыходнікам SDK, але **пакуль не з'яўляецца доказам запуску сэрвісу на Android**. У Expo `AudioControlsService` запускаецца праз `startForegroundService`; рэальныя апавяшчэнне, кіраванне на заблакаваным экране, перапыненні і спыненне сэрвісу трэба праверыць натыўна. Асобна варта праверыць імгненны Stop пасля Play: сэрвіс ствараецца асінхронна.

## Праверкі па крытэрыях #854

1. **Натыўны lifecycle — НЕ ПРАВЕРАНА.** [Android CI run 41297955997](https://github.com/vokhandcrafts/KUDY/actions/runs/41297955997) сабраў debug APK `by.kudy.app` з SHA-256 `9819e426d9f019253fecfabd22657e54dc1d306764d47abe04fca5928f03488f`; smoke прайшоў 11/11. У walk-сцэнары фізічнае аўдыя запусцілася, але новы крок паўзы не паспеў знайсці UI-кнопку да канца 6-секунднага сінтэтычнага трэка. Атрыманае 25-секунднае відэа паказвае толькі гэты няўдалы прагон, не lock-screen controls. Патрэбны паспяховы trace на Android і release-білд; debug APK і manifest самі па сабе не закрываюць крытэрый. Лакальны AVD выключаны пасля перагрузкі хоста; далейшыя натыўныя праверкі ідуць на GitHub runner.
2. **Падключэнне SDK — выканана на ўзроўні кода.** Адаптар выкарыстоўвае афіцыйны метад Expo Audio 1.1.1 і lifecycle cleanup. Чатыры зафіксаваныя да рэалізацыі acceptance-тэсты былі чырвоныя на базе і прайшлі пасля змены; файл тэстаў не змяняўся пасля фіксацыі ў `424825f0`.
3. **Production release manifest — праверана.** `:app:processReleaseMainManifest` прайшоў у абмежаваным scope. [Зліты маніфест](../../testing/evidence/2026-11-01-apr08c/AndroidManifest-production.xml) мае SHA-256 `879cf3ef3cc611fc992df48ba9f5d41b08f5c5120e1cef335f2ad04d0f23588e`. У ім ёсць location і mediaPlayback FGS, адзін неэкспартаваны `AudioControlsService`; няма microphone FGS, `AudioRecordingService` і `RECORD_AUDIO`. `test/android-merged-media-fgs.test.mjs` прайшоў на фактычным злітым XML і праваліўся пры кантрольным выдаленні mediaPlayback permission.
4. **Перадача #299 — чарнавік.** Core use-case: карыстальнік запускае аўдыяпрагулку і чуе аповед пры заблакаваным экране. Трыгер: ручны Play або аўтаматычны старт гісторыі падчас запушчанай прагулкі. Затрымка або спыненне сэрвісу абрывае фонавае прайграванне і lock-screen кіраванне. Апавяшчэнне павінна паказваць media controls падчас актыўнай сесіі і знікаць пасля Stop/завяршэння. **Android-відэа і production AAB з SHA адсутнічаюць; Play Console submission у #299 пакуль заблакаваны гэтымі доказамі.**
5. **Праверкі.** 24 мэтавыя Node-тэсты і Jest `app/device-root-audio.test.tsx` прайшлі лакальна; `npm run typecheck`, `npm run arch:check` (666 модуляў, 0 парушэнняў), `jscpd` (0 clones) прайшлі. [Showboat proof](../../demos/2026-11-01-apr08c-media-playback.md) прайшоў `verify` (4/4 unit-тэсты). [Design-QA](../../testing/evidence/2026-11-01-apr08c/design-qa.md) мае INSUFFICIENT_EVIDENCE для сістэмных паверхняў. Лакальны поўны `npm test` быў спынены пры перагрузцы хоста і не залічваецца. Для head `cbcaa565` CI required-checks матрыца зялёная; Android smoke 11/11, walk 4/5, discovery не запускаўся праз збой новага кроку. Android suite яшчэ не прайшоў цалкам.

## Рэсурсны рэжым

Пасля перагрузкі ўсе ўласныя цяжкія працэсы і AVD былі спынены. Production manifest збіраўся з `MemoryMax=3G`, `MemorySwapMax=0`, `CPUQuota=100%`, адным Gradle worker; атрымаўся за 2 хвіліны 12 секунд. Поўны demo APK на тым самым хосце не атрыманы: `:app:packageRelease` адзначыў FAILED пасля ~24 хвілін пад 4 ГБ, а вузкі паўтор `packageRelease` спынены timeout-ам праз 3 хвіліны на `expo-constants:createExpoConfig`. У scope не было OOM або swap. Ніводзін з гэтых запускаў не пацвярджае runtime. Далейшыя Android build і E2E патрэбна запускаць на GitHub runner, не сумяшчаючы іх з лакальным эмулятарам.

## Невыкананае перад закрыццём

- Праверыць на Android release APK/AAB з вядомым SHA start, pause, resume, stop, screen lock, interruption, notification і фактычны FGS lifecycle; запісаць санітызаваны trace і Android-відэа.
- Атрымаць вынік Android suite і поўнага `npm test` на CI для таго ж head SHA.
- Паўтарыць design-QA пасля з'яўлення натыўных capture; Showboat ужо правераны.
