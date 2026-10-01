# Issue #434: тып прапановы бачны на картках «Побач»

*Showboat demo задачи #434 (эпік #346): карткі «Побач» раней выглядалі
аднолькава для гіда і месца — тып можна было зразумець толькі з тэксту або
пасля націскання. Цяпер кожная картка носіць маркер тыпу з наяўнага
Lucide-слою побач з бэйджам платнасці: гід — route (шматкропкавы маршрут),
месца — map-pin (адна кропка); экранны рыдар чытае тып з таго ж элемента
(канон §9 — не эмодзі і не галы гліф). Створана 2026-10-01.*

<!-- showboat-id: issue434-nearby-type-markers -->

Крытэр 3 — рэндэр-тэст абодвух тыпаў (`app/map.test.tsx`,-suite «Nearby type
markers (UX 09)»): маркер гіда маце подпіс «Гід» і гліф `lucide lucide-route`,
маркер месца — «Месца» і `lucide lucide-map-pin`; зняцце маркера з
`NearbyCard` чырванее тэст (implementation-rules 1).

```sh
node_modules/.bin/jest app/map.test.tsx -t "type markers" 2>&1 | grep -E "^(Tests:|Test Suites:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       14 skipped, 1 passed, 15 total
```

Рэверт-эксперымент: адкат `app/map.tsx` да базы `ffc1c2b` (без маркераў) —
тэст маркераў чырвоны; аднаўленне з git вяртае маркеры (HEAD іх нясе).

```sh
git show ffc1c2b:app/map.tsx > app/map.tsx
node_modules/.bin/jest app/map.test.tsx -t "type markers" 2>&1 | grep -E "^Tests:"
git checkout -- app/map.tsx
```

```output
Tests:       1 failed, 14 skipped, 15 total
```

Крытэры 1 і 2 — жывы прагон. Захаваны ў `.scratch/issue-434/screens/`
(untracked): `nearby-markers.png` — «Побач» у ручным аглядзе: карткі гідаў
«Гісторыі сукнараў» (Бясплатна) і «Порт і кантрабандысты» (Платна) маюць
route-гліф побач з бэйджам, карткі месцаў «Двор сукнараў», «Мытня на
Рацкавай» — map-pin; экранны рыдар атрымлівае тып з таго ж элемента
(`accessibilityLabel` на View маркера, SVG — дэкарацыя). Працэдура: эмулятар
kudy-test, `adb reverse tcp:8082 tcp:8082`, метро з worktree
(`EXPO_PUBLIC_FAKE_CATALOG=1 npx expo start --port 8082 --dev-client`),
запуск `kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082`,
далей deep-лінк `kudy://map`; экран здымае `adb exec-out screencap -p`.
Каталог — дэв-сцяжына фейкавага каталога (untracked scaffolding:
`.scratch/fake-catalog/`, `components/dev-catalog.ts` + праводка ў
`app/_layout.tsx`, пазычаная на час жывога прагляду і ў дыф PR не ўваходзіць):
без яе паверхня сумленна паказвае «Каталог недаступны», бо device digest-порт
яшчэ не прыляцеў. Радкі тыпу («Гід»/«Месца», en «Guide»/«Place») — у
`nearbyStrings` кантролера паверхні; змена лексікі картак — не ўваходзіць
(гэта #433).
