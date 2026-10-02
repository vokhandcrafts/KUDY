# G20.09 — атамарнасць адначасовых актывацый аднаго пакета (issue #480)

Два сцэнары над рэальнымі модулямі `services/download/` (activation core,
node store, deletion gate, in-memory zone A). Сцэнар 1: актывацыя A
паркаваная на audio-transfer са staged stops.json, B запрошаная роўна там —
пакетная lane праводзіць B пасля хваста рэнеймаў A, B бярэ зняты слой бяз
фетчаў, інвэнтар гатоўнасці супадае з дыскам. Сцэнар 2: выдаленне падчас
палёту — паркаваная загрузка скасоўваецца названа, sweep сканчваецца да
старту чарговай актывацыі, выдалены пакет чыста перазагружаецца.

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --experimental-strip-types tests/download/g2009-demo-driver.ts 2>/dev/null
```

```output
G20.09-overlap {"aStatus":"complete","bStatus":"complete","bFetched":0,"files":2,"hashesMatch":true,"stagingLeft":false}
G20.09-delete {"deletion":"deleted","aStatus":"cancelled","rowsEmptyAfterDelete":true,"bStatus":"complete","filesAfterRedownload":2,"registryRows":2}
```

Revert-праверкі (правіла 1): абход activation lane ў `activate()` (прамы
выклік `runActivation` бяз `onPackageLane`) робіць чырвонымі тэсты
«G20.09 overlapping_same_key_activation…», «G20.09 cancel_delete_overlap: a
deletion mid-flight…» і «…a pinned version refuses…» — бяз lane другі хвост
рэнеймаў зносіць гатовы слой і эмітуе ready на няпоўным. Зняцце sweep-часткі
(`onSweepLane` + `afterPackageSweeps`) ўзнаўляе raw ENOENT у тэсце «a
deletion mid-flight cancels the parked activation and the queued one
re-downloads».
