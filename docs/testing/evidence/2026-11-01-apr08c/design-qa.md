# Design-QA — APR-08.c

- Verdict: **INSUFFICIENT_EVIDENCE**
- Counts: RULE 0 · DIFF 0 · OPINION 0 · NOT-VERIFIED 3
- Scope: [PR #948](https://github.com/vokhandcrafts/KUDY/pull/948); base `ac86a3a5f92c5c5526f226d86fd96ac9291ab9b3`, правераны head `6c0a49b1641329d49ecaed19dee5129811dc7664`; новыя паверхні — сістэмнае Android media notification і lock-screen controls. In-app Run не мяняўся.
- Sources: канон, рашэнні і выключэнні на base `ac86a3a5f92c5c5526f226d86fd96ac9291ab9b3`: `docs/design/visual-language.md` §5 «Панэль Run», `docs/design/screens-and-transitions.md` «Run», `docs/design/brand/decisions.md` B03.1, `docs/design-qa/exceptions.md`.
- Environment: GitHub runner, Android 36 emulator, debug APK `by.kudy.app`, SHA-256 `5b3fff8eb97716e9a908c5d815ce4f939f2e2807f3469291ce6016865730181b`; сінтэтычная беларускамоўная прагулка. Тэма і маштаб шрыфту ў runner не зафіксаваны; Android release APK не атрыманы. [Відэа](android-debug-lockscreen.mp4) і [кадр](android-debug-lockscreen.png) паказваюць сістэмную медыякартку KUDY на PIN-заблакаваным экране.

| surface/state | approved baseline | current PNG | difference PNG | region/threshold | owner verdict |
| --- | --- | --- | --- | --- | --- |

[NOT-VERIFIED] Сістэмнае media notification у адкрытай шторцы падчас Play/Pause/Stop; журнал runner пацвярджае foreground-апавяшчэнне ў Pause і яго адсутнасць пасля Stop, але адпаведны screenshot з паспяховага прагону не быў загружаны. Патрэбны release Android capture з вядомымі APK SHA, API, тэмай, маштабам і мовай.

[NOT-VERIFIED] Lock-screen controls бачныя на debug-здымку пасля Pause, але няма іерархіі даступнасці або праверкі памеру/семантыкі элементаў. Патрэбны UI dump для гэтага стану.

[NOT-VERIFIED] Release Android; debug-відэа, [паспяховы incoming-call trace](android-debug-call-trace.txt) і unit-тэсты не пацвярджаюць release runtime. Патрэбны release APK/AAB з SHA і яго натыўны capture.

## Другі праход: адхіленыя кандыдаты

Няма прапанаваных RULE. Колеры і шрыфты Android notification вызначае сістэмны SDK, а канон §5 апісвае in-app Run; здымак сістэмнай медыякарткі не дае падставы прыпісваць ёй парушэнне production-токенаў. Адпаведных approved baseline для notification і lock-screen няма, таму DIFF не ствараецца.
