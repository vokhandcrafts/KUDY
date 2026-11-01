# Design-QA — APR-08.c

- Verdict: **INSUFFICIENT_EVIDENCE**
- Counts: RULE 0 · DIFF 0 · OPINION 0 · NOT-VERIFIED 2
- Scope: PR пакуль не адкрыты; base `ac86a3a5f92c5c5526f226d86fd96ac9291ab9b3`, head `dcdda9690cce8fb054d9b1a3cc442495a4eba170`; новыя паверхні — сістэмнае Android media notification і lock-screen controls. In-app Run не мяняўся.
- Sources: канон, рашэнні і выключэнні на base `ac86a3a5f92c5c5526f226d86fd96ac9291ab9b3`: `docs/design/visual-language.md` §5 «Панэль Run», `docs/design/screens-and-transitions.md` «Run», `docs/design/brand/decisions.md` B03.1, `docs/design-qa/exceptions.md`.
- Environment: прылада/API, тэма, маштаб шрыфту, мова і Android screenshot — **NOT-VERIFIED**. Android release APK не атрыманы.

| surface/state | approved baseline | current PNG | difference PNG | region/threshold | owner verdict |
| --- | --- | --- | --- | --- | --- |

[NOT-VERIFIED] Сістэмнае media notification падчас Play/Pause/Stop; няма screenshot і native trace. Патрэбны release Android capture з вядомымі APK SHA, API, тэмай, маштабам і мовай.

[NOT-VERIFIED] Lock-screen controls пасля блокіроўкі і пры перапыненні; няма здымка заблакаванага экрана і іерархіі даступнасці. Патрэбны адпаведныя прыладавыя capture і сцэнар.

## Другі праход: адхіленыя кандыдаты

Няма прапанаваных RULE. Колеры і шрыфты Android notification вызначае сістэмны SDK, а канон §5 апісвае in-app Run; без экрана нельга прыпісваць сістэмнай паверхні парушэнне production-токенаў. Адпаведных approved baseline для notification і lock-screen няма, таму DIFF не ствараецца.
