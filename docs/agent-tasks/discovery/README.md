# Новая хваля: падборкі, водгукі і ўкраінская

Дзесяць самадастатковых заданняў да [спецыфікацыі 20](../../20_discovery_and_feedback.md), [тэхнічнага кантракту 21](../../architecture/21_discovery_feedback_architecture.md) і [плана](../../plans/2026-09-13-discovery-feedback.md). Усе — не пачатыя. Існуючыя [22 атамарныя заданні](../atomic/README.md) і іх вынікі захоўваюцца.

| Заданне | Вынік | Пасля | Issue |
|---|---|---|---|
| [G01.06](G01.06.md) | Кантракты падбору і водгукаў з прыкладамі | — | [#38](https://github.com/vokhandcrafts/KUDY/issues/38) |
| [G15.01](G15.01.md) | Чысты аўтарскі падбор | G01.06, G02.01, G00.04 | [#68](https://github.com/vokhandcrafts/KUDY/issues/68) |
| [G15.02](G15.02.md) | Уласныя месцы і падборкі | G02.05, G03.02 | [#69](https://github.com/vokhandcrafts/KUDY/issues/69) |
| [G15.03](G15.03.md) | Экран падбору, кэш і пераходы | G15.01, G15.02, G04.03, G06.01, G06.08 | [#70](https://github.com/vokhandcrafts/KUDY/issues/70) |
| [G15.04](G15.04.md) | Скразная прыёмка падбору | G15.03, G02.04, G09.02 | [#71](https://github.com/vokhandcrafts/KUDY/issues/71) |
| [G16.01](G16.01.md) | Прыватнае сховішча і API ацэнак | G01.06, G02.03, G08.01, G09.03 | [#72](https://github.com/vokhandcrafts/KUDY/issues/72) |
| [G16.02](G16.02.md) | Чарга і сховішча ўласных ацэнак | G16.01, G04.01 | [#73](https://github.com/vokhandcrafts/KUDY/issues/73) |
| [G16.03](G16.03.md) | Добраахвотная форма ацэнкі | G16.02, G06.04, G06.08 | [#74](https://github.com/vokhandcrafts/KUDY/issues/74) |
| [G16.04](G16.04.md) | Справаздача, захаванне і прыёмка водгукаў | G16.03, G09.04 | [#75](https://github.com/vokhandcrafts/KUDY/issues/75) |
| [G14.04.a](G14.04.a.md) | Пакет украінскай лакалізацыі | — | [#76](https://github.com/vokhandcrafts/KUDY/issues/76) |

Першая гатовая да запуску кантрактная праца — G01.06. G14.04.a можна рыхтаваць незалежна як план мовы; бацькоўскі G14.04 ад гэтага не завершаны. Production-задачы патрабуюць фактычна закрытых папярэднікаў, у тым ліку старых G00/G01.

Агульныя файлы кантрактаў, архітэктуры і бэклога змяняюцца паслядоўна. Няма аўтаматычнага запуску агентаў або наступнай задачы. Для перадачы: «Выканай толькі docs/agent-tasks/discovery/G01.06.md; правер залежнасці і запішы доказы ў result».

## Публікацыя ў GitHub — выкананая

Эпікі [G15 — #36](https://github.com/vokhandcrafts/KUDY/issues/36) і [G16 — #37](https://github.com/vokhandcrafts/KUDY/issues/37); задача [G01.06 — #38](https://github.com/vokhandcrafts/KUDY/issues/38). 2026-09-15 апублікаваныя ўсе астатнія заданні (гл. калонку «Issue» вышэй) і tracking issues папярэднікаў без атамарных файлаў: [G02.01 — #54](https://github.com/vokhandcrafts/KUDY/issues/54), [G02.03 — #55](https://github.com/vokhandcrafts/KUDY/issues/55), [G02.04 — #56](https://github.com/vokhandcrafts/KUDY/issues/56), [G02.05 — #57](https://github.com/vokhandcrafts/KUDY/issues/57), [G03.02 — #58](https://github.com/vokhandcrafts/KUDY/issues/58), [G04.01 — #59](https://github.com/vokhandcrafts/KUDY/issues/59), [G04.03 — #60](https://github.com/vokhandcrafts/KUDY/issues/60), [G06.01 — #62](https://github.com/vokhandcrafts/KUDY/issues/62), [G06.04 — #63](https://github.com/vokhandcrafts/KUDY/issues/63), [G06.08 — #61](https://github.com/vokhandcrafts/KUDY/issues/61), [G08.01 — #64](https://github.com/vokhandcrafts/KUDY/issues/64), [G09.02 — #65](https://github.com/vokhandcrafts/KUDY/issues/65), [G09.03 — #66](https://github.com/vokhandcrafts/KUDY/issues/66), [G09.04 — #67](https://github.com/vokhandcrafts/KUDY/issues/67). Tracking issues не маюць файлаў заданняў; іх разбіўка і пазнака `agent:ready` — за аператарам.

Пазнакі `agent:ready` і `prio:*` не дадаваліся: іх ставіць толькі аператар. Перад публікацыяй GitHub правераны на дублікаты; усе новыя issue прачытаныя назад праз API — адкрытыя, без лейблаў, з вырашанымі нумарамі Blocked-by. Спецыфікацыі, план і файлы заданняў даступныя ў default branch. Бачнасць на бордзе dispatcher з сесіі не правераная (асобнай дошкі-праекту ў рэпазітара няма): праверана толькі бачнасць issue праз GitHub API.
