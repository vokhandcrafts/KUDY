# G17.04 — wiki collector: MediaWiki API, category expansion, licensed attribution

*Showboat demo for issue #159 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g1704-wiki-collector -->

The wiki collector turns a campaign's `wiki` block (MediaWiki `api.php` endpoint, article and category lists, expansion depth) into `raw_records` with `source_type=wiki`, `rights=licensed` and full attribution metadata. The demo drives the production `runCampaign` with a recorded fixture transport behind the injected `loadApi` boundary — the same production entrypoint the CLI uses, offline and deterministic (no network call).

The fixture campaign lists the article `Gdańsk` directly plus the category `Category:Architektura Gdańska`. The category's members are one article, one in-topic subcategory (`Historia` matches the campaign topic `historia`) and one out-of-topic subcategory (`Sport` matches nothing). One run expands the category, records every reachable article with its attribution, and completes the out-of-topic subcategory with a note naming the filter:

```sh
node --input-type=module -e '
import fs from "node:fs";
import { createHash } from "node:crypto";
import { runCampaign, defaultHandlers } from "./tools/collector/runloop.mjs";
import { parseCampaign } from "./tools/collector/campaign.mjs";
import { openStore } from "./tools/collector/store.mjs";
const dir = "/tmp/kudy-g1704-demo";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const yaml = [
  "city: gdansk",
  "seeds:",
  "  - https://news.example/gdansk",
  "topics: [architektura, historia]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
  "wiki:",
  "  api: https://pl.wikipedia.org/w/api.php",
  "  depth: 2",
  "  articles:",
  "    - Gdańsk",
  "  categories:",
  "    - Category:Architektura Gdańska",
].join("\n") + "\n";
fs.writeFileSync(dir + "/campaign.yaml", yaml);
const article = (title, revid, user, text) => JSON.stringify({ parse: { title, pageid: 7351, revid, text, revisions: [{ revid, timestamp: "2026-09-24T10:00:00Z", user }] } });
const members = (entries) => JSON.stringify({ batchcomplete: true, query: { categorymembers: entries } });
const responses = {
  "parse:Gdańsk": article("Gdańsk", 97531, "WikiEditor", "<p><b>Gdańsk</b> is a city on the <a href=\"/wiki/Baltic_Sea\">Baltic coast</a>.</p><p>The <a href=\"/wiki/Stocznia_Gda%C5%84ska\">shipyard</a> story began in 1945.</p>"),
  "members:Category:Architektura Gdańska": members([{ ns: 0, title: "Stocznia Gdańska", pageid: 100 }, { ns: 14, title: "Category:Historia Gdańska", pageid: 200 }, { ns: 14, title: "Category:Sport w Gdańsku", pageid: 300 }]),
  "members:Category:Historia Gdańska": members([{ ns: 0, title: "Westerplatte", pageid: 400 }]),
  "parse:Stocznia Gdańska": article("Stocznia Gdańska", 10001, "AnotherEditor", "<p>The shipyard gates became a symbol of 1980.</p>"),
  "parse:Westerplatte": article("Westerplatte", 40001, "WikiEditor", "<p>The peninsula where the war began.</p>"),
};
const loadApi = async (url) => {
  const params = new URL(url).searchParams;
  const key = params.get("action") === "parse" ? "parse:" + params.get("page") : "members:" + params.get("cmtitle");
  return responses[key];
};
const db = openStore(dir + "/db.sqlite");
const source = fs.readFileSync(dir + "/campaign.yaml", "utf8");
const parsed = parseCampaign(source);
if (!parsed.ok) { console.error(parsed.diagnostics.join("\n")); process.exit(1); }
const run = await runCampaign(db, parsed.campaign, { sourcePath: dir + "/campaign.yaml", contentHash: createHash("sha256").update(source).digest("hex"), snapshotsRoot: dir + "/snapshots", handlers: defaultHandlers({ loadApi }) });
console.log(`steps done ${run.done}, failed ${run.failed}`);
for (const row of db.prepare("SELECT source_type, rights, url, snapshot_path FROM raw_records ORDER BY url").all()) {
  const meta = JSON.parse(fs.readFileSync(row.snapshot_path + "/metadata.json", "utf8"));
  console.log(`${row.source_type} | ${row.rights} | ${row.url}`);
  console.log(`  attribution: ${JSON.stringify(meta.attribution)}`);
}
for (const row of db.prepare("SELECT detail FROM run_log WHERE kind = \u0027wiki-category\u0027 AND detail LIKE \u0027%not expanded%\u0027").all()) {
  console.log(`notes: ${row.detail.split(" | ").slice(1).join(" | ")}`);
}
'
```

