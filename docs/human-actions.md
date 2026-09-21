# Ручныя дзеянні для чалавека

Куды агенты пасля сканчэння задачы запісваюць тое, што павінен зрабіць сам чалавек:
мерж або закрыццё PR, крок у інтэрфейсе GitHub, змена налад, каманда на сваёй машыне
і г. д. Правіла — у `AGENTS.md`, раздзел «Record human follow-up actions after a task».

## Фармат

Адзін запіс на задачу, каротка, па-беларуску; навейшыя — уверх. Калі дзеянне зроблена,
запіс выдаляюць.

```
### YYYY-MM-DD — кароткая назва
Што зрабіць: адзін-тры сказы загадным ладам.
PR: спасылка (калі ёсць звязаны issue — дадаць і яго)
```

## Што трэба зрабіць

### 2026-09-21 — рэвю сцэнара першага гіда (G03.02)
Што зрабіць: правядзіце аўтарскае рэвю кампазіцыі першага гіда — адзначце ў `authoring/gdansk/claims.json` усе 16 цвярджэнняў (`mark` ok/rejected з `mark_by` і `mark_at`), прыміце рашэнні па сямі драфтах і праекце сцэнара `scenarios/gdansk-first-walk.json` (тэма, склад і парадак кропак вызначае аўтар, 13 §1); агляды з цытатамі і локатарамі друку — у `authoring/gdansk/review/`.
PR: https://github.com/vokhandcrafts/KUDY/pull/150 (issue #58)

### 2026-09-21 — перанос Blocked-by паводле TR-10 (4 issue)
Што зрабіць: прачытай пералікі TR-10 у каментарах [#56](https://github.com/vokhandcrafts/KUDY/issues/56#issuecomment-5753677647), [#58](https://github.com/vokhandcrafts/KUDY/issues/58#issuecomment-5753677741), [#61](https://github.com/vokhandcrafts/KUDY/issues/61#issuecomment-5753677833), [#68](https://github.com/vokhandcrafts/KUDY/issues/68#issuecomment-5753677908) і прымі рашэнне пра звужэнне; пры згодзе перанесі пазнакі `Blocked-by` сам (змены пазнак — за дыспетчарам). Для #68 дадаткова: знімі супярэчнасць task-файла з `blocked-external` G00.04 і паправі уваход `contracts/discovery.ts`.
Пералікі: каментары ў #56, #58, #61, #68; PR няма, звязаныя issue — тыя самыя.

### 2026-09-21 — змерж PR #145 (ачыстка human-actions)
Што зрабіць: праверце і змержуйце PR #145 у main — ён выдаляе выкананы запіс пра мерж PR #144 з гэтага файла.
PR: https://github.com/vokhandcrafts/KUDY/pull/145

### 2026-09-21 — змерж PR #147 (G15.01, чысты аўтарскі падбор)
Што зрабіць: праверце і змержуйце PR #147 у main — ён рэалізуе чысты селектар падбору G15.01 і закрывае issue #68.
PR: https://github.com/vokhandcrafts/KUDY/pull/147
Issue: https://github.com/vokhandcrafts/KUDY/issues/68

(пуста — усе астатнія запісаныя дзеянні зроблены)
