# #524: недаступны шпацыр чытае мову з выбару UI

*Showboat-дэма для #524: без гатовай сесіі паведамленне недаступнасці, радок
прычыны і кнопка вяртання чытаюць выбар be/en/uk з UI-store (#305), а не
фікаваны фолбэк «be» — пасля выбару Українська экран паказваў беларускае
«Сесія недаступная». Гатовая сесія трымае сваю прыбітую лёкаль. Створана
2026-10-02.*

<!-- showboat-id: issue524-run-unavailable-ui-locale -->

Фікс — два фолбэкі ў `app/run/[id].tsx`: `runMapStrings(ready?.locale ?? locale)`
і `uiStrings(ready?.locale ?? locale).back`, дзе `locale` — `useUiLocale()`
(той самы ўзор, што ўжо нёс `GuideHintMount`). Прыёмка — пяць рэндэр-выпадкаў
у `app/run.test.tsx` над рэальным `createServices().uiLocale`: адсутная служба,
недаступная сесія, пераключэнне на адкрытым экране, loading без мовы сесіі і
гатовая en-сесія пад uk-пераключэннем.

```sh
node_modules/.bin/jest --config jest.config.js --runInBand --runTestsByPath app/run.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:|Snapshots:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
Snapshots:   0 total
```

Эксперымент па зняцці фіксу (implementation-rules 1) выкананы ў гэтай сесіі:
абодва `?? locale` у `app/run/[id].tsx` часова вернутыя да `?? "be"` — з пяці
новых выпадкаў чатыры зачырванелі (адсутная служба, недаступная сесія,
пераключэнне на адкрытым экране, loading), а «a ready en session keeps its
words when the UI switches to uk» застаўся зялёным; пасля аднаўлення фіксу той
жа запуск — зелёны (вывад вышэй).

Жывая праверка на прыладзе (таго ж дня, AVD `kudy-test`, Android 16 / API 36,
віртуальны Pixel 6, dev-client над Metro з галінкі задачы): каталог → KUDY →
«Українська» (паверхня перамалёўваецца на месцы — «Історія недоступна.»), потым
`kudy:///run/android-ui-test` у тым жа дадатку — экран паказвае ўкраінскае
«Сесія недоступна» (да фіксу было беларускае «Сесія недаступная», здымак
`.scratch/issue-524/04-run-unavailable-uk.png`). Праз сістэмны Back назад да
пікера, выбар «English», паўтор deep link — «Session unavailable» і «Back»
(`.scratch/issue-524/06-run-unavailable-en.png`). Прамежкавыя здымкі таго
прагону: `.scratch/issue-524/01-after-launch.png`,
`02-kudy-tab.png`, `03-uk-chosen.png`, `05-back-from-run.png`.
