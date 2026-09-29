# Заданні экранаў Горад → Гіды → прэв'ю G06.01

Дзве часткі радка G06.01 з [16](../../16_delivery_backlog.md) (разбіўка — 🕴🏻Планавальнік 2026-09-26, разблакаваная ўхваленым дызайнам G06.06–G06.08 і кляймам аператара на issue #62). Крыніцы: [11 раздзел 16](../../11_run_interaction.md), [21 §3–§4](../../architecture/21_discovery_feedback_architecture.md), [09 §4, §6.5](../../architecture/09_technical_architecture.md), ухваленыя каноны [screens-and-transitions](../../design/screens-and-transitions.md) і [visual-language](../../design/visual-language.md).

| Заданне | Вынік | Пасля | Issue | Статус |
|---|---|---|---|---|
| [G06.01.a](G06.01.a.md) | Горад і рубрыка «Гіды» на рэальным каталогу: каталожны сэрвіс, карткі без выдумак, станы і парадак | G06.09.a+b, канон G06.06–G06.08 | #313 | выканана → закрыта #313 (вынікі: [G06.01.a](../results/G06.01.a.md)) |
| [G06.01.b](G06.01.b.md) | Прэв'ю гіда: метаданыя і адзіная галоўная кнопка Download→Start | G06.01.a | #314 | у працы (#314, agent:running) |

# Заданні каркаса дадатку G06.09

Дзве часткі новага радка G06.09 з [16](../../16_delivery_backlog.md) (радок і разбіўка — 2026-09-23). Крыніцы: [09 §6](../../architecture/09_technical_architecture.md), [11 §16](../../11_run_interaction.md), [19 §2.2, §2.5–§2.6, §4.2](../../architecture/19_class_and_module_map.md), [ADR G00.04](../../architecture/decisions/G00.04-stack-baseline.md). Абедзве — выкананыя і закрытыя, абедзве — сярэдняй мадэлі.

Каркас дае дадатак, у які потым мантуюцца сэрвісы і экраны: маршруты-заглушкі, корань кампазіцыі і машынна правераныя межы слаёў. Візуальнага дызайну тут няма — ён за G06.06–G06.08.

| Заданне | Вынік | Пасля | Issue | Статус |
|---|---|---|---|---|
| [G06.09.a](G06.09.a.md) | Expo Router і ўсе маршруты `19` §2.5 як заглушкі; тэст з рэндэрам праходзіць навігацыю `11` §16 | G00.04 (#10), G01.04 (#109) | [#208](https://github.com/vokhandcrafts/KUDY/issues/208) | выканана → закрыта #208 (вынікі: [G06.09.a](../results/G06.09.a.md)) |
| [G06.09.b](G06.09.b.md) | Корань кампазіцыі, Zustand, правілы app → controllers → services/core | G06.09.a | [#209](https://github.com/vokhandcrafts/KUDY/issues/209) | выканана → закрыта #209 (вынікі: [G06.09.b](../results/G06.09.b.md)) |

**Без прылады (рашэнне заснавальніка 2026-09-23).** Доказ — на камп'ютары: тэсты, `tsc`, `expo-doctor`, `expo prebuild --platform android --no-install`. Development build на тэлефоне пазначаецца `not-run`.

## Заданні стылёвага пакета G06.10

Шэсць частак радка G06.10 (разбіўка — 🕴🏻Планавальнік 2026-09-29) з [16](../../16_delivery_backlog.md), блок «Дызайн перад рэалізацыяй экранаў». Крыніцы: [бацькоўскі кантэкст G06.10](G06.10.md) (спека, ухвалена квізам заснавальніка), [visual-language](../../design/visual-language.md), дэма `spikes/2026-09-29-style-showcase.html`.

| Частка | Заданне | Issue | Статус |
|---|---|---|---|
| G06.10 | Бацькоўскі кантэкст (спека) | [#400](https://github.com/vokhandcrafts/KUDY/issues/400) (эпік) | у бэклозе |
| [G06.10.a](G06.10.a.md) | Стылёвы пакет у каноне + гард | [#401](https://github.com/vokhandcrafts/KUDY/issues/401) | у бэклозе |
| [G06.10.b](G06.10.b.md) | Шрыфты Golos Text / Alegreya / Caveat | [#402](https://github.com/vokhandcrafts/KUDY/issues/402), Blocked-by #401 | у бэклозе |
| [G06.10.c](G06.10.c.md) | Іконкавы слой Lucide | [#403](https://github.com/vokhandcrafts/KUDY/issues/403), Blocked-by #401 | у бэклозе |
| [G06.10.d](G06.10.d.md) | Вылепленыя кнопкі (полка + апусканне) | [#404](https://github.com/vokhandcrafts/KUDY/issues/404), Blocked-by #401 | у бэклозе |
| [G06.10.e](G06.10.e.md) | Зярно на паперы | [#405](https://github.com/vokhandcrafts/KUDY/issues/405), Blocked-by #401 | у бэклозе |
| [G06.10.f](G06.10.f.md) | Жывы прагрэс прагулкі | [#406](https://github.com/vokhandcrafts/KUDY/issues/406), Blocked-by #401 | у бэклозе |

b–f узаемна незалежныя пасля завяршэння a. Файлы радка трапляюць у runner-checkout пасля мержу [PR #399](https://github.com/vokhandcrafts/KUDY/pull/399) — да таго задачы не чаргуюцца. Пазнакі `agent:ready`/`epic`/`prio:*` ставіць толькі аператар.

## Публікацыя ў GitHub — выкананая 2026-09-23

Адсочвальная задача радка G06.09 — [#202](https://github.com/vokhandcrafts/KUDY/issues/202); кожная частка мае ўласную задачу з `Epic:` і `Blocked-by:`. Пазнакі `agent:ready`/`epic`/`prio:*` не ставіліся — іх ставіць толькі аператар. Перад публікацыяй GitHub правераны на дублікаты; задачы перачытаныя праз API — адкрытыя, без пазнак.

## Як запускаць

> Выканай толькі `docs/agent-tasks/app/G06.09.a.md`. Прачытай яго ўваходы, правер залежнасці, вынік і доказы захавай паводле файла.

Вынікі — у `docs/agent-tasks/results/<ID>.md`.
