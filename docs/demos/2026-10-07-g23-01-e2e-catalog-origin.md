# G23.01 — сінтэтычны каталог-поход для E2E адной камандай

*2026-10-07 by Showboat 0.6.1*

G23.01 (issue #659): `npm run e2e:origin` збірае фікстуры `fixtures/e2e/*`
вытворчым шляхам публікацыі (`tools/build-bundle` → `tools/publish-catalog`)
і друкуе значэнне `EXPO_PUBLIC_CATALOG_ORIGIN` (хост і Android-эмулятар праз
10.0.2.2). Дэтэрмінізм: час публікацыі запінены, таму два прагоны кладуць
байт-ідэнтычныя файлы — адзін sha256 каталога.

Каманда 1: збора origin без сервера — дэтэрміністычны справаздача з
зарэгістраваным дайджэстам `catalog.json`. Адкат фікстуры або вытворчага
шляху публікацыі (packager → pointer swap) робіць гэты радок іншым альбо
каманда падае.

```bash
cd /home/viktar/worktrees/kudy-659 && LD_LIBRARY_PATH=$HOME/.local/lib npm run --silent e2e:origin -- --no-serve 2>/dev/null
```

```output
E2E origin ready: /home/viktar/worktrees/kudy-659/tools/e2e-origin/build/origin
catalog sha256: ced17c5d1db646e71c8111237ea4abacbac3d8513edee38e69385dbf3da740de
routes: 2  discovery: discovery/e2e-city/r-e2e-free-1/index.json
```

Каманда 2: гард-сюіта `tools/e2e-origin/` — валідацыя абодвух пакетаў,
адмова валідатара на карумпаванай фікстуры (крытэрый 6), валідны
двух-маршрутны каталог праз вытворчы шлях, байт-ідэнтычнасць двух збораў,
іменаваныя дыягностыкі fault-спецы, fault-пераключальнік 404/500/stall,
кантэйнмент сервера. Адкат любой з гэтых паводак робіць адпаведны радок
`not ok`.

```bash
cd /home/viktar/worktrees/kudy-659 && LD_LIBRARY_PATH=$HOME/.local/lib node --test --test-reporter=tap tools/e2e-origin/e2e-origin.test.mjs 2>/dev/null | grep -E "^(ok|not ok|1\.\.)"
```

```output
ok 1 - both fixture packages validate against the package schemas (criterion 2)
ok 2 - the guard fails when a fixture stops validating against the schema (criterion 6)
ok 3 - the production publishing path lays a valid two-route catalog (criterion 2)
ok 4 - two builds lay byte-identical files (criterion 4)
ok 5 - parseFaultSpec answers with named diagnostics on bad input (rule 14)
ok 6 - the fault switch answers 404/500/stall for named files (criterion 5)
ok 7 - an unnamed missing file answers 404 and containment holds (rule 3)
ok 8 - the summary prints the app origin, the emulator origin and the digest
ok 9 - the e2e:origin npm script stays wired to this tool (implementation-rules 1)
1..9
```
