# Issue #430: чытэльны выключаны стан галоўнай кнопкі прэв'ю (варыянт А)

*Showboat дэма задачи #430: рашэнне ўладара 2026-10-03 — канон §5 больш не
вызначае выключаную кнопку голым «opacity 0.5» (белы тэкст на светла-зялёным
даваў ≈2:1 — амаль нябачна). Выключаная primary цяпер — «прывід» на
падкладцы: тэкст `color.disabled-ink`, межа `color.disabled-line`, фон
празрысты, полкі няма; пара трымае ≥ 4.5:1 (тэкст) і ≥ 3:1 (межа) на паперы
і на белай картцы (WCAG 1.4.3/1.4.11). Тую ж пару бярэ выключаны Buy
у offer-картачцы — канон адзін, кантракт-супярэчнасцей не пакінулі.
Створана 2026-10-03.*

<!-- showboat-id: issue430-disabled-contrast -->

Крытэр 1 — пара ў каноне: токены `color.disabled-ink`/`color.disabled-line`
у машынным блоку visual-language.md і чатыры запісы ў `contrastPairs`
(папера і картка). Хелпер з гварда лічыць суадносіны:

```sh
node -e "import('./test/wcag-contrast.mjs').then(m => console.log('paper', m.contrast('#6b7280','#faf7f2').toFixed(2), '/ card', m.contrast('#6b7280','#ffffff').toFixed(2)))"
```

```output
paper 4.52 / card 4.83
```

Крытэр 2 — гард пар: новыя запісы трапляюць у існы цыкл «every declared
contrast pair holds at its WCAG threshold» у `test/design-tokens.test.mjs`;
люстра (`components/design-tokens.ts`) пініцца да канона. Revert-эксперыменты
(implementation-rules 1) перад push: светлай літарал у `colorDisabledInk`
ламае гвард пар (чырвоны, з назвай пары); адкат `mainButtonDisabled` на
`opacity: 0.5` у `app/route/[id].tsx` ламае толькі тэст выключанай
кнопкі прэв'ю. Абодва сканчаюцца аднаўленнем файлаў з git — далей сют
зялёны:

```sh
node --test test/design-tokens.test.mjs 2>&1 | grep -E 'ℹ (tests|pass|fail)'
```

```output
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

Дыскант-кантракт выключанай primary (прывід без полкі, апускання няма,
прычына побач) трымае перапісаны тэст clay-кнопак прэв'ю:

```sh
node_modules/.bin/jest app/preview.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
```

Крытэр 3 — жывы скрыншот: `.scratch/issue-430/screens/paid-preview-disabled-start.png`
(untracked). Працэдура жывой праверкі: эмулятар kudy-test (1080×2400,
`-gpu swiftshader_indirect`), фейкавы каталог (untracked скафолд:
`node .scratch/fake-catalog/serve.mjs` на 8787, Metro 8084 з
`EXPO_PUBLIC_FAKE_CATALOG=1` у worktree задачы), запуск праз
`kudy://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8084`, далей
тык «Чым заняцца →» на экране горада, тык па картцы «Порт і
кантрабандысты» (Платна), здымак `adb exec-out screencap -p`. На скрыншоце
«Пачаць» выключаная і чытэльная — прыглушаная пара на паперы, полкі няма,
прычына «Патрэбна пакупка.» побач; побач у дэме-складзе і агульны спіс
гідаў (`discovery-guides.png`).

Дэва-скафолд фейкавага каталога (`components/dev-catalog.ts` + wiring
`app/_layout.tsx`) з worktree зняты да камітаў — як у results/435.md;
скрыншоты і сервер жывуць у git-ігнары .scratch/.
