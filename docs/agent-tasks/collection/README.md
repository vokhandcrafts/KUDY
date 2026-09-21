# Заданні збору сыравіны з сеткі G17

Дзевяць заданняў да спецыфікацыі [24 — збор з сеткі: сайты і YouTube](../../24_web_collection.md) (чарнавік 2026-09-21). Крыніцы: [07 — кантэнт-пайплайн](../../07_content_pipeline.md), [04 — кантэнт як вузкае месца](../../04_scope_and_roadmap.md). Усе заданні — не пачатыя. Інструмент лакальны і ўнутраны: ён не публікуе нічога, гайды аўтар збірае рукамі; вынік працы — гатовыя `Source` для пайплайна `07`.

| Заданне | Вынік | Пасля | Issue |
|---|---|---|---|
| [G17.01.a](G17.01.a.md) | Каркас калектара: схема кампаніі, схема сховішча, цыкл запуску | першым у G17 | [#155](https://github.com/vokhandcrafts/KUDY/issues/155) |
| [G17.01.b](G17.01.b.md) | Сырая копія старонкі, пашпарт, дэдуплікацыя, працяг пасля перапынку | G17.01.a | [#156](https://github.com/vokhandcrafts/KUDY/issues/156) |
| [G17.02](G17.02.md) | Паўзук з парканам (Playwright) і аудит-лог паркану | G17.01.b | [#157](https://github.com/vokhandcrafts/KUDY/issues/157) |
| [G17.03](G17.03.md) | Фота: імёны па слагу артыкула, табліца `media`, пазіцыі ў тэксце | G17.01.b | [#158](https://github.com/vokhandcrafts/KUDY/issues/158) |
| [G17.04](G17.04.md) | Вікі-калектар (MediaWiki API, CC BY-SA з атрыбуцыяй) | G17.01.b | [#159](https://github.com/vokhandcrafts/KUDY/issues/159) |
| [G17.05](G17.05.md) | YouTube-калектар (yt-dlp, ручныя субтытры, `asr-backlog`) | G17.01.b | [#160](https://github.com/vokhandcrafts/KUDY/issues/160) |
| [G17.06](G17.06.md) | Ачыстка: пакеты правіл news/wiki/youtube-v1, экспарт на прагляд аўтара | G17.02, G17.04, G17.05 | [#161](https://github.com/vokhandcrafts/KUDY/issues/161) |
| [G17.07](G17.07.md) | Пошук, кошык фрагментаў, экспарт чарнавіка з цытатамі | G17.06 | [#162](https://github.com/vokhandcrafts/KUDY/issues/162) |
| [G17.08](G17.08.md) | Пілотная кампанія Гданьск: 7 крытэраў прыёмкі з [24](../../24_web_collection.md) | G17.06 + рашэнні заснавальніка | [#163](https://github.com/vokhandcrafts/KUDY/issues/163) |

Залежнасці: ядро `G17.01.a → G17.01.b`; за ім незалежна ідуць калектары (G17.02/03/04/05); ачыстка і пошук замыкаюць канвеер; пілот — апошні. G17.08 дадаткова чакае tracking-issue з рашэннямі заснавальніка (выбар партала і крыніц фота).

## Публікацыя ў GitHub — выкананая 2026-09-21

Целы ўзятыя з [issues-draft.md](issues-draft.md) і апублікаваныя разам з [PR #152](https://github.com/vokhandcrafts/KUDY/pull/152) са спецыфікацыяй: эпік G17 — [#154](https://github.com/vokhandcrafts/KUDY/issues/154), задачы — [#155](https://github.com/vokhandcrafts/KUDY/issues/155)–[#163](https://github.com/vokhandcrafts/KUDY/issues/163), tracking-ісью рашэнняў заснавальніка — [#153](https://github.com/vokhandcrafts/KUDY/issues/153). Пазнакі `agent:ready`/`epic`/`prio:*` не ставіліся — іх ставіць толькі аператар; задачы чакаюць у backlog. Перад публікацыяй GitHub правераны на дублікаты; усе адзінаццаць issue перачытаныя назад праз API 2026-09-21 — адкрытыя, без пазнак, спасылкі `Epic:`/`Blocked-by:` вырашаныя, плэйсхолдэраў няма. Бачнасць на дошцы dispatcher з сесіі не правяраецца (асобнай дошкі-праекту ў рэпазітара няма): праверана толькі бачнасць issue праз GitHub API.

## Як запускаць

> Выканай толькі `docs/agent-tasks/collection/G17.02.md`. Прачытай яго ўваходы, правер залежнасці, вынік і доказы захавай паводле файла.

Перад запускам праверыць, што blocker закрыты ў default branch, а не толькі ў WIP-галіне. Вынікі — у `docs/agent-tasks/results/<ID>.md`.
