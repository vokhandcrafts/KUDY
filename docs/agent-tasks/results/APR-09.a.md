# APR-09.a — Прамежкавы вынік

Дата: 2026-11-01. Задача: [#833](https://github.com/vokhandcrafts/KUDY/issues/833). Галінка: `chatgpt/833`. Аснова: `main` на `bc7587c0f185c7e85bfb0c0c59f801775469dbdd`.

## Што зроблена

- Прачытаныя ADR [APR-09](../../architecture/decisions/APR-09-android-backup.md), актуальныя `services/db/schema.ts`, `services/db/db.ts`, `services/db/types.ts`, `services/device.ts`, `services/device-secure-store.ts`, `controllers/deviceRoot.ts`, `controllers/deviceServices.ts`, `controllers/sessionPorts.ts`, `services/analytics.ts`, `services/crash.ts`, `services/feedbackSync.ts`, `app.json` і правілы для агентаў.
- Складзены [праект дызайну](../../architecture/decisions/APR-09.a-portable-progress-design.md) з дазволенымі табліцамі і калонак, небяспечнымі чэргамі, канфліктамі імпарту, асобным інертным станам незавершанай прагулкі, абодвума фарматамі Android XML і матрыцай праверак.
- Запісаныя два адкрытыя тэхнічныя бар'еры: (а) бяспечнае аднаўленне `active`/`paused` без аўтастарту; (б) адрозненне старога OS restore ад абнаўлення той самай устаноўкі, каб не знішчыць чэргі і ідэнтычнасць існага карыстальніка.

## Крытэрыі #833

| № | Стан на 2026-11-01 | Што засталося |
| --- | --- | --- |
| 1 | PARTIAL | Праект дызайну запісаны, але яшчэ не прыняты і не правераны на Android |
| 2–3 | OPEN | Сапраўдны экспарт/імпарт, захаванне прагрэсу і праверка забароненых даных |
| 4 | OPEN | Expo config plugin і праверка поўных XML |
| 5 | OPEN | Паводзінскія тэсты і адмоўныя сцэнарыі |
| 6 | OPEN | Свежы merged release manifest і рэверсійныя праверкі |
| 7 | NOT-RUN | Ізаляваныя Android cloud/D2D, legacy/12+, pre-policy restore |
| 8 | OPEN | Абнаўленне ADR/GP-14 пасля доказаў і праверкі праекта |

## Фактычныя праверкі

- GitHub вярнуў commit `58b1d61679a8eba7f414a645feb859571f34b416` для дызайну; файл прачытаны назад з галіны. Гэта праверка публікацыі файла, **не** тэст праграмы.
- KUDY Local MCP у сесіі мае толькі чытанне/запіс файлаў, без shell, Node, adb і эмулятара. `npm run typecheck`, `npm test`, `npm run arch:check`, jscpd, Showboat і прыладавыя сцэнарыі **не запускаліся**.
- Новых runtime-модуляў, міграцый, XML, залежнасцей, сакрэтаў і змен `.github/` няма. GP-14 застаецца адкрытым.
- Самаправерка: гэты дыф — толькі дызайн, таму не можа прайсці крытэрыі 2–8 і не прыдатны да merge як завершанае #833. Незалежны judge не праводзіўся.
