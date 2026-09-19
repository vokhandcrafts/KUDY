# TR-3.1 — дывергенцыя кантракту чытачоў (free_base, null, sizes)

Дэма правярае фікс TR-3 часткі 1 (`docs/architecture/23_technical_remarks.md`):
схема `route.schema.json` абвяшчае `access = free_base | paid`, а чытач да фікса
прымае старое `free | paid` — схемна-валідны `free_base`-маршрут вяртаў
`incomplete`, а `route.json` з тэкстам `null` крэшыў ацэнку насуперак кантракту
«never throws». Пасля фікса: `free_base`-пакет гатовы (base публічны, extended —
па гранце, `09` §5.2), старое значэнне адхіляецца з тыпавой дыягностыкай,
пашкоджаны ўвод — дыягностыка, не крэх. Вывад дэтэрмінаваны (вердыкты без
шляхоў і таймінгаў), пакет пішацца ў свежую часовую тэчку.

```sh
node --no-warnings --experimental-strip-types services/contentRepo/demo-tr3.ts
```

```output
1. schema-valid free_base package:  {"status":"ready","routeId":"route-x","version":"1","tier":"base","tierAvailable":["base"]}
2. free_base extended, no grant:     {"status":"access-locked","tier":"extended"}
3. free_base extended, granted:      {"status":"ready","routeId":"route-x","version":"1","tier":"extended","tierAvailable":["base","extended"]}
4. legacy "free" (not in schema):    {"status":"incomplete","missing":["route.json#type"]}
5. route.json text null:             {"status":"incomplete","missing":["route.json#type"]}
```

Дадатковая праверка: guard-ы TR-5 — паводзінныя тэсты абодвух чытачоў на
агульных фікстурах (`web/lib/content/contract-parity.test.ts` +
`services/contentRepo/contentRepo.test.ts`, раздзел TR-3), тыповыя
`@ts-expect-error`-гарды (`contract-restatement.guards.ts` у services і web,
ідуць у прагонах `tsc`), key-parity тэсты супраць схем. Тыповы guard падае
сам, калі абавязковасць `sizes` або enum `access` вернуцца да старой формы.

```sh
node --test --experimental-strip-types --test-reporter=tap --test-concurrency=1 web/lib/content/contract-parity.test.ts 2>&1 | grep -E '^# (tests|pass|fail)'
```

```output
# tests 7
# pass 7
# fail 0
```
