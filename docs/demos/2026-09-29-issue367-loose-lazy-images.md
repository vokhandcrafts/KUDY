# G17.10 — loose and lazy images land in the snapshot

*Showboat demo for issue #367 (`tools/collector` extraction), created 2026-09-29.*

<!-- showboat-id: issue367-loose-lazy-images -->

Images standing outside paragraphs and figures (directly in page containers)
and lazy-loaded sources (`data-src`/`srcset` instead of `src`) are collected by
the same rules as before: the 150 px content threshold, slug filenames, a
`media` row and a markdown insertion at the document position. The demo runs
one file:// seed through the real campaign loop: a loose hero between
paragraphs, a lazy image whose visible `src` is a decorative placeholder (the
placeholder file does not even exist), and a small container logo. The output
shows every saved `media` row, the `text.md` block order, and the rule cases —
the placeholder creates no step at all, the logo is skipped by the threshold.
Paths are printed relative to the checkout root, so the output does not depend
on where the repository lives:

```sh
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCampaign } from "./tools/collector/runloop.mjs";
import { openStore, sha256Hex } from "./tools/collector/store.mjs";
import { parseCampaign } from "./tools/collector/campaign.mjs";
import { articleHtml, campaignYaml, pngBytes, writeCampaignFile } from "./tools/collector/testkit.mjs";
const dir = "tools/collector/runtime/demo-367";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (const [name, w, h] of [["hero-640x400.png", 640, 400], ["lazy-800x600.png", 800, 600], ["icon-100x90.png", 100, 90]]) {
  fs.writeFileSync(path.join(dir, name), pngBytes(w, h));
}
fs.writeFileSync(
  path.join(dir, "article.html"),
  articleHtml({
    body: [
      "<p>Paragraph zero.</p>",
      `<div class="article-body"><img src="hero-640x400.png" alt="Hero" title="The yard"></div>`,
      "<p>Paragraph one.</p>",
      `<img src="placeholder-40x20.jpg" data-src="lazy-800x600.png" alt="Lazy">`,
      "<p>Paragraph two.</p>",
      `<footer><img src="icon-100x90.png" alt="logo"></footer>`,
    ],
  })
);
const url = pathToFileURL(path.resolve(dir, "article.html")).href;
const file = writeCampaignFile(dir, campaignYaml({ youtube: null, seeds: "seeds:\n  - " + url }));
const parsed = parseCampaign(fs.readFileSync(file, "utf8"));
const db = openStore(path.join(dir, "db.sqlite"));
const run = await runCampaign(db, parsed.campaign, {
  sourcePath: file,
  contentHash: sha256Hex(fs.readFileSync(file, "utf8")),
  snapshotsRoot: path.join(dir, "snapshots"),
});
const root = pathToFileURL(process.cwd()).href + "/";
const rel = (u) => (u.startsWith(root) ? "." + u.slice(root.length - 1) : u);
console.log("failed steps:", run.failed);
for (const row of db.prepare("SELECT file, position, source_url FROM media ORDER BY file").all()) {
  console.log(row.file, "| position", row.position, "|", rel(row.source_url));
}
const skipped = db
  .prepare(`SELECT COUNT(*) AS n FROM run_log WHERE kind = ? AND detail LIKE ? AND detail LIKE ?`)
  .get("image", "%icon-100x90.png%", "%under the 150px content minimum%").n;
console.log("small logo skipped by the 150 px rule:", skipped === 1);
const placeholder = db.prepare(`SELECT COUNT(*) AS n FROM run_log WHERE detail LIKE ?`).get("%placeholder-40x20.jpg%").n;
console.log("placeholder got no step:", placeholder === 0);
const record = db.prepare("SELECT snapshot_path FROM raw_records").get();
const text = fs.readFileSync(path.join(record.snapshot_path, "text.md"), "utf8").trim();
text.split("\n\n").forEach((block, i) => console.log("block", i, ":", block.split("\n")[0]));
fs.rmSync(dir, { recursive: true, force: true });
'
```

```output
failed steps: 0
gdansk-shipyard-turns-into-a-museum-img-01.png | position 1 | ./tools/collector/runtime/demo-367/hero-640x400.png
gdansk-shipyard-turns-into-a-museum-img-02.png | position 2 | ./tools/collector/runtime/demo-367/lazy-800x600.png
small logo skipped by the 150 px rule: true
placeholder got no step: true
block 0 : Paragraph zero.
block 1 : ![Hero](media/gdansk-shipyard-turns-into-a-museum-img-01.png)
block 2 : Paragraph one.
block 3 : ![Lazy](media/gdansk-shipyard-turns-into-a-museum-img-02.png)
block 4 : Paragraph two.
```
