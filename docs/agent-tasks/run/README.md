# Заданні рухавіка прагулкі G05.01

Чатыры часткі радка G05.01 з [16](../../16_delivery_backlog.md) (разбіўка 2026-09-23). Крыніцы: [09 §6.1, §12](../../architecture/09_technical_architecture.md), прынятыя ADR [G01.01](../../architecture/decisions/G01.01-narration-progress.md), [G01.02](../../architecture/decisions/G01.02-audio-ownership.md), [G01.03](../../architecture/decisions/G01.03-session-access.md), [11 §12](../../11_run_interaction.md), [мадэль run-model](../../run-model/README.md). Усе — выкананыя і закрытыя, усе — моцнай мадэлі.

Усе часткі пішуць у адзін модуль `core/engine/`, таму ідуць строга паслядоўна. Імёны падзей і камандаў бяруцца з `09` §6.1: табліца ў `19` §3.1 састарэла (у ёй няма варыянтаў Moment).

| Заданне | Вынік | Пасля | Issue | Статус |
|---|---|---|---|---|
| [G05.01.a](G05.01.a.md) | Тыпы, жыццё сесіі, прыняцце `AccessReady`, вылічаны статус кропкі | ADR G01.01–G01.03, G02.01 (#54) | [#197](https://github.com/vokhandcrafts/KUDY/issues/197) | выканана → закрыта #197 (вынікі: [G05.01.a](../results/G05.01.a.md)) |
| [G05.01.b](G05.01.b.md) | Аўтазапуск, чарга, прагрэс паводле P01 | G05.01.a | [#198](https://github.com/vokhandcrafts/KUDY/issues/198) | выканана → закрыта #198 (вынікі: [G05.01.b](../results/G05.01.b.md)) |
| [G05.01.c](G05.01.c.md) | Уладальнік гуку паводле P02 | G05.01.b | [#199](https://github.com/vokhandcrafts/KUDY/issues/199) | выканана → закрыта #199 (вынікі: [G05.01.c](../results/G05.01.c.md)) |
| [G05.01.d](G05.01.d.md) | Супадзенне з мадэллю і property-тэсты інварыянтаў | G05.01.c | [#201](https://github.com/vokhandcrafts/KUDY/issues/201) | выканана → закрыта #201 (вынікі: [G05.01.d](../results/G05.01.d.md)) |

Падзеі аналітыкі (`EmitEvent`) рухавік пакуль не выдае: табліца падзей — задача G01.05. Радок G05.01 закрываецца пасля complete усіх чатырох частак.

## Геалакацыя, плэер, сесія і сімулятар G05.02–G05.06

Пятая хваля (разбіўка 2026-09-23). Крыніцы: [09 §6.2–§6.4, §9, §11](../../architecture/09_technical_architecture.md), [ADR G01.02](../../architecture/decisions/G01.02-audio-ownership.md), [ADR G01.03](../../architecture/decisions/G01.03-session-access.md), [19 §2–§6](../../architecture/19_class_and_module_map.md), [11 §4–§7](../../11_run_interaction.md). Усе — выкананыя і закрытыя, усе — моцнай мадэлі.

Сэрвісы пішуцца над уведзенымі партамі і правяраюцца ў Node, як G04. Прыладныя адаптары Android (G05.02.c, G05.03.b) — асобныя часткі.

**Без прылады (рашэнне заснавальніка 2026-09-23).** Прыладных праверак гэтая хваля не выконвае: клеткі [матрыцы G00.01.b](../../../spikes/G00.01-location-audio/evidence/G00.01.b-device-matrix.md) застаюцца `not-run`, а радкі G05.02 і G05.03 не закрываюцца, пакуль яны не пройдзены. Прыладны доказ G00.01.c (у `19` §1.2 ён блакуе G05.02/G05.03) свядома адкладзены: код і тэсты на камп'ютары ідуць раней за яго.

| Заданне | Вынік | Пасля | Issue | Статус |
|---|---|---|---|---|
| [G05.02.a](G05.02.a.md) | Чысты pipeline: пяць стадый, dwell, дэтэрмінаваныя кандыдаты | G05.01.a (#197) | [#210](https://github.com/vokhandcrafts/KUDY/issues/210) | выканана → закрыта #210 (вынікі: [G05.02.a](../results/G05.02.a.md)) |
| [G05.02.b](G05.02.b.md) | Сэрвіс геалакацыі: адна падпіска, акно ≤ 20 рэгіёнаў, watchdog | G05.02.a | [#211](https://github.com/vokhandcrafts/KUDY/issues/211) | выканана → закрыта #211 (вынікі: [G05.02.b](../results/G05.02.b.md)) |
| [G05.02.c](G05.02.c.md) | Адаптар Android: expo-location, фон, foreground service | G05.02.b, G06.09.b | [#212](https://github.com/vokhandcrafts/KUDY/issues/212) | выканана → закрыта #212 (вынікі: [G05.02.c](../results/G05.02.c.md)) |
| [G05.03.a](G05.03.a.md) | Сэрвіс аўдыё: адзін плэер, тэгаваныя callback'і, фокус | G05.01.c (#199) | [#213](https://github.com/vokhandcrafts/KUDY/issues/213) | выканана → закрыта #213 (вынікі: [G05.03.a](../results/G05.03.a.md)) |
| [G05.03.b](G05.03.b.md) | Адаптар Android: expo-audio, фон, lock-screen | G05.03.a, G06.09.b | [#214](https://github.com/vokhandcrafts/KUDY/issues/214) | выканана → закрыта #214 (вынікі: [G05.03.b](../results/G05.03.b.md)) |
| [G05.04](G05.04.md) | Чарга і блакіроўка аўтаматыкі праз рэальныя межы сэрвісаў | G05.01.d (#201), G05.02.b, G05.03.a, G06.09.b | [#215](https://github.com/vokhandcrafts/KUDY/issues/215) | выканана → закрыта #215 (вынікі: [G05.04](../results/G05.04.md)) |
| [G05.05.a](G05.05.a.md) | `useRunController`: durable Start, checkpoint, `play_seq` | G05.04, G04.02.c (#191) | [#216](https://github.com/vokhandcrafts/KUDY/issues/216) | выканана → закрыта #216 (вынікі: [G05.05.a](../results/G05.05.a.md)) |
| [G05.05.b](G05.05.b.md) | Паўза, Resume, End і аднаўленне пасля перазапуску | G05.05.a | [#217](https://github.com/vokhandcrafts/KUDY/issues/217) | выканана → закрыта #217 (вынікі: [G05.05.b](../results/G05.05.b.md)) |
| [G05.06.a](G05.06.a.md) | Дэтэрмінаваны сімулятар на production-функцыях | G05.05.b | [#218](https://github.com/vokhandcrafts/KUDY/issues/218) | выканана → закрыта #218 (вынікі: [G05.06.a](../results/G05.06.a.md)) |
| [G05.06.b](G05.06.b.md) | Генераваныя трэкі, сцэнарныя фікстуры і праверка ў CI | G05.06.a | [#219](https://github.com/vokhandcrafts/KUDY/issues/219) | выканана → закрыта #219 (вынікі: [G05.06.b](../results/G05.06.b.md)) |

G05.02 і G05.03 ідуць паралельна: яны пішуць у розныя модулі. G05.04 і далей — паслядоўна, бо ўсе пішуць у `controllers/run/`.

## Публікацыя ў GitHub — выкананая 2026-09-23

Адсочвальныя задачы радкоў: G05.02 — [#203](https://github.com/vokhandcrafts/KUDY/issues/203), G05.03 — [#204](https://github.com/vokhandcrafts/KUDY/issues/204), G05.05 — [#205](https://github.com/vokhandcrafts/KUDY/issues/205), G05.06 — [#206](https://github.com/vokhandcrafts/KUDY/issues/206); G05.04 — адна задача без частак. G05.01 — [#196](https://github.com/vokhandcrafts/KUDY/issues/196); кожная частка мае ўласную задачу (спасылкі ў табліцы) з `Epic:` і `Blocked-by:`. Пазнакі `agent:ready`/`epic`/`prio:*` не ставіліся — іх ставіць толькі аператар. Перад публікацыяй GitHub правераны на дублікаты; усе задачы перачытаныя назад праз API 2026-09-23 — адкрытыя, без пазнак, спасылкі вырашаныя. Бачнасць на дошцы dispatcher з сесіі не правяраецца (асобнай дошкі-праекту ў рэпазітара няма).

## Як запускаць

> Выканай толькі `docs/agent-tasks/run/G05.01.a.md`. Прачытай яго ўваходы, правер залежнасці, вынік і доказы захавай паводле файла.

Вынікі — у `docs/agent-tasks/results/<ID>.md`.
