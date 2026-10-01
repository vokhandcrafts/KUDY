# Issue #427: экран «не знайдзена» ў стылі дадатку

*Showboat demo задачи #427 (эпік #346): хібны deep link (kudy://хоз-за-што)
раней паказваў сыры плэйсхолдар «Not found / Placeholder screen — no product
visuals yet.» без шляху назад. Цяпер невядомы маршрут рэндэрыцца токенамі
(папера, ink, тытул 18) з top safe-area, сумленным паведамленнем па-беларуску
(en-пара — у тым жа каталогу слоў) і адзіным «← Назад», што вядзе на /explore.
Створана 2026-10-01.*

<!-- showboat-id: issue427-not-found -->

Крытэр 4 — рэндэр-тэст новага экрана: копія, «Назад», testID, прэс вядзе на
каталог (`app/navigation.test.tsx`); тое ж дрэва гардзіць гард safe-area
(`app/safe-area.test.tsx`, радок not-found) і адзіны «Назад»
(`app/back-navigation.test.tsx`, радок not-found).

```sh
node_modules/.bin/jest app/navigation.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

Крытэр 2 — BE/EN парытэт слоў экрана: `notFoundTitle`/`notFoundHint` у
каталогу chrome (`components/ui-strings.ts`), гард парытэту і непустоты
словаў абедзвюх локаляў:

```sh
node_modules/.bin/jest components/ui-strings.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

Рэверт-эксперымент (implementation-rules 1): адкат маршрута да сырога
плэйсхолдара (файлы з базы 96745ca) — усе тры гарды чырванеюць:
рэндэр-тэст (няма слоў і «Назад»), гард safe-area (кантэнт не пачынаецца
з 66), гард адзінага «Назад». Файлы аднаўляюцца з git — HEAD нясе новы экран.

```sh
git show 96745ca:app/+not-found.tsx > app/+not-found.tsx
git show 96745ca:components/placeholder.tsx > components/placeholder.tsx
node_modules/.bin/jest app/navigation.test.tsx -t "not-found" 2>&1 | grep -E "^Tests:"
node_modules/.bin/jest app/safe-area.test.tsx -t "not-found" 2>&1 | grep -E "^Tests:"
node_modules/.bin/jest app/back-navigation.test.tsx -t "not-found" 2>&1 | grep -E "^Tests:"
git checkout -- app/+not-found.tsx
rm components/placeholder.tsx
```

```output
Tests:       1 failed, 18 skipped, 19 total
Tests:       1 failed, 7 skipped, 8 total
Tests:       1 failed, 7 skipped, 8 total
```

Крытэры 1 і 3 — жывы прагон. Захаваныя ў `.scratch/issue-427/screens/`
(untracked): `not-found-live.png` — `kudy://nope` паказвае новы экран
(папера, «← Назад» акцэнтам, тытул «Такога экрана няма», падказка; кантэнт
пачынаецца пад статус-барам), `not-found-back-to-explore.png` — прэс «← Назад»
адкрывае каталог (/explore: «Гданьск», сумленны «Каталог недаступны» без
catalog origin). Працэдура: эмулятар kudy-test (1080×2400), `adb reverse
tcp:8082 tcp:8082`, метро з worktree (`npx expo start --port 8082
--dev-client`), запуск
`kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082`, далей
deep-лінк `kudy://nope`; экран здымае `adb exec-out screencap -p`.
Белыя цішоткі статус-бара на светлай паперы — вядомая знаходка #428 (асобная
задача, тут out of scope).
