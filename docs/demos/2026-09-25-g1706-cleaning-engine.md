# G17.06 — cleaning engine: rule packages, versioned cleaned documents, review bundle

*Showboat demo for issue #161 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g1706-cleaning-engine -->

The cleaning engine turns a raw snapshot into a versioned cleaned document (`cleaned/v<N>.md` beside the untouched raw files) using data rule packages per source type, and `export-review` writes the author-review bundle whose documents open with the visible citation. The demo drives the real CLI offline: a `file://` seed fixture (with a nav line, an ad line, a «чытайце таксама» line and a figure) goes through `run` (snapshot + image step) and `clean`, and the cleaned document drops all three markers, keeps every content paragraph, keeps the anchors and the photo in place, and names the package in its front matter. Record ids and collection timestamps are volatile by design, so the printed excerpts mask them — the captured output is otherwise byte-identical between runs.

```sh
node --input-type=module -e '
import fs from "node:fs";
const dir = "/tmp/kudy-g1706-demo";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const png = Buffer.alloc(33);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
png.writeUInt32BE(13, 8); png.write("IHDR", 12, "ascii");
png.writeUInt32BE(640, 16); png.writeUInt32BE(400, 20); png[24] = 8;
fs.writeFileSync(dir + "/photo.jpg", png);
fs.writeFileSync(dir + "/seed-page.html", [
  "<!DOCTYPE html>",
  "<html lang=\"pl\">",
  "<head>",
  "  <title>Gdansk shipyard turns into a museum</title>",
  "  <meta name=\"author\" content=\"Jan Kowalski\">",
  "  <meta property=\"article:published_time\" content=\"2026-09-20\">",
  "</head>",
  "<body>",
  "  <p>Меню: Галоўная | Гарады | Кантакты</p>",
  "  <p>The <a href=\"https://gdansk.example/history\">shipyard history</a> began in 1844.</p>",
  "  <p>Рэклама: толькі сёння зніжка на гіды.</p>",
  "  <figure><img src=\"photo.jpg\" alt=\"Stocznia\"><figcaption>Stocznia Gdańska, 1980</figcaption></figure>",
  "  <p>Read the <a href=\"https://gdansk.example/cranes\">crane list</a>.</p>",
  "  <p>Чытайце таксама: гісторыя верфі ў Гданьску.</p>",
  "  <p>No links in this paragraph at all.</p>",
  "</body>",
  "</html>",
  "",
].join("\n"));
fs.writeFileSync(dir + "/campaign.yaml", [
  "city: gdansk",
  "seeds:",
  "  - file:///tmp/kudy-g1706-demo/seed-page.html",
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
].join("\n") + "\n");
console.log("fixture ready");
' && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1706-demo/campaign.yaml --db /tmp/kudy-g1706-demo/db.sqlite && node tools/collector/collector.mjs clean --campaign /tmp/kudy-g1706-demo/campaign.yaml --db /tmp/kudy-g1706-demo/db.sqlite && node --input-type=module -e '
import fs from "node:fs";
const dir = "/tmp/kudy-g1706-demo/snapshots";
const [campaign] = fs.readdirSync(dir);
const [article] = fs.readdirSync(dir + "/" + campaign);
const doc = fs.readFileSync(`${dir}/${campaign}/${article}/cleaned/v1.md`, "utf8");
console.log(doc.split("\n").filter((line) => !line.startsWith("record: ")).join("\n").trimEnd());
'
```

```output
fixture ready
collector: campaign gdansk (826c12db73bc) — steps done 2, failed 0, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1706-demo/snapshots
collector: clean gdansk (826c12db73bc) — eligible 1, versions written 1, unchanged 0, failed 0, skipped (failed earlier) 0
---
url: file:///tmp/kudy-g1706-demo/seed-page.html
type: web
package: news-v1
title: Gdansk shipyard turns into a museum
published_at: 2026-09-20
language: pl
---

The [shipyard history](https://gdansk.example/history) began in 1844.
![Stocznia](media/gdansk-shipyard-turns-into-a-museum-img-01.png)
_Stocznia Gdańska, 1980_
Read the [crane list](https://gdansk.example/cranes).
No links in this paragraph at all.
```

Re-running the same package version converges (nothing to clean); changing the rules — here a `news-v2` package that also drops the last paragraph — writes version 2 beside the untouched version 1, and the run log names the package version for every attempt:

```sh
node tools/collector/collector.mjs clean --campaign /tmp/kudy-g1706-demo/campaign.yaml --db /tmp/kudy-g1706-demo/db.sqlite && node --input-type=module -e '
import fs from "node:fs";
import { cleanCampaign } from "./tools/collector/clean.mjs";
import { PACKAGES } from "./tools/collector/packages.mjs";
import { openStore } from "./tools/collector/store.mjs";
const db = openStore("/tmp/kudy-g1706-demo/db.sqlite");
const newsV2 = { ...PACKAGES.news, version: 2, drop: [...PACKAGES.news.drop, /No links/i] };
const result = cleanCampaign(db, db.prepare("SELECT id FROM campaigns").get().id, { packages: { news: newsV2, wiki: PACKAGES.wiki, youtube: PACKAGES.youtube } });
console.log(`clean with news-v2: versions written ${result.written}, unchanged ${result.unchanged}, failed ${result.failed}`);
const dir = "/tmp/kudy-g1706-demo/snapshots";
const [campaign] = fs.readdirSync(dir);
const [article] = fs.readdirSync(`${dir}/${campaign}`);
console.log(`versions on disk: ${fs.readdirSync(`${dir}/${campaign}/${article}/cleaned`).sort().join(", ")}`);
for (const row of db.prepare("SELECT detail FROM run_log WHERE kind = \u0027clean\u0027 AND detail LIKE \u0027%wrote version%\u0027 ORDER BY id").all()) {
  console.log(`run log: ${row.detail.split(" | ").slice(1).join(" | ")}`);
}
'
```

