# APR-07 — рашэнне пра выдаленне даных прылады

Дата: 2026-10-20. Задача: [#805](https://github.com/vokhandcrafts/KUDY/issues/805).
Правераная база: `02d5180`. Галінка: `805-apr-07-device-data-deletion-decision`.
Вынік: [запіс рашэння](../../architecture/decisions/APR-07-device-data-deletion.md), апублікаваныя наступныя задачы; runtime не змяняўся. Закрыццё #805 — пасля merge PR, GP-12 застаецца адкрытым.

## Крытэрыі задачы

| Крытэрый #805 | Фактычны вынік |
| --- | --- |
| 1. UI, кантракт #288, backend, сакрэт, чэргі, feedback і палітыка | ADR: «Фактычны стан», «Даныя і мяжа выдалення», «Усе мовы палітыкі». Прачытаныя `my.tsx`, `deviceRoot.ts`, `deviceServices.ts`, `device.ts`, `device-secure-store.ts`, `db.ts`, `crash.ts`, `feedbackSync.ts`, handler/міграцыі і моўныя праекцыі; існы сэрвіс не падключаны да кнопкі |
| 2. Выбраны шлях, offline і частковая памылка | Дзеянне ў My KUDY праз існы сэрвіс; спачатку бяспечная ачыстка і аднаўленне, затым UI разам з тэкстамі. ADR адрознівае лакальную ачыстку, сервернае пацверджанне і недаказанае выдаленне даных правайдараў; захоўвае гісторыю/загрузкі/пакупкі |
| 3. Умоўнае выдаленне акаўнта | Зверанае азначэнне Google Play і сапраўдныя registration/store-шляхі. UUID устаноўкі і назва `deleteDeviceAccount` не з'яўляюцца доказам карыстальніцкага акаўнта; яго стварэння ў правераным дадатку няма. Пытанні Data safety застаюцца ў #811; ніякага сцвярджэння прыняцця Google Play |
| 4. Fix-issues з залежнасцямі і доказамі | [#835](https://github.com/vokhandcrafts/KUDY/issues/835): cleanup/recovery, згоды, auth/cascades, канкурэнтныя адпраўкі і fail-on-revert тэсты. [#836](https://github.com/vokhandcrafts/KUDY/issues/836): production-падключэнне кнопкі, усе мовы палітыкі, synthetic Android release-доказ. Існая [#811](https://github.com/vokhandcrafts/KUDY/issues/811) захоўвае Data safety; дубль не створаны |

## Публікацыя задач

Issues #835 і #836 створаныя і прачытаныя назад праз `gh issue view --json number,title,labels,state,body`: абедзве адкрытыя, `labels: []`. Іх тэксты супадаюць з [лакальнымі заданнем a](../android-play-readiness/APR-07.a.md) і [заданнем b](../android-play-readiness/APR-07.b.md); спасылкі запісаныя ў [індэксе](../android-play-readiness/README.md).

#835 мае `Blocked-by: #805`; #836 — `Blocked-by: #805, #835, #663, #664`. Абедзве спасылаюцца на існы эпік #299 і папярэджваюць, што ADR яшчэ не даступны ў чыстым `main` да merge гэтага PR. Ніякіх `agent:ready`, запуску workers або змен канфігурацыі дыспетчара.

Праверка дошкі: `gh project list --owner vokhandcrafts --format json` адказала `error: your authentication token is missing required scopes [read:project]`. Таму публікацыя ў GitHub Issues пацверджана, бачнасць у backlog дошкі — **не праверана**; ручны крок запісаны ў `docs/human-actions.md`.

## Праверкі 2026-10-20

| Каманда | Вынік |
| --- | --- |
| `node --test --experimental-strip-types --experimental-test-module-mocks --test-reporter=spec services/device.test.ts supabase/functions/_shared/device-wire.test.ts supabase/tests/feedback/feedback-contract.test.ts` | 36 passed, 0 failed, 0 skipped; 2449.7631 ms |
| `npm run typecheck` | exit 0; усе TypeScript-праекты |
| `npm test` | Node: 2635 tests, 2563 passed, 72 skipped, 0 failed; 138405.0471 ms. Jest: 31 suites, 273 passed, 0 failed; 34.92 s. Гэта існае пакрыццё, а не доказ выпраўлення знойдзеных прамежкаў |
| `npm run arch:check` | exit 0; 632 modules, 0 violations |
| `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .` | exit 0; Found 0 clones |
| `python C:\Users\kamyl\.codex\skills\no-slop\scripts\scan_dev.py <task-file>` для APR-07.a і APR-07.b | 0 hard, 0 soft у кожным тэксце |

Усе моўныя радкі `privacyDeletion` прачытаныя праз імпарт сапраўдных `web/lib/i18n/{be,en,uk,de,es,fr,cs,sv,zh}.ts`, уключаючы дэкадаваны кітайскі радок. Ніводны з гэтых тэкстаў не зменены гэтай задачай; супярэчнасць застаецца да #836.

Афіцыйныя крыніцы Google Play прачытаныя 2026-10-20: [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en), [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en). Высновы па прымянімасці ў ADR прывязаныя да бягучага кода; формы ў Console не адкрытыя і не пададзеныя.

## Межы доказу і самаправерка аўтара

Дыф утрымлівае толькі дакументацыю. Ён не мяняе API, захаванне, аўтарызацыю або паводзіны дадатку; Showboat паводле decision rule не патрабуецца. Новая праверка, якая падае пры revert runtime-fix, належыць #835/#836, бо runtime-fix тут адсутнічае. Android і сапраўдны production backend у гэтай задачы не запускаліся; серверныя вынікі вышэй — сінтэтычныя portable-тэсты.

Самаправерка аўтара: усе крытэрыі #805 супастаўленыя з ADR і GitHub Issues; `crash_consent`, адсутны UI і недаказанае recovery не названыя выпраўленымі. Сакрэты не чыталіся; новыя службы, залежнасці і правайдарскія запыты не дададзеныя. Гэта не незалежны вердыкт суддзі.

Незалежны рэвьюер дакументацыі знайшоў два ўдакладненні: шырокі прыём `403` у існым кліенце і абавязак выдаліць/перастварыць захаваныя feedback-экспарты з `21`, §6. ADR выпраўлены; абавязак экспарта дададзены ў крытэрый #835. Неабавязковы серверны `webhook_events` таксама інвентарызаваны: мінімізаваны payload без ідэнтыфікатараў прылады, асобнае захаванне замест device-cascade.

Паўторная незалежная праверка: 0 critical, 0 high, 0 medium, 0 low; заўвагі закрытыя. `npm run ledger:check`, `node --test tools/docs-ledger/counts-guard.test.mjs` і `git diff --cached --check` прайшлі; усе адносныя спасылкі ў ADR, індэксе, выніку і матрыцы вядуць на існыя файлы. Скан змешанай кірыліцы/лацінкі ў гэтых тэкстах не знайшоў парушэнняў.
