# G04.04.c — праверка прысутнасці пасля рэстарту і запыт перакачкі

Дэма праганяе ланцужок з issue #195 як адзін офлайн-сцэнар: усталяваны пласт
пераразу правяраецца ўзроўнем 2 з `09` §4 — lock-адкрытымі JSON-файламі і
дэшавай праверкай медыя (наяўнасць + размер з `lock.json`), без аднаго хэшу
(крок 1). «Асіратэлы» файл (абрэзаны, але непусты) пераводзіць пласт у
`needs-recovery` са спісам роўна яго lock-шляхоў — ніколі не Play (ADR
G01.03 §3.7, крок 2), запыт перакачкі цягне роўна названыя шляхі (крок 3),
паўторная праверка пацвярджае `verified` (крок 4). Карупцыя таго ж размеру
небачная дзешаваму ўзроўню і ловіцца толькі поўным перахэшаваннем — і тое
толькі на трыгернай умове з `09` §4 (`user-requested`, крок 5); рамонт
замкавай версіі `route-x@1` ідзе па ўласным lock-е, хоць побач ужо ляжыць
цэлая версія `2` (крок 6), і паўторная поўная праверка чыстая (крок 7).
Сцэнары піша дрэва ў часовую тэчку і друкуе толькі вердыкты і лічбы — без
шляхоў і таймінгаў, таму вывад дэтэрмінаваны (два прамыя запускі —
байт-ідэнтычныя).

```sh
node --no-warnings --experimental-strip-types services/download/demo-g0404c.ts
```

```output
1. route-x@1/be/base: verified (checked metadata), full-hash calls 0
2. route-x@1/be/base: needs-recovery (checked metadata, missing ["audio/story-1.m4a"]), full-hash calls 0
3. repair: repaired, fetched ["audio/story-1.m4a"]
4. route-x@1/be/base: verified (checked metadata), full-hash calls 0
5. route-x@1/be/base: needs-recovery (checked full, missing ["audio/story-1.m4a"]), full-hash calls 2
6. pinned repair of route-x@1: repaired, fetched ["audio/story-1.m4a"]
7. route-x@1/be/base: verified (checked full), full-hash calls 4
```

Дадатковая праверка мяжы: праверка прысутнасці чытае дыск, не піша нічога і
не дакранаецца ні сеткі, ні базы — гэта мацуе тэст-гард `wiring: the presence
check stays read-only, network-free and database-free (G04.04.c)` у
`services/contentRepo/wiring.test.ts` (ён ідзе ў агульным `npm test`).
