# G04.04.b — ахованае выдаленне пакета (services/download)

Дэма правярае выдаленне спампаванага пакета `route-x@1` праз `deletePackage()`
крытэрый issue #194. Першае адлюстроўвае замацаваную версію (ADR G01.03 §3.4):
пакуль жывой сесія існуе, выдаленне адмаўляецца з іменаванай прычынай; пасля
End тое самае выдаленне праходзіць і прыбирае радкі `bundle_asset` (зона A),
а зона B — сесія, налады, падзеі, падказкі, водгукі — байт-ідэнтычная да/пасля.
Пятае паказвае паўторную загрузку купленага пласта праз `requestGrant()` на
фэйкавым транспарце: granted, без шляху пакупкі. Шостае — нябяспечны
ідэнтыфікатар адхіляецца да любога звароту да файлавай сістэмы. Сцэнарый піша
дрэва ў часовую тэчку і друкуе толькі вердыкты, таму вывад дэтэрмінаваны
(два прамыя запускі — байт-ідэнтычныя).

```sh
node --no-warnings --experimental-strip-types services/download/demo-g0404b.ts
```

```output
1. deletion while the walk is live: refused (pinned-by-unfinished-session, sessions 1)
2. deletion after End: deleted (rows 2)
3. zone B untouched: true
4. package files gone: true
5. re-download via grant: granted (paths 2)
6. unsafe id: invalid-input (route_id#unsafe-path:../evil)
```

Дадатковыя праверкі: гонка «выдаленне падчас загрузкі» мацуецца тэстам
`criterion 4: a deletion completing during an in-flight download cancels it —
no half-deleted ready state remains` у `services/download/delete.test.ts`
(актывацыя з адкладзеным fetch завяршаецца `cancelled`, нічога не адраджаецца,
новая загрузка працуе); ён ідзе ў агульным `npm test`.
