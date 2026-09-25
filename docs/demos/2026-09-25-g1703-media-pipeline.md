# G17.03 — media: photos paired with text

*Showboat demo for issue #158 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g1703-media-pipeline -->

The media pipeline turns a snapshot's `<img>` occurrences into per-article media files, complete `media` rows and markdown images at their source positions. The demo builds its fixtures in a fixed temp directory (crafted image headers only — synthetic bytes, no real photos) and drives the production CLI end to end.

A page with four paragraphs carries a 200×120 photo (saved), a 100×90 counter icon (excluded by the size rule) and a 150×150 boundary image (kept — the rule is ≥ 150 px on the longest side). One run registers the snapshot, enqueues and finishes the image steps, writes the spec filenames and places the markdown images:

```sh
node -e '
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const dir = "/tmp/kudy-g1703-demo";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, "media-src"), { recursive: true });
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  return b;
};
fs.writeFileSync(path.join(dir, "media-src", "hall-200x120.png"), png(200, 120));
fs.writeFileSync(path.join(dir, "media-src", "counter-100x90.png"), png(100, 90));
fs.writeFileSync(path.join(dir, "media-src", "gate-150x150.png"), png(150, 150));
const img = (name) => pathToFileURL(path.join(dir, "media-src", name)).href;
const page = [
  "<!DOCTYPE html>", "<html lang=\"en\">", "<head>", "  <title>Gdansk shipyard turns into a museum</title>",
  "</head>", "<body>",
  "  <p>The yard closed in 1844 and reopened as a museum two centuries later.</p>",
  "  <p>The hall today <img src=\"" + img("hall-200x120.png") + "\" alt=\"Hall\" title=\"The main hall\"> hosts the permanent exhibit.</p>",
  "  <p>Visitors so far <img src=\"" + img("counter-100x90.png") + "\" alt=\"counter\"> this year.</p>",
  "  <p>The gate <img src=\"" + img("gate-150x150.png") + "\" alt=\"Gate\" title=\"Yard gate\"> survived the war.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync(path.join(dir, "page.html"), page);
const campaign = [
  "city: gdansk",
  "seeds:",
  "  - " + pathToFileURL(path.join(dir, "page.html")).href,
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
].join("\n") + "\n";
fs.writeFileSync(path.join(dir, "campaign.yaml"), campaign);
console.log("fixtures ready");
' && node tools/collector/collector.mjs init --db /tmp/kudy-g1703-demo/db.sqlite && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1703-demo/campaign.yaml --db /tmp/kudy-g1703-demo/db.sqlite
```

```output
fixtures ready
collector: schema ready at /tmp/kudy-g1703-demo/db.sqlite
collector: campaign gdansk (6e68c585e13c) — steps done 4, failed 0, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1703-demo/snapshots
```

The pairing is three-level (docs/24_web_collection.md «Фота»): the markdown image stands before the text.md block its `media.position` names — after the paragraph it appeared in — the files carry the article slug with occurrence numbering (the excluded counter leaves a stable gap at `-img-02`), and each `media` row carries alt, caption, position, source URL, hash and pixel dimensions (no timestamps or record ids printed here):

```sh
cat /tmp/kudy-g1703-demo/snapshots/*/gdansk-shipyard-*/text.md && echo "--- files ---" && ls /tmp/kudy-g1703-demo/snapshots/*/gdansk-shipyard-*/media/ && echo "--- media rows ---" && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g1703-demo/db.sqlite");
for (const row of db.prepare("SELECT position, alt, caption, file, width_px, height_px, rights FROM media ORDER BY file").all()) {
  console.log([row.position, row.alt, row.caption, row.file, row.width_px + "x" + row.height_px, row.rights].join(" | "));
}
for (const row of db.prepare("SELECT detail FROM run_log WHERE kind = \u0027image\u0027 AND detail LIKE \u0027%skipped%\u0027").all()) {
  console.log("run_log: " + row.detail.split(" | ")[1]);
}
'
```

```output
The yard closed in 1844 and reopened as a museum two centuries later.

The hall today hosts the permanent exhibit.

![Hall](media/gdansk-shipyard-turns-into-a-museum-img-01.png)
_The main hall_

Visitors so far this year.

The gate survived the war.

![Gate](media/gdansk-shipyard-turns-into-a-museum-img-03.png)
_Yard gate_
--- files ---
gdansk-shipyard-turns-into-a-museum-img-01.png
gdansk-shipyard-turns-into-a-museum-img-03.png
--- media rows ---
2 | Hall | The main hall | gdansk-shipyard-turns-into-a-museum-img-01.png | 200x120 | research_only
4 | Gate | Yard gate | gdansk-shipyard-turns-into-a-museum-img-03.png | 150x150 | research_only
run_log: skipped: 100x90px is under the 150px content minimum — file:///tmp/kudy-g1703-demo/media-src/counter-100x90.png
```

Broken sources fail their own steps and the run continues — a missing file, a foreign scheme the offline loader does not serve, and corrupt bytes:

```sh
node -e '
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const dir = "/tmp/kudy-g1703-demo";
fs.writeFileSync(path.join(dir, "corrupt.png"), "plain text, not an image");
const page = [
  "<!DOCTYPE html>", "<html lang=\"en\">", "<head>", "  <title>Broken sources page</title>",
  "</head>", "<body>",
  "  <p>A missing file <img src=\"" + pathToFileURL(path.join(dir, "absent.png")).href + "\" alt=\"gone\"> here.</p>",
  "  <p>A remote image <img src=\"https://cdn.example/pic-400x300.png\" alt=\"remote\"> here.</p>",
  "  <p>A corrupt file <img src=\"" + pathToFileURL(path.join(dir, "corrupt.png")).href + "\" alt=\"junk\"> here.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync(path.join(dir, "broken.html"), page);
const campaign = [
  "city: gdansk",
  "seeds:",
  "  - " + pathToFileURL(path.join(dir, "broken.html")).href,
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
].join("\n") + "\n";
fs.writeFileSync(path.join(dir, "campaign-broken.yaml"), campaign);
' && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1703-demo/campaign-broken.yaml --db /tmp/kudy-g1703-demo/db.sqlite && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g1703-demo/db.sqlite");
for (const row of db.prepare("SELECT error FROM run_log WHERE kind = \u0027image\u0027 AND status = \u0027failed\u0027 ORDER BY ref").all()) {
  console.log(row.error);
}
'
```

```output
collector: campaign gdansk (4190c8c2c523) — steps done 1, failed 3, running 0, pending 0
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g1703-demo/snapshots
image file:///tmp/kudy-g1703-demo/absent.png: ENOENT: no such file or directory, open '/tmp/kudy-g1703-demo/absent.png'
image https://cdn.example/pic-400x300.png: the offline loader serves only file:// sources
image file:///tmp/kudy-g1703-demo/corrupt.png: unsupported or corrupt image bytes
```

The full acceptance suite:

```sh
node --test --test-reporter=spec "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 67
ℹ pass 67
ℹ fail 0
```
