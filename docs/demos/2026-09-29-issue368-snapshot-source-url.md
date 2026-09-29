# G17.11 — `source_url` in the snapshot metadata

*Showboat demo for issue #368 (`tools/collector` snapshot pipeline), created 2026-09-29.*

<!-- showboat-id: issue368-snapshot-source-url -->

A snapshot dir must read without the database: `metadata.json` now carries
`source_url` — the address the page was fetched from — beside the title, date,
author and language it already had. The demo runs one file:// seed through the
real campaign loop (fixture HTML, no network), reads back the snapshot's
`metadata.json` and compares it with the `raw_records` passport row. URLs are
printed relative to the checkout root, so the output does not depend on where
the repository lives:

```sh
node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCampaign } from "./tools/collector/runloop.mjs";
import { openStore, sha256Hex } from "./tools/collector/store.mjs";
import { parseCampaign } from "./tools/collector/campaign.mjs";
import { articleHtml, campaignYaml, writeCampaignFile } from "./tools/collector/testkit.mjs";
const dir = "tools/collector/runtime/demo-368";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "article.html"), articleHtml());
const url = pathToFileURL(path.resolve(dir, "article.html")).href;
const file = writeCampaignFile(dir, campaignYaml({ youtube: null, seeds: "seeds:\n  - " + url }));
const parsed = parseCampaign(fs.readFileSync(file, "utf8"));
const db = openStore(path.join(dir, "db.sqlite"));
await runCampaign(db, parsed.campaign, {
  sourcePath: file,
  contentHash: sha256Hex(fs.readFileSync(file, "utf8")),
  snapshotsRoot: path.join(dir, "snapshots"),
});
const root = pathToFileURL(process.cwd()).href + "/";
const rel = (u) => (u.startsWith(root) ? "." + u.slice(root.length - 1) : u);
const record = db.prepare("SELECT url, snapshot_path FROM raw_records").get();
const metadata = JSON.parse(fs.readFileSync(path.join(record.snapshot_path, "metadata.json"), "utf8"));
console.log("record.url    =", rel(record.url));
console.log("metadata.json =", JSON.stringify({ ...metadata, source_url: rel(metadata.source_url) }));
console.log("source_url is the fetched address:", metadata.source_url === record.url);
fs.rmSync(dir, { recursive: true, force: true });
'
```

```output
record.url    = ./tools/collector/runtime/demo-368/article.html
metadata.json = {"title":"Gdansk shipyard turns into a museum","published_at":"2026-09-20","author":"Jan Kowalski","language":"en","source_url":"./tools/collector/runtime/demo-368/article.html"}
source_url is the fetched address: true
```

The wiki path takes the same writer: attribution is still merged in and
`source_url` sits beside it (wiki.test.mjs AC1 asserts both).
