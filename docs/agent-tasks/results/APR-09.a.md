# APR-09.a — Прамежкавы вынік

Дата: 2026-11-01. Задача: [#833](https://github.com/vokhandcrafts/KUDY/issues/833). Галінка: `chatgpt/833`. Аснова: `main` на `bc7587c0f185c7e85bfb0c0c59f801775469dbdd`.

## Што зроблена

- Прачытаныя ADR [APR-09](../../architecture/decisions/APR-09-android-backup.md), актуальныя `services/db/schema.ts`, `services/db/db.ts`, `services/db/types.ts`, `services/device.ts`, `services/device-secure-store.ts`, `controllers/deviceRoot.ts`, `controllers/deviceServices.ts`, `controllers/sessionPorts.ts`, `services/analytics.ts`, `services/crash.ts`, `services/feedbackSync.ts`, `app.json` і правілы для агентаў.
- Складзены [праект дызайну](../../architecture/decisions/APR-09.a-portable-progress-design.md) з дазволенымі табліцамі і калонкамі, небяспечнымі чэргамі, канфліктамі імпарту, асобнай табліцай для неактыўнай незавершанай прагулкі, абодвума фарматамі Android XML і матрыцай праверак.
- Удакладнена, што незавершаныя сесіі і іх даччыныя запісы захоўваюцца ў асобных табліцах без змены `session.state`; адкладзены або адхілены backup абавязкова захоўваецца ў каранціне. Стары OS restore супраць звычайнага абнаўлення застаецца адкрытым release-gate.

## Крытэрыі #833

| № | Стан на 2026-11-01 | Што засталося |
| --- | --- | --- |
| 1 | PARTIAL | Праект дызайну дапоўнены пасля Voka review, але яшчэ не прыняты і не правераны на Android |
| 2–3 | OPEN | Сапраўдны экспарт/імпарт, захаванне прагрэсу і праверка забароненых даных |
| 4 | OPEN | Expo config plugin і праверка поўных XML |
| 5 | OPEN | Паводзінскія тэсты і адмоўныя сцэнарыі |
| 6 | OPEN | Свежы merged release manifest і рэверсійныя праверкі |
| 7 | NOT-RUN | Ізаляваныя Android cloud/D2D, legacy/12+, pre-policy restore |
| 8 | OPEN | Абнаўленне ADR/GP-14 пасля доказаў і праверкі праекта |

## Заўвагі Voka да PR #956 (2026-11-01)

| Ключ | Што выпраўлена | Абмежаванне |
| --- | --- | --- |
| `missing-label-removal-note` (HIGH) | У `docs/human-actions.md` дададзена яўнае зняцце `agent:running` пасля мержу, з улікам `agent:blocked` | Праверка guard застаецца за CI |
| `acceptance-criteria-unmet` (MEDIUM) | PR застаецца Draft; `Closes #833` да завяршэння крытэрыяў заменена на спасылку без аўтаматычнага закрыцця | AC2–8 не выкананыя, PR не мержыць |
| `undefined-import-merge-policy` (MEDIUM) | У §4.2 дакументаваныя `guide_hint_last`, поўны ключ `migration_log`, лакальны прыярытэт `ui_locale` і адкат пры канфлікце | Рэальны код і тэсты не напісаныя |
| `undefined-export-import-trigger` (MEDIUM) | У §4.1 прадугледжаныя экспарт пасля commit, серыялізацыя, `noBackupFilesDir` маркер паходжання і асобны кандыдат на імпарт | Old-policy restore і crash windows не правераныя |
| `inert-state-schema-scope` (LOW) | У §4.3 асобная табліца `restore_pending_session`; `session.state` не змяняецца | Патрэбная дабаўная міграцыя і прыладавая праверка |
| `mixed-script-text` (LOW) | Выпраўленыя першапачатковыя памылкі напісання ў дызайне | Праверка тэксту ў ізаляванай змене, не поўны lint праекта |

## Паўторнае рэв'ю Voka / Judge (2026-11-01)

- [Voka, паўторнае рэв'ю](https://github.com/vokhandcrafts/KUDY/pull/956#issuecomment-6560689043) на `aea1afd`: ранейшыя HIGH/MEDIUM закрытыя, але 3 новыя LOW абгрунтавана адзначаныя.
- [Judge](https://github.com/vokhandcrafts/KUDY/pull/956#issuecomment-6560803923) на `aea1afd`: `NOT APPROVED`; асноўныя блокеры — адсутнасць сапраўднага экспарту/імпарту, XML plugin, прыладавых доказаў і Showboat. Гэта не недахоп фармулёўкі справаздачы, а невыпраўленая адсутнасць кода.
- `refused-candidate-overwrite`: §4.1 патрабуе захоўваць чужую копію ў `noBackupFilesDir/restore-quarantine/` **да** першага лакальнага экспарту, пры збоях і адкладзеным імпарце. Удакладнены crash/restart і забарона перазапісу.
- `corrupt-locale-precedence`: §4.2 аддае прыярытэт лакальнаму `ui_locale` толькі пры ўваходжанні ў `COMPLETE_UI_LOCALES`; сапсаваны код не перамагае праверанае адноўленае значэнне.
- `pending-session-child-rows`: §4.2–4.3 захоўваюць звязаныя `guide_hint_state` і `migration_log` у асобных табліцах да яўнага аднаўлення `restore_pending_session`, потым пераносяць іх разам у адной транзакцыі.
- `backup-agent-comparison`: §2 параўноўвае Auto Backup XML з native `BackupAgent.onFullBackup` і key/value `BackupAgent`, з коштам натыўнага кода і розніцай паміж затрымкай запісу файла ды раскладам OS backup. Механізм яшчэ не зацверджаны для выпуску.
- `owner-tradeoffs`: §6 выразна фіксуе незгадненую магчымую страту апошняга прамежку прагрэсу і legacy D2D без шыфравання як пытанні да ўладальніка. Не называць іх прынятымі рашэннямі.

**Фактычны статус:** усе пералічаныя змены — толькі дакументацыя. Runtime і прыладавыя пункты Judge застаюцца адкрытымі; гэтыя выпраўленні самі па сабе не робяць `#833` выкананай. Праверкі поўнага `npm test`, typecheck, arch:check, Android restore і Showboat у Chat не запускаліся; стан CI на новым SHA трэба правяраць асобна.

## Знешні статус

Правілы CI-тэсту `human-actions-status-guard.test.mjs` прачытаныя; адпаведны новы запіс правераны па тых жа ўмовах у сесіі, але каманда `node --test` **не запускалася**. Android-тэсты, `npm test`, typecheck, arch:check, jscpd і Showboat па-ранейшаму не запускаліся ў гэтай сесіі. Стан issue пасля дакументальных выпраўленняў: `agent:blocked` да поўнай рэалізацыі і сапраўдных прыладавых доказаў. Ніякіх runtime-змен не было.

## Фактычныя праверкі

- GitHub вярнуў commit `58b1d61679a8eba7f414a645feb859571f34b416` для дызайну; файл прачытаны назад з галіны. Гэта праверка публікацыі файла, **не** тэст праграмы.
- KUDY Local MCP у сесіі мае толькі чытанне/запіс файлаў, без shell, Node, adb і эмулятара. `npm run typecheck`, `npm test`, `npm run arch:check`, jscpd, Showboat і прыладавыя сцэнарыі **не запускаліся**.
- Новых runtime-модуляў, міграцый, XML, залежнасцей, сакрэтаў і змен `.github/` няма. GP-14 застаецца адкрытым.
- Самаправерка: гэты дыф — толькі дызайн, таму не можа прайсці крытэрыі 2–8 і не прыдатны да merge як завершанае #833. Незалежны Judge правёў праверку пазней (гл. ніжэй); яго вердыкт — NOT APPROVED.
