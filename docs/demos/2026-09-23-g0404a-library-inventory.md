# G04.04.a — інвентарызацыя бібліятэкі (services/contentRepo)

Дэма правярае чатыры станы загрузкі з `09` §7 і крытэрый 2 issue #193:
`ready` на поўным пласты, `partial (N missing)` пасля знікнення файла,
`stale` + `not_downloaded` пры новым каталогу і — галоўнае — нязменнасць
гатоўнасці замацаванай версіі (ADR G01.03 §3.4): пакет `route-x@1` паказваецца
як `stale`, але `evaluatePackage` на ім па-ранейшаму аддае `ready`, і
інвентарызацыя не запісвае нічога на дыск. Пятае адлюстроўвае пашкоджаны
`lock.json`: дыягностыка, не крушэнне. Сцэнары піша дрэва ў часовую тэчку і
друкуе толькі вердыкты — без шляхоў і таймінгаў, таму вывад дэтэрмінаваны
(два прамыя запускі — байт-ідэнтычныя).

```sh
node --no-warnings --experimental-strip-types services/contentRepo/demo-g0404a.ts
```

```output
1. route-x@1/be/base: ready (missing 0), bytes 694/694
2. route-x@1/be/base: partial (missing 1), bytes 694/679
3. route-x@1/be/base: stale (missing 0), bytes 694/694
3. route-x@2/be/base: not_downloaded (missing unknown), bytes null/null
4. pinned readiness of the stale version: ready
5. route-x@1/be/base: partial (missing 1), bytes 0/0 diagnostics ["lock.json[0]#type"]
5. route-x@2/be/base: not_downloaded (missing unknown), bytes null/null
```

Дадатковая праверка крытэрыю 3: модуль інвентарызацыі нічога не піше і не
дакранаецца базы — гэта мацуе тэст-гард `wiring: the inventory derives sizes
and never writes (G04.04.a criterion 3)` у `services/contentRepo/wiring.test.ts`
(ён ідзе ў агульным `npm test`).