```output
collector: clean gdansk (826c12db73bc) — eligible 1, versions written 0, unchanged 0, failed 0, skipped (failed earlier) 0
clean with news-v2: versions written 1, unchanged 0, failed 0
versions on disk: v1.md, v2.md
run log: package news-v1: wrote version 1
run log: package news-v2: wrote version 2
```

`export-review` writes the browseable bundle next to the snapshots; each document opens with the visible citation (the volatile collection-date line is masked in this excerpt, as is the record-id fragment inside the generated file name):

```sh
node tools/collector/collector.mjs export-review --campaign /tmp/kudy-g1706-demo/campaign.yaml --db /tmp/kudy-g1706-demo/db.sqlite && node --input-type=module -e '
import fs from "node:fs";
const dir = "/tmp/kudy-g1706-demo/snapshots";
const [campaign] = fs.readdirSync(dir);
const review = `${dir}/${campaign}/review`;
const index = fs.readFileSync(`${review}/index.md`, "utf8");
console.log("--- review/index.md");
console.log(index.replace(/[0-9a-f]{8}-v/, "…-v").trimEnd());
const docFile = index.match(/\]\(([^)]+\.md)\)/)[1];
const doc = fs.readFileSync(`${review}/${docFile}`, "utf8");
console.log("--- review document (citation header)");
console.log(doc.split("\n").filter((line) => !line.startsWith("Забрана:")).slice(0, 9).join("\n").trimEnd());
'
```

```output
collector: review bundle at /tmp/kudy-g1706-demo/snapshots/826c12db73bc/review (1 document(s))
--- review/index.md
# Агляд ачысткі — выбарка для аўтара

- [Gdansk shipyard turns into a museum](gdansk-shipyard-turns-into-a-museum-…-v2.md) — file:///tmp/kudy-g1706-demo/seed-page.html
--- review document (citation header)
# Gdansk shipyard turns into a museum

Крыніца: file:///tmp/kudy-g1706-demo/seed-page.html

---

The [shipyard history](https://gdansk.example/history) began in 1844.
![Stocznia](media/gdansk-shipyard-turns-into-a-museum-img-01.png)
_Stocznia Gdańska, 1980_
```

A truncated snapshot answers with a named diagnostic on its own step — the run continues, no version is written for the failed record:

```sh
node --input-type=module -e '
import fs from "node:fs";
const dir = "/tmp/kudy-g1706-demo";
fs.writeFileSync(dir + "/seed-broken.html", [
  "<!DOCTYPE html>",
  "<html lang=\"pl\">",
  "<head><title>Broken metadata page</title></head>",
  "<body>",
  "  <p>A perfectly fine paragraph.</p>",
  "  <p>Another fine paragraph.</p>",
  "  <p>Third paragraph for the article gate.</p>",
  "</body>",
  "</html>",
  "",
].join("\n"));
fs.writeFileSync(dir + "/campaign-broken.yaml", [
  "city: gdansk",
  "seeds:",
  "  - file:///tmp/kudy-g1706-demo/seed-broken.html",
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
].join("\n") + "\n");
' && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1706-demo/campaign-broken.yaml --db /tmp/kudy-g1706-demo/db.sqlite > /dev/null && node --input-type=module -e '
import fs from "node:fs";
const dir = "/tmp/kudy-g1706-demo/snapshots";
const [campaign] = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "826c12db73bc").map((e) => e.name);
const [article] = fs.readdirSync(`${dir}/${campaign}`);
fs.writeFileSync(`${dir}/${campaign}/${article}/metadata.json`, "{not json", "utf8");
console.log("metadata.json corrupted");
' && node tools/collector/collector.mjs clean --campaign /tmp/kudy-g1706-demo/campaign-broken.yaml --db /tmp/kudy-g1706-demo/db.sqlite; node --input-type=module -e '
import { openStore } from "./tools/collector/store.mjs";
const db = openStore("/tmp/kudy-g1706-demo/db.sqlite");
for (const row of db.prepare("SELECT error FROM run_log WHERE kind = \u0027clean\u0027 AND status = \u0027failed\u0027").all()) {
  console.log(`failed step: ${row.error}`);
}
'
```

```output
metadata.json corrupted
collector: clean gdansk (b73073a334c4) — eligible 1, versions written 0, unchanged 0, failed 1, skipped (failed earlier) 0
failed step: clean file:///tmp/kudy-g1706-demo/seed-broken.html: cannot read metadata.json — Expected property name or '}' in JSON at position 1 (line 1 column 2)
```

The full collector acceptance suite:

```sh
node --test --test-reporter=spec "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 110
ℹ pass 110
ℹ fail 0
```
