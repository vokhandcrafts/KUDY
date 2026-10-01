# G17.20 — блок «Як парсіць» у дыспетчары калектара

*Showboat demo for issue #415 (block «Як парсіць» on the dispatcher overview page), created 2026-10-01.*

На старонцы «Агляд» кожная кампанія атрымала блок «Як парсіць»: транспарт з
сховішча па-чалавечы, для «праз Tor» — нумараваныя ручныя крокі з камандамі
копі-пейст і папярэджанні, для «напрамую» — толькі каманда запуску. Дэма
збірае сінтэтычнае сховішча з дзвюма кампаніямі (tor-кампанія яшчэ і задае
профіль браўзера — відаць папярэджанне), паднімае дыспетчар на порце 8799
і лічыць маркеры на старонцы. (`export LD_LIBRARY_PATH` — хоставае
патрабаванне node на гэтай машыне, не частка змены; шум сервера ідзе ў
/dev/null; забойства па PID, які слухае порт.)

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
rm -rf /tmp/kudy-g1720-demo
mkdir -p /tmp/kudy-g1720-demo
cat > /tmp/kudy-g1720-demo/tor.yaml <<'YAML'
city: Гданьск
seeds:
  - https://news.example/gdansk
topics: []
fence: { depth: 3, extra_domains: [], delay_s: [2, 5] }
transport: tor
youtube: []
browser_user_data_dir: /home/editor/browser-profile
YAML
cat > /tmp/kudy-g1720-demo/direct.yaml <<'YAML'
city: Кракаў
seeds:
  - https://news.example/krakow
topics: []
fence: { depth: 3, extra_domains: [], delay_s: [2, 5] }
transport: direct
youtube: []
YAML
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const { openStore } = await import(pathToFileURL("tools/collector/store.mjs"));
const db = openStore("/tmp/kudy-g1720-demo/db.sqlite");
const insert = db.prepare(
  "INSERT INTO campaigns (id, city, source_path, content_hash, seeds, topics, fence, youtube, transport, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
insert.run("tor-demo", "Гданьск", "/tmp/kudy-g1720-demo/tor.yaml", "hash", "[]", "[]", "{}", "[]", "tor", "2026-10-01T00:00:00.000Z");
insert.run("direct-demo", "Кракаў", "/tmp/kudy-g1720-demo/direct.yaml", "hash", "[]", "[]", "{}", "[]", "direct", "2026-10-01T00:00:00.000Z");
db.close();
'
node tools/collector/collector.mjs dispatch --port 8799 --db /tmp/kudy-g1720-demo/db.sqlite >/dev/null 2>&1 &
sleep 1
curl -sf --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8799/ > /tmp/kudy-g1720-demo/page.html
grep -c '<h1>Дыспетчар калектара</h1>' /tmp/kudy-g1720-demo/page.html
grep -c '<h2>Як парсіць</h2>' /tmp/kudy-g1720-demo/page.html
grep -c '<h3>Гданьск — праз Tor <span class="key">(tor)</span></h3>' /tmp/kudy-g1720-demo/page.html
grep -c '<h3>Кракаў — напрамую <span class="key">(direct)</span></h3>' /tmp/kudy-g1720-demo/page.html
grep -c '<li>' /tmp/kudy-g1720-demo/page.html
grep -c 'check.torproject.org/api/ip' /tmp/kudy-g1720-demo/page.html
grep -c 'CDN блакуюць Tor-выходы' /tmp/kudy-g1720-demo/page.html
grep -c 'дэананімізуе трафік' /tmp/kudy-g1720-demo/page.html
grep -c 'run --campaign /tmp/kudy-g1720-demo/tor.yaml' /tmp/kudy-g1720-demo/page.html
PID=$(ss -ltnpH 'sport = :8799' | grep -oP 'pid=\K[0-9]+' | head -1)
kill "$PID"
sleep 1
ss -ltnH 'sport = :8799' | wc -l
rm -rf /tmp/kudy-g1720-demo
```

```output
1
1
1
1
3
1
1
1
1
0
```

Пасля забойства па PID, які слухае порт, порт свабодны, тэмпавая тэчка
прыбраная. Увесь набор тэстаў дыспетчара (з шасцю новымі G17.20-тэстамі)
зялёны; grep пакідае толькі дэтэрмінаваныя радкі зводкі, без таймінгаў:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib
node --test tools/collector/dispatcher.test.mjs 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

```output
ℹ tests 24
ℹ pass 24
ℹ fail 0
```