```output
steps done 6, failed 0
wiki | licensed | https://pl.wikipedia.org/wiki/Gda%C5%84sk
  attribution: {"site":"https://pl.wikipedia.org","revision_id":97531,"contributors_url":"https://pl.wikipedia.org/w/index.php?title=Gda%C5%84sk&action=history","license":"CC BY-SA"}
wiki | licensed | https://pl.wikipedia.org/wiki/Stocznia_Gda%C5%84ska
  attribution: {"site":"https://pl.wikipedia.org","revision_id":10001,"contributors_url":"https://pl.wikipedia.org/w/index.php?title=Stocznia_Gda%C5%84ska&action=history","license":"CC BY-SA"}
wiki | licensed | https://pl.wikipedia.org/wiki/Westerplatte
  attribution: {"site":"https://pl.wikipedia.org","revision_id":40001,"contributors_url":"https://pl.wikipedia.org/w/index.php?title=Westerplatte&action=history","license":"CC BY-SA"}
notes: 'Category:Sport w Gdańsku' not expanded: no campaign topic matches (topics: architektura, historia)
```

A missing title answers the MediaWiki error envelope; its own step fails with a diagnostic naming the title and the API error, and the run completes with the valid article recorded:

```sh
node --input-type=module -e '
import fs from "node:fs";
import { createHash } from "node:crypto";
import { runCampaign, defaultHandlers } from "./tools/collector/runloop.mjs";
import { parseCampaign } from "./tools/collector/campaign.mjs";
import { openStore } from "./tools/collector/store.mjs";
const dir = "/tmp/kudy-g1704-demo";
const yaml = [
  "city: gdansk",
  "seeds:",
  "  - https://news.example/gdansk",
  "topics: [architektura, historia]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube: []",
  "wiki:",
  "  api: https://pl.wikipedia.org/w/api.php",
  "  depth: 1",
  "  articles:",
  "    - Gdańsk",
  "    - NotExist",
].join("\n") + "\n";
fs.writeFileSync(dir + "/campaign-missing.yaml", yaml);
const responses = {
  "parse:Gdańsk": JSON.stringify({ parse: { title: "Gdańsk", pageid: 7351, revid: 97531, text: "<p><b>Gdańsk</b> is a city on the Baltic coast.</p>", revisions: [{ revid: 97531, timestamp: "2026-09-24T10:00:00Z", user: "WikiEditor" }] } }),
  "parse:NotExist": JSON.stringify({ error: { code: "missingtitle", info: "The article title you requested doesn\u0027t exist" } }),
};
const loadApi = async (url) => {
  const params = new URL(url).searchParams;
  const key = params.get("action") === "parse" ? "parse:" + params.get("page") : "members:" + params.get("cmtitle");
  return responses[key];
};
const db = openStore(dir + "/db.sqlite");
const source = fs.readFileSync(dir + "/campaign-missing.yaml", "utf8");
const parsed = parseCampaign(source);
if (!parsed.ok) { console.error(parsed.diagnostics.join("\n")); process.exit(1); }
const run = await runCampaign(db, parsed.campaign, { sourcePath: dir + "/campaign-missing.yaml", contentHash: createHash("sha256").update(source).digest("hex"), snapshotsRoot: dir + "/snapshots", handlers: defaultHandlers({ loadApi }) });
console.log(`steps done ${run.done}, failed ${run.failed}`);
for (const row of db.prepare("SELECT ref, error FROM run_log WHERE status = \u0027failed\u0027").all()) {
  console.log(`${row.ref}: ${row.error}`);
}
'
```

```output
steps done 2, failed 1
NotExist: wiki api error for 'NotExist': missingtitle — The article title you requested doesn't exist
```

The full acceptance suite:

```sh
node --test --test-reporter=spec "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 61
ℹ pass 61
ℹ fail 0
```
