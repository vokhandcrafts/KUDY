# UX 07: спінэры загрузкі замест голага тэксту (issue #353)

*Showboat demo для эпіка дызайн-выпраўленняў #346, задача #353: станы
загрузкі прэв'ю гіда, «Побач», My KUDY, Run і дэталей месца былі голым
тэкстам «Загрузка…» — карыстальнік не бачыў, што дадатак жывы. Змены: адна
агульная кампанента `LoadingIndicator` (`components/loading-indicator.tsx` —
маленькі `ActivityIndicator` побач з тэкстам стану), падключаная ва ўсіх
пяць экранаў; render-тэсты пядаюць пры рэверце індыкатара. Тэксты станаў,
скелетоны і плэйсхолдары — па-за межамі. Створана 2026-09-28.*

<!-- showboat-id: issue353-loading-spinners -->

Крытэр 1 — агульная кампанента, не пяць копій: адзін `LoadingIndicator`,
які ўжываюць усе пяць экранаў (import + месца выкарыстання на кожным).

```sh
for f in "app/route/[id].tsx" app/map.tsx "app/(tabs)/my.tsx" "app/run/[id].tsx" "app/place/[id].tsx"; do grep -Hn "LoadingIndicator" "$f"; done
```

```output
app/route/[id].tsx:19:import { LoadingIndicator } from "../../components/loading-indicator";
app/route/[id].tsx:175:        {state.surface.kind === "loading" ? <LoadingIndicator text="Загрузка…" /> : null}
app/map.tsx:25:import { LoadingIndicator } from "../components/loading-indicator";
app/map.tsx:207:          <LoadingIndicator testID="nearby-message" text={strings.loading} />
app/(tabs)/my.tsx:23:import { LoadingIndicator } from "../../components/loading-indicator";
app/(tabs)/my.tsx:122:          <LoadingIndicator text="Загрузка…" />
app/run/[id].tsx:26:import { LoadingIndicator } from "../../components/loading-indicator";
app/run/[id].tsx:359:        <LoadingIndicator style={styles.centered} text={strings.loading} />
app/place/[id].tsx:26:import { LoadingIndicator } from "../../components/loading-indicator";
app/place/[id].tsx:226:          <LoadingIndicator testID="place-loading" text={strings.loading} />
```

Крытэр 2 — індыкатар у loading-стане бачны рэндэр-тэстам і падае пры
рэверце; свой рэверт-гард мае кожны з пяці экранаў. Спачатку гард агульнай
кампаненты: спінэр (`loading-indicator`) стаіць побач з тэкстам стану.

```sh
node_modules/.bin/jest components/loading-indicator.test.tsx 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

Экран Run: readiness не вырашае проміс — тэст UX 02 трымае сесію ў
loading-стане і цяпер яшчэ цвёрдымі словамі знаходзіць індыкатар побач з
«Загрузка…» (рэверт падключэння ў `app/run/[id].tsx` робіць чырвоным).

```sh
node_modules/.bin/jest app/run.test.tsx -t "the loading state keeps the back element" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       17 skipped, 1 passed, 18 total
```

My KUDY: неарушальная чытанка гісторыі трымае паверхню ў loading-стане —
тэст UX 07 знаходзіць спінэр побач з тэкстам (рэверт падключэння ў
`app/(tabs)/my.tsx` робіць чырвоным).

```sh
node_modules/.bin/jest app/my.test.tsx -t "loading state shows the ActivityIndicator" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       2 skipped, 1 passed, 3 total
```

Побач: «вечны» каталогавы fetch трымае паверхню ў loading-стане — той жа
гард на `app/map.tsx`; аналагічныя тэсты маюць place/preview.

```sh
node_modules/.bin/jest app/map.test.tsx -t "loading state shows the ActivityIndicator" 2>&1 | grep -E "^(Test Suites:|Tests:)"
```

```output
Test Suites: 1 passed, 1 total
Tests:       12 skipped, 1 passed, 13 total
```
