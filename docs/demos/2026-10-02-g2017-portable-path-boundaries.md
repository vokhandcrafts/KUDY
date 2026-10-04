# G20.17 — пераносныя межы параўнання шляхоў (Windows/Linux)

*Showboat demo for issue #488 (`fixtures-hygiene.test.ts`, `test/design-tokens.test.mjs`, `tools/corpus/import.test.mjs`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: першы карыстаецца `path.win32` — убудаванай
прасторай імёнаў Node, ідэнтычнай на ўсякім хосце, — каб паказаць сам механізм
A26-08 без Windows-машыны; астатнія тры — зялёныя прагоні выпраўленых праверак
на гэтым хосце.

Першы блок — дэфект: `git ls-files` друкуе праз косую рысу на ўсякай
платформе, а `path.relative` на Windows — праз адваротную; нармалізацыі на
межы параўнання не было, таму гард не выключаў уласны файл, знаходзіў свой
уласны маркер `eyJ` і падае:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node -e "const p=require('node:path');const git='supabase/functions/_shared/fixtures-hygiene.test.ts';const win=p.win32.relative('C:/repo','C:/repo/'+git);console.log('git ls-files :',git);console.log('path.relative:',win);console.log('un-normalized self-exclusion holds:',git===win)"
```

```output
git ls-files : supabase/functions/_shared/fixtures-hygiene.test.ts
path.relative: supabase\functions\_shared\fixtures-hygiene.test.ts
un-normalized self-exclusion holds: false
```

Другі блок — выпраўленыя пераносныя сюты на гэтым хасце (Linux): абедзве
праверкі з нармалізаванымі межамі параўнання зялёныя, нічога не прапушчана:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test --experimental-strip-types test/design-tokens.test.mjs supabase/functions/_shared/fixtures-hygiene.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"
```

```output
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
```

Трэці блок — сцэнары бяспекі symlink: на здольным хосце
`traversal_and_junction` выконваецца (не прапушчаны); на няздольным ён
пропускаецца з іменаванай прычынай, ніколі маўкліва (проба магчымасці ў
`tools/corpus/import.test.mjs`, гл. results G20.17):

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test tools/corpus/import.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped)"
```

```output
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ skipped 0
```

Чацвёрты блок — Windows-пакрыццё пераноснага падмноства замацаванае гардам
workflow: прыбраць job `windows-portable` з `required-checks.yml` — і гэты
закомічаны гард чырванее з назвамі адсутных праверак (рэверт-эксперымент у
results G20.17):

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node tools/ci/check-required-checks.mjs
```

```output
guard-required-checks: OK — required-checks runs npm ci + npm test + web build + server:typecheck + arch:check + windows portable subset
```
