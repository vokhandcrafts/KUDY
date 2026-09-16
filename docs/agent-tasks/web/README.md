# Заданні вэб-каналу G10

Пяць заданняў да [плана вэб-аўдыёверсіі](../../plans/2026-09-16-web-audio-version.md) (2026-09-16). Крыніцы: [04, «Паралельны трэк — вэб-аўдыёверсія (прынята)»](../../04_scope_and_roadmap.md), [09 §2/§8/§13](../../architecture/09_technical_architecture.md), [16, эпік G10](../../16_delivery_backlog.md). Усе — не пачатыя. Існуючыя хвалі і іх вынікі захоўваюцца.

Сэнс трэку: тыя самыя старонкі, што у дадатку, толькі бясплатны пласт — усе спасылкі на платны кантэнт вядуць у дадатак. Вэб чытае тыя ж public-бандлы, што і дадатак; асобнай крыніцы кантэнту ў яго няма.

| Заданне | Вынік | Пасля | Issue |
|---|---|---|---|
| [G10.01.a](G10.01.a.md) | Каркас вэба, чытанне public-пласту, leak-гард | G02.03 (#55) | [#111](https://github.com/vokhandcrafts/KUDY/issues/111) |
| [G10.01.b](G10.01.b.md) | Каталёг, старонка гіда і карта горада (BE/EN), locked-прэв'ю, спакойная прапанова | G10.01.a, G01.04 | [#111](https://github.com/vokhandcrafts/KUDY/issues/111) |
| [G10.01.c](G10.01.c.md) | Старонкі кропак, ручны плэер, транскрыпты | G10.01.b | [#111](https://github.com/vokhandcrafts/KUDY/issues/111) |
| [G10.02.a](G10.02.a.md) | Пераход у дадатак: канфіг спасылак, /app, QR, OG-метаданыя | G10.01.c | [#112](https://github.com/vokhandcrafts/KUDY/issues/112) |
| [G10.02.b](G10.02.b.md) | SEO, публікацыя на Vercel, адкат | G10.02.a, G03.05 | [#112](https://github.com/vokhandcrafts/KUDY/issues/112) |

Бацькоўскія радкі `16`: G10.01 закрываецца пасля complete усіх трох сваіх частак, G10.02 — пасля дзвюх. G03.05 бракуе толькі публічны запуск (G10.02.b), не распрацоўка. Блокеры не аслабленыя: G02.03 — #55 (закрыты PR #105); G01.04 і G03.05 — tracking-ісью [#109](https://github.com/vokhandcrafts/KUDY/issues/109) і [#110](https://github.com/vokhandcrafts/KUDY/issues/110), без `agent:ready` да разбіўкі.

## Публікацыя ў GitHub — выкананая 2026-09-17

Целы ўзятыя з [issues-draft.md](issues-draft.md) і апублікаваныя пасля мержу плана ў default branch: эпік G10 — [#108](https://github.com/vokhandcrafts/KUDY/issues/108), G10.01 — [#111](https://github.com/vokhandcrafts/KUDY/issues/111), G10.02 — [#112](https://github.com/vokhandcrafts/KUDY/issues/112), tracking-ісью папярэднікаў — [#109](https://github.com/vokhandcrafts/KUDY/issues/109) (G01.04) і [#110](https://github.com/vokhandcrafts/KUDY/issues/110) (G03.05). Пазнакі `agent:ready`/`prio:*` не ставіліся — іх ставіць толькі аператар. Калі целы на GitHub зменяцца, чарнавікі ў `issues-draft.md` застаюцца запісам таго, што было апублікавана.

## Як запускаць

> Выканай толькі `docs/agent-tasks/web/G10.01.a.md`. Прачытай яго ўваходы, правер залежнасці, вынік і доказы захавай паводле файла.

Перад запускам праверыць, што blocker закрыты ў default branch, а не толькі ў WIP-галіне. Вынікі — у `docs/agent-tasks/results/<ID>.md`.
