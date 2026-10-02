# Пашкоджаны маршрут: дыягностыка замест TypeError (issue #497, R7)

*Showboat demo для фіксу G20.24: `evaluatePackage` кастыў `route.json.stops`
да `RouteStop[]` без праверкі элементаў — `stops:[null]` кідаў TypeError на
чытанні `access_tier`, а прымітыў/масіў/пусты аб'ект праходзіў маўкліва.
Створана 2026-10-02.*

<!-- showboat-id: g2024-corrupt-route-stops -->

Дэма ганяе пяць новых кейсаў R7 з сьюту `services/contentRepo` праз сапраўдны
node-адаптар `PackageStore` (пашкоджаныя байты на дыску, не стаб):
`null_stop_no_throw`, `malformed_stop_row_incomplete`,
`denied_layer_stays_locked`, `valid_route_readiness` + кейс захавання
identity/ref-праверак. Рэверц-эксперымент (implementation-rules 1) выкананы ў
гэтай сесіі: без фіксу чырвонеюць 4 кейсы з 5 (TypeError на `[null]` дасягае
тэстаў), `valid_route_readiness` заставаўся зелёным. З фіксам — ніжэйшы вывод,
два прагону запар байт-у-байт ідэнтычныя (таймінгі зрэзаныя sed-ам;
`LD_LIBRARY_PATH` — патрэба гэтага хасца: libsimdjson для node).

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --test --experimental-strip-types --test-name-pattern=G20.24 services/contentRepo/contentRepo.test.ts 2>&1 | grep -E "^✔|^✖|^ℹ (tests|pass|fail)" | sed -E "s/ \([0-9.]+ms\)//"
```

```output
✔ G20.24 null_stop_no_throw: stops:[null] evaluates incomplete through the real store
✔ G20.24 malformed_stop_row_incomplete: null, primitive, array and malformed object rows are each named
✔ G20.24: structural stop faults do not suppress identity or reference checks
✔ G20.24 denied_layer_stays_locked: damaged stops never turn a denied layer ready
✔ G20.24 valid_route_readiness: valid two-tier stops keep base and granted-extended readiness
ℹ tests 5
ℹ pass 5
ℹ fail 0
```
