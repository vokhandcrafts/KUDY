# Issue #432: Lucide да канца — замак без эмодзі і адзін вобраз Назаду

*Showboat demo задачи #432 (эпік #346): бэйдж зачыненай кропкі ў прэв'ю гіда
раней быў эмодзі 🔒 у жоўтай пілюлі (гліф выбіваўся з плоскай палітры), а
подпісы Назаду розніліся паміж экранамі — «← Назад» тэкстам, «Назад» без
стрэлкі (дэталь месца), «← Горад». Цяпер бэйдж рэндэрыць Lucide lock праз
CanonIcon (a11y-словы «Зачынена» захаваныя), а адзіны вобраз Назаду —
Lucide-стрэлка + слова з аднаго слоўніка chrome (`components/ui-strings.ts`);
уласныя копіі «Назад» з слоўнікаў дэталі месца і run-карты выдаленыя.
Створана 2026-10-01.*

<!-- showboat-id: issue432-lucide-lock-back -->

Крытэр 1 — замак без эмодзі: NAV5-тэст прэв'ю мацуе, што ў разметцы
зачыненай кропкі няма эмодзі-гліфа (`queryByText("🔒")` пусты), бэйдж мае
a11y-лейбл «Зачынена», а ўсярэдзіне — Lucide-гліф `lucide-lock`
(`app/preview.test.tsx`):

```sh
node_modules/.bin/jest app/preview.test.tsx -t "NAV5" 2>&1 | grep -E "^Tests:"
```

```output
Tests:       27 skipped, 1 passed, 28 total
```

Крытэр 2 — адзін вобраз Назаду: усе экраны з Назадам трымаюць аднолькавую
форму (іконка + слова) і слова з аднаго каталогу; гард адзінства мацуе, што
`back`/`backToCity`chrome-каталогу без тэкставай стрэлкі «←», а слоўнікі
дэталі месца і run-карты больш не трымаюць уласных копій
(`app/back-navigation.test.tsx`):

```sh
node_modules/.bin/jest app/back-navigation.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

Стрэлка вяртаецца чырвонай, калі кампанент страчвае гліф: тэст мацуе
`lucide lucide-arrow-left` усярэдзіне кнопкі і акцэнтны колер атоку
(`components/back-button.test.tsx`):

```sh
node_modules/.bin/jest components/back-button.test.tsx -t "Lucide arrow" 2>&1 | grep -E "^Tests:"
```

```output
Tests:       3 skipped, 1 passed, 4 total
```

Рэверт-эксперымент (implementation-rules 1): адкат кожнай часткі фіксу да
стану базы ffc1c2b — свой гард чырванее. Эмодзі-бэйдж валіць NAV5-тэст,
вяртанне копій «Назад» у слоўнікі валіць гард адзінства, стрэлка без гліфа
валіць тэст вобразу. Файлы аднаўляюцца з git — HEAD нясе фікс.

```sh
git show ffc1c2b:app/route/\[id\].tsx > app/route/\[id\].tsx
node_modules/.bin/jest app/preview.test.tsx -t "NAV5" 2>&1 | grep -E "^Tests:"
git checkout -- app/route/\[id\].tsx
git show ffc1c2b:controllers/place/placeDetailController.ts > controllers/place/placeDetailController.ts
git show ffc1c2b:controllers/run/runMap.ts > controllers/run/runMap.ts
node_modules/.bin/jest app/back-navigation.test.tsx -t "one chrome dictionary" 2>&1 | grep -E "^Tests:"
git checkout -- controllers/place/placeDetailController.ts controllers/run/runMap.ts
git show ffc1c2b:components/back-button.tsx > components/back-button.tsx
node_modules/.bin/jest components/back-button.test.tsx -t "Lucide arrow" 2>&1 | grep -E "^Tests:"
git checkout -- components/back-button.tsx
```

```output
Tests:       27 skipped, 1 failed, 28 total
Tests:       8 skipped, 1 failed, 9 total
Tests:       3 skipped, 1 failed, 4 total
```

Крытэры 1–2 — жывы прагон. Захаваныя ў `.scratch/issue-432/screens/`
(untracked): `01-preview-lock.png` — прэв'ю платнага гіда «Порт і
кантрабандысты»: замкі трох кропак — Lucide-гліф у жоўтай пілюлі (эмодзі
няма), «Назад» з Lucide-стрэлкай акцэнтам, метаданыя з іконкамі гадзінніка
і кропкі; `02-place-back.png` — дэталь месца «Двор сукнараў»: той самы
вобраз Назаду (стрэлка + слова), які раней быў тут голым «Назад» без
стрэлкі. Працэдура: эмулятар kudy-test (1080×2400), фейкавы каталог
(untracked dev-scafолд 2026-09-28: `.scratch/fake-catalog/serve.mjs` на
8787, Metro з worktree з `EXPO_PUBLIC_FAKE_CATALOG=1` на `--port 8082`,
`adb reverse tcp:8082 tcp:8082`, запуск
`kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082`); далей
deep-лінкі `kudy://route/guide-port` і `kudy://place/place-dvoryk`; экран
здымае `adb exec-out screencap -p`. Scafолд у дыф PR не ўваходзіць: без
`EXPO_PUBLIC_FAKE_CATALOG=1` каталог вяртаецца ў сумленны «Каталог
недаступны» (прадуктовая ўмова `app/_layout.tsx`).
