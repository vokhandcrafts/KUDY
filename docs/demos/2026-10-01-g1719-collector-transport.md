# G17.19 — Транспарт збору ў кампаніі: «напрамую» (дэфолт) / «праз Tor»

*Showboat demo for issue #414 (G17.19), created 2026-10-01.*

<!-- showboat-id: g1719-collector-transport -->

Кампанія атрымлівае поле `transport`: `direct` — дэфолт, сённяшнія паводзіны;
`tor` — усе каналы збору ідуць праз SOCKS5-проксі `127.0.0.1:9050` (браўзер
разам з DNS і robots.txt, вікі-кліент, yt-dlp з вокладкамі — праводку
каналаў пакрываюць сьюты `campaign/store/netfetch/youtube/runloop`; тут —
схема і сховішча прадакшнага CLI). Дэма ганяе афлайн над file://-фіксурай,
без сеткі. Невядомае значэнне адхіляецца strict-схемай з дыягностыкай, што
 называе поле (крытэрый 1); tor-кампанія працуе на file:// шляху без
якога-небудзь проксі — лянівыя каналы не ствараюцца (крытэрый 2);
транспарт захоўваецца ў радку кампаніі і чытаецца адтуль, паўторны запуск
не дублюе кампанію, адрэдагаванае значэнне дасягае радка (крытэрый 5).
Нумар кампаніі ў выводах — хэш шляху фіксуры, дэтэрмінаваны на фіксаваным
/tmp-шляху. На гэтым хасце node патрабуе `LD_LIBRARY_PATH` (libsimdjson) —
кожны блок пачынаецца з export.

Настройка: фікстуры, дзве кампаніі, схема:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib; hash -r
rm -rf /tmp/kudy-g1719-demo && mkdir -p /tmp/kudy-g1719-demo && node -e '
const fs = require("node:fs");
const article = [
  "<!DOCTYPE html>", "<html lang=\"pl\">", "<head>", "  <title>Gdansk shipyard turns into a museum</title>",
  "  <meta name=\"date\" content=\"2026-09-20\">", "</head>", "<body>",
  "  <p>The <a href=\"https://gdansk.example/history\">shipyard history</a> began in 1844.</p>",
  "  <p>Read the <a href=\"../museum/main-hall.html\">main hall guide</a>.</p>",
  "  <p>No links in this paragraph at all.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync("/tmp/kudy-g1719-demo/seed.html", article);
const base = [
  "city: gdansk",
  "seeds:",
  "  - file:///tmp/kudy-g1719-demo/seed.html",
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
];
fs.writeFileSync("/tmp/kudy-g1719-demo/campaign-vpn.yaml", base.concat(["transport: vpn", "youtube: []"]).join("\n") + "\n");
fs.writeFileSync("/tmp/kudy-g1719-demo/campaign-tor.yaml", base.concat(["transport: tor", "youtube: []"]).join("\n") + "\n");
console.log("fixtures ready");
' && node tools/collector/collector.mjs init --db /tmp/kudy-g1719-demo/db.sqlite
```

```output
fixtures ready
collector: schema ready at /tmp/kudy-g1719-demo/db.sqlite
```

Невядомае значэнне транспарту адхіляецца з імем поля — да сховішча справа не
даходзіць (exit 1):

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib; hash -r
node tools/collector/collector.mjs run --campaign /tmp/kudy-g1719-demo/campaign-vpn.yaml --db /tmp/kudy-g1719-demo/db.sqlite; echo "exit: $?"
```

```output
collector: campaign.transport: Invalid option: expected one of "direct"|"tor"
exit: 1
```

tor-кампанія на file:// сідзе працуе без проксі; радок кампаніі захоўвае
абраны транспарт:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib; hash -r
node tools/collector/collector.mjs run --campaign /tmp/kudy-g1719-demo/campaign-tor.yaml --db /tmp/kudy-g1719-demo/db.sqlite && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g1719-demo/db.sqlite");
console.log(JSON.stringify(db.prepare("SELECT city, transport FROM campaigns").all()));
'
```

```output
collector: campaign gdansk (0d2e66021bf6) — steps done 1, failed 0, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1719-demo/snapshots
[{"city":"gdansk","transport":"tor"}]
```

Рэдагаванне транспарту ў файле кампаніі дасягае таго самага радка (ідэнтычнасць
— шлях файла), дублікатаў няма; крокі ўжо выкананыя — паўторны запуск нічога не
перароблівае:

```sh
export LD_LIBRARY_PATH=$HOME/.local/lib; hash -r
sed -i 's/transport: tor/transport: direct/' /tmp/kudy-g1719-demo/campaign-tor.yaml
node tools/collector/collector.mjs run --campaign /tmp/kudy-g1719-demo/campaign-tor.yaml --db /tmp/kudy-g1719-demo/db.sqlite && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g1719-demo/db.sqlite");
console.log(JSON.stringify(db.prepare("SELECT city, transport FROM campaigns").all()));
'
```

```output
collector: campaign gdansk (0d2e66021bf6) — steps done 0, failed 0, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1719-demo/snapshots
[{"city":"gdansk","transport":"direct"}]
```
