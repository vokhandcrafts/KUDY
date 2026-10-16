# Android E2E retries a transient UI dump failure

*2026-10-16T09:25:20Z by Showboat 0.6.1*
<!-- showboat-id: fa1afbee-ce35-4c53-9185-728eaf80b13c -->

Праверкі мадэлююць часова адсутны dump, памылку pull паміж спробамі і вычарпаны тэрмін. Новы dump не можа падхапіць старэйшы файл; усе спробы застаюцца ў межах агульнага бюджэту.

```bash
node --test --test-name-pattern='dump (retries|clears|preserves)' tools/e2e-android/driver.test.mjs 2>&1 | sed -E -e 's/ \([0-9.]+ms\)//g' -e '/^ℹ duration_ms /d'
```

```output
✔ dump retries transiently missing device files before giving up
✔ dump clears the device file before each retry instead of pulling an older screen
✔ dump preserves the last error when backoff leaves no useful retry window
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

waitFor таксама паўтарае часовы збой атрымання экрана ў межах бюджэту сцэнара. Праверка адначасова пацвярджае аднаўленне і дыягностыку, калі да заканчэння тэрміну экран не атрыманы.

```bash
node --test --test-name-pattern='waitFor retries a transient UI dump failure|waitFor bounds dump attempts' tools/e2e-android/driver.test.mjs 2>&1 | sed -E -e 's/ \([0-9.]+ms\)//g' -e '/^ℹ duration_ms /d'
```

```output
✔ waitFor retries a transient UI dump failure within its deadline
✔ waitFor bounds dump attempts by its deadline and reports the last dump error
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Праверка walk таксама перачытвае фактычную карту на кожным кроку: калі native-карта загрузілася пасля пачатковай схемы, статус кропкі шукаецца ў native-спісе. Сам статус застаецца абавязковай умовай.

```bash
node --test --test-name-pattern='walk status polling follows the native map' tools/e2e-android/walk.test.mjs 2>&1 | sed -E -e 's/ \([0-9.]+ms\)//g' -e '/^ℹ duration_ms /d'
```

```output
✔ walk status polling follows the native map when it loads after the schematic
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
