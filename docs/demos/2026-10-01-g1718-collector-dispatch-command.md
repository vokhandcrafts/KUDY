# G17.18 — кароткая каманда дыспетчара калектара

*Showboat demo for issue #413 (root npm script `collector:dispatch`), created 2026-10-01.*

Кароткая каманда з кораня рэпы паддымае той самы чытэльны дыспетчар на
дэфолтным порце 8767. Першы блок паказвае ўвесь ланцужок Proof з задачы:
порт свабодны да старту → `npm run collector:dispatch` адказвае 200 са
старонкай «Агляд» → пасля забойства па PID які слухае порт зноў свабодны.
(`export LD_LIBRARY_PATH` — хоставае патрабаванне node на гэтай машыне,
не частка змены; шум npm і сервера ідзе ў /dev/null.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
ss -ltnH 'sport = :8767' | wc -l
command npm run collector:dispatch >/dev/null 2>&1 &
sleep 1
curl -sf --retry 10 --retry-connrefused --retry-delay 1 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8767/
curl -sf http://127.0.0.1:8767/ | grep -c '<h1>Дыспетчар калектара</h1>'
PID=$(ss -ltnpH 'sport = :8767' | grep -oP 'pid=\K[0-9]+' | head -1)
kill "$PID"
sleep 1
ss -ltnH 'sport = :8767' | wc -l
```

```output
0
200
1
0
```

Доўгая нод-каманда і паводзіны порта не змяніліся — увесь набор тэстаў
дыспетчара (з новай праверкай npm-скрипта) зялёны; grep пакідае толькі
дэтэрмінаваныя радкі зводкі, без таймінгаў:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --test tools/collector/dispatcher.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 18
ℹ pass 18
ℹ fail 0
```
