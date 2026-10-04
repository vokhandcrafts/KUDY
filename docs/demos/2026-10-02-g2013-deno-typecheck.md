# G20.13 — Deno type-check прадукцыйных энтрыпоінтаў

*Showboat demo for issue #484 (`tools/ci/deno-typecheck.mjs`, `supabase/functions/`), created 2026-10-02.*

Усе блокі дэтэрмінаваныя: праверка бяграе сапраўдным Deno піннаванай версіі
(`supabase/functions/.deno-version` → 2.9.7) па замарожаным `deno.lock`.
Android/iOS і жывы Supabase-runtime — асобныя прыёмкавыя доказы, ніводзін
блок тут іх не сцвярджае. Кожны блок задае `LD_LIBRARY_PATH=$HOME/.local/lib`
яўна: node гэтага хаста патрабуе `libsimdjson.so.33` з `~/.local/lib`, а
Showboat запускае блокі ў ачышчаным асяроддзі (implementation-rules 9).

Першы блок — крытэры 1 і 3 (чысты бок): усе чатыры прадукцыйныя
энтрыпоінты (`device`, `events`, `grant`, `rc-webhook`) і іх імпарт-граф
праходзяць `deno check --frozen-lockfile` пад піннаваным рантаймам;

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" KUDY_DENO="$HOME/.local/bin/deno" node tools/ci/deno-typecheck.mjs; echo "exit=$?"
```

```output
deno-typecheck: OK — 4 production entrypoint(s), Deno 2.9.7, lock frozen
exit=0
```

Другі блок — крытэр 3 (зоркі бок): комітованая фікстура A26-01 чытае
адказ `db.unsafe(...)` як гатовы радок — той самы Promise-as-масіў, што
расбіў стары device-wiring. Праверка адмаўляе файл з іменаванай TS-дыягностыкай
(адмова, не крэш), і TS-памылка роўна адна:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" NO_COLOR=1 KUDY_DENO="$HOME/.local/bin/deno" node tools/ci/deno-typecheck.mjs --file supabase/functions/_fixtures/deno-async-mismatch.ts 2>/tmp/kudy-g2013-fixture.log; echo "exit=$?"; grep -cE "TS[0-9]+" /tmp/kudy-g2013-fixture.log
```

```output
exit=1
1
```

Трэці блок — крытэр 2, fail-closed адсутнага рантайма: без Deno праверка
дае ненулявы выхад з падказкай усталёўкі, ніколі не «паспяховы пропуск»:

```sh
LD_LIBRARY_PATH="$HOME/.local/lib" KUDY_DENO="./deno-absent" node tools/ci/deno-typecheck.mjs 2>&1 | tail -1
```

```output
deno-typecheck: FAIL — Deno runtime not found (./deno-absent: ENOENT) — install the pinned version from supabase/functions/.deno-version or set KUDY_DENO
```
