# Issue #433: чалавечыя прычыны дзеянняў — вялікая літара, кропка, без «пакета»

*Showboat demo задачи #433 (эпік #346): слоўнікі прычын прэв'ю/Run/месца/My
(be+en) прыведзены да аднаго правіла афармлення — вялікая літара + кропка,
тэрміны «пакет/сховішча» у reason-радках заменены чалавечымі фразамі
(«Патрэбна пакупка.», «Сховішча недаступнае.», «Гід не спампаваны.»);
тэхнічныя фармулёўкі застаюцца толькі ў muted-detail. Дыягнастычныя коды і
лагіка стануў не кранутыя. Створана 2026-10-01.*

<!-- showboat-id: issue433-reason-phrases -->

Крытэр 2 — гард правіла афармлення (`controllers/reason-strings.test.ts`,
node --test): кожны reason-радок абодвух локаляў — `previewStrings().reason` +
`downloadFailed`, `runMapStrings().reasonText`, `placeDetailStrings().refusalText` —
пачынаецца з вялікай літары і заканчваецца кропкай. Радок `historyUnavailable`
(My) гардзіцца тым жа правілам у `components/ui-strings.test.tsx`.

```sh
node --test --experimental-strip-types controllers/reason-strings.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
node_modules/.bin/jest components/ui-strings.test.tsx 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
ℹ tests 3
ℹ pass 3
ℹ fail 0
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

Рэверт-эксперымент (implementation-rules 1): адкат аднаго значэння да старой
фармулёўкі «патрэбна пакупка» (малая літара, без кропкі) — гард зачырванеў
адзіным упалым тэстам; аднаўленне з git — зелёны.

```sh
sed -i "s/'preview#purchase-required': 'Патрэбна пакупка.'/'preview#purchase-required': 'патрэбна пакупка'/" controllers/catalog/previewController.ts
node --test --experimental-strip-types controllers/reason-strings.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
git checkout -- controllers/catalog/previewController.ts
node --test --experimental-strip-types controllers/reason-strings.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
```

```output
ℹ pass 2
ℹ fail 1
ℹ pass 3
ℹ fail 0
```

Слоўнікавы візуальны прагон кантролера (рэкапча дэмы G06.01.b, правіла 11):
пaid-радок чытаецца як фраза, muted detail з дыягностыкай не змяніўся —
гл. `docs/demos/2026-09-27-g0601b-guide-preview.md`, блок
`demo-g0601b-button.mjs` (`reason=Патрэбна пакупка.`).

Крытэр 1, 2 і 3 — існыя тэсты слоўнікаў абноўленыя пад новыя фразы:
`app/preview.test.tsx` (6 assert-аў), `app/run.test.tsx`,
`app/navigation.test.tsx`, `app/place/place.test.tsx`,
`controllers/catalog/previewController.test.ts` (`downloadError`),
`controllers/run/runSurfaceController.test.ts` (be+en пара
`package-incomplete`).

Крытэр 3 — жывы прагон на AVD `kudy-test` (1080×2400). Скрыншоты ў
`.scratch/issue-433/screens/` (untracked): `preview-free.png` — прэв'ю
free-гіда «Гісторыі сукнараў: ад мытні да порта», Start недаступны з сумленнай
прычынай-фразай «Сховішча недаступнае.» (дэв-кліент без порта сховішча
пакетаў); `preview-paid.png` — прэв'ю paid-гіда «Порт і кантрабандысты»
(«Кропак бясплатна: 1», замкі на пашыраных кропках — іконкі асобная задача
#432), Start недаступны з прычынай «Патрэбна пакупка.». Працэдура: Metro з
worktree задачы (`EXPO_PUBLIC_FAKE_CATALOG=1`, Metro --port 8083 — 8082
трымае паралельная сесія), фейк-сервер каталога на `FAKE_CATALOG_PORT=8791`
(дэфолтны 8787 заняты той жа сесіяй), `adb reverse tcp:8083 tcp:8083`, запуск
`kudy://expo-development-client/?url=exp%3A%2F%2F127.0.0.1%3A8083`, далей
deep-лінкі `kudy://explore`, `kudy://route/guide-suknary` і
`kudy://route/guide-port`; экран здымае `adb exec-out screencap -p`. Дэв-сцяжына
(некамічаная копія `components/dev-catalog.ts` + праводка `app/_layout.tsx` з
асноўнага чэкаўту) пасля здымку знята з worktree — у каміт не трапіла.
