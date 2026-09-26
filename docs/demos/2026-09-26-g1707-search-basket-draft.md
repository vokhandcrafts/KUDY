# #162 — library search, basket and the markdown draft export

*Showboat demo for issue #162 (`tools/collector`), created 2026-09-26.*

<!-- showboat-id: g1707-search-basket-draft -->

docs/24 «Зборка гайдаў — рукамі» promises the author three things: search over
the library (city, topic, source type, full text over the cleaned documents),
a basket of fragments, and a markdown draft export whose citation lines (source
URL + collection date) carry the provenance `07` receives as Source; exporting
moves the records `cleaned → used`. The demo drives the production CLI over a
file:// seed — the offline fixture boundary, no server and no network. Record
ids and the collection timestamp are random per run, so the demo's `sed` masks
them (`<record-id>`, `<added-at>`, `<collected-at>`); everything else — the
campaign hash, the counts, the draft text — is deterministic.

Setup: fixtures and campaign in a fixed temp dir, then `init`, `run`, `clean`
(one cleaned document in the library):

```sh
rm -rf /tmp/kudy-g1707-demo && mkdir -p /tmp/kudy-g1707-demo && node -e '
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const article = [
  "<!DOCTYPE html>", "<html lang=\"pl\">", "<head>", "  <title>Gdansk shipyard turns into a museum</title>",
  "  <meta name=\"date\" content=\"2026-09-20\">", "</head>", "<body>",
  "  <p>The <a href=\"https://gdansk.example/history\">shipyard history</a> began in 1844.</p>",
  "  <p>Read the <a href=\"../museum/main-hall.html\">main hall guide</a>.</p>",
  "  <p>No links in this paragraph at all.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync("/tmp/kudy-g1707-demo/seed.html", article);
fs.writeFileSync("/tmp/kudy-g1707-demo/campaign.yaml", [
  "city: gdansk",
  "seeds:",
  "  - " + pathToFileURL("/tmp/kudy-g1707-demo/seed.html").href,
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
].join("\n") + "\n");
console.log("fixtures ready");
' && node tools/collector/collector.mjs init --db /tmp/kudy-g1707-demo/db.sqlite && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1707-demo/campaign.yaml --db /tmp/kudy-g1707-demo/db.sqlite && node tools/collector/collector.mjs clean --campaign /tmp/kudy-g1707-demo/campaign.yaml --db /tmp/kudy-g1707-demo/db.sqlite
```

```output
fixtures ready
collector: schema ready at /tmp/kudy-g1707-demo/db.sqlite
collector: campaign gdansk (bfb26c66e5f2) — steps done 1, failed 0, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1707-demo/snapshots
collector: clean gdansk (bfb26c66e5f2) — eligible 1, versions written 1, unchanged 0, failed 0, skipped (failed earlier) 0
```

Full text finds the record by a phrase from its cleaned text; a passport filter
that matches nothing (`--type news` — the record is `web`) answers zero:

```sh
node tools/collector/collector.mjs search --query 'shipyard history' --db /tmp/kudy-g1707-demo/db.sqlite | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<record-id>/' && echo '---' && node tools/collector/collector.mjs search --city gdansk --type news --db /tmp/kudy-g1707-demo/db.sqlite
```

```output
<record-id>  gdansk  web  cleaned  Gdansk shipyard turns into a museum — file:///tmp/kudy-g1707-demo/seed.html
collector: 1 record(s)
---
collector: 0 record(s)
```

The basket: the search hit's id goes in (captured from the database), a
repeated add is a no-op, `basket list` shows the fragment:

```sh
ID=$(node -e 'const { DatabaseSync } = require("node:sqlite"); console.log(new DatabaseSync("/tmp/kudy-g1707-demo/db.sqlite").prepare("SELECT id FROM raw_records").get().id)') && echo "id captured" && node tools/collector/collector.mjs basket add --record $ID --db /tmp/kudy-g1707-demo/db.sqlite && node tools/collector/collector.mjs basket add --record $ID --db /tmp/kudy-g1707-demo/db.sqlite && node tools/collector/collector.mjs basket list --db /tmp/kudy-g1707-demo/db.sqlite | sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<record-id>/; s/added [0-9T:.-]+Z/added <added-at>/'
```

```output
id captured
collector: basket — added 1, already in basket 0
collector: basket — added 0, already in basket 1
<record-id>  added <added-at>  gdansk  web  Gdansk shipyard turns into a museum — file:///tmp/kudy-g1707-demo/seed.html
collector: basket holds 1 record(s)
```

The draft: one fragment with the citation line (`Крыніца:` / `Забрана:` /
`Запіс:` — the provenance `07` walks back to the raw record), the cleaned body
under the fragment title; the export moves the record `cleaned → used`, and a
repeat export changes nothing:

```sh
node tools/collector/collector.mjs export-draft --out /tmp/kudy-g1707-demo/draft.md --db /tmp/kudy-g1707-demo/db.sqlite && echo '---' && sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<record-id>/; s/Забрана: [0-9T:.-]+Z/Забрана: <collected-at>/' /tmp/kudy-g1707-demo/draft.md && node tools/collector/collector.mjs export-draft --out /tmp/kudy-g1707-demo/draft.md --db /tmp/kudy-g1707-demo/db.sqlite && node -e 'const { DatabaseSync } = require("node:sqlite"); console.log("status:", new DatabaseSync("/tmp/kudy-g1707-demo/db.sqlite").prepare("SELECT status FROM raw_records").get().status)'
```

```output
collector: draft at /tmp/kudy-g1707-demo/draft.md — 1 fragment(s), 1 moved to used
---
# Чарнавік гайда — фрагменты з кошыка

## Gdansk shipyard turns into a museum

Крыніца: file:///tmp/kudy-g1707-demo/seed.html
Забрана: <collected-at> · Запіс: <record-id>

The [shipyard history](https://gdansk.example/history) began in 1844.
Read the [main hall guide](file:///tmp/museum/main-hall.html).
No links in this paragraph at all.

collector: draft at /tmp/kudy-g1707-demo/draft.md — 1 fragment(s), 0 moved to used
status: used
```
