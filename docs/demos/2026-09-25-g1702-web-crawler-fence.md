# G17.02 — web crawler inside the fence

*Showboat demo for issue #157 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g1702-web-crawler-fence -->

The crawler walks campaign seeds over the network through the fence-audited
pipeline and hands every fetched article to the G17.01.b snapshot writer. The
demo serves two fixture pages plus an "outside" link on a local fixed-port
server (no external network), runs the production CLI — the real Playwright
fetcher drives it — and shows the fence audit log holding: an outside host is
denied, never fetched.

Setup: fixtures and campaign in a fixed temp dir, a stale demo server killed
by its recorded pid, the fixture server started on port 8077, then `init` and
`run`. The seed page links one inside article and one outside host; the run
snapshots both inside pages and denies the outside one. The server is started
as a daemon inside a subshell `( node … & )` with its stdio redirected to a
file — nothing in the block holds the pipes, and its log is shown in the next
block:

```sh
kill $(cat /tmp/kudy-g1702-demo/server.pid 2>/dev/null) 2>/dev/null; rm -rf /tmp/kudy-g1702-demo && mkdir -p /tmp/kudy-g1702-demo && node -e '
const fs = require("node:fs");
const article = (title, links) => [
  "<!DOCTYPE html>", "<html lang=\"en\">", "<head>", `  <title>${title}</title>`,
  "</head>", "<body>",
  ...links.map(([href, text]) => `  <p>Read the <a href="${href}">${text}</a> page.</p>`),
  "  <p>First filler paragraph with plain text.</p>",
  "  <p>Second filler paragraph with plain text.</p>",
  "  <p>Third filler paragraph with plain text.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync("/tmp/kudy-g1702-demo/start.html", article("Gdansk start page", [["/internal", "an internal article"], ["https://portal.example/outside", "an outside link"]]));
fs.writeFileSync("/tmp/kudy-g1702-demo/internal.html", article("An internal article", []));
fs.writeFileSync("/tmp/kudy-g1702-demo/campaign.yaml", [
  "city: gdansk",
  "seeds:",
  "  - http://127.0.0.1:8077/start",
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [0.1, 0.2]",
  "youtube: []",
].join("\n") + "\n");
console.log("fixtures ready");
' && ( node -e '
const fs = require("node:fs");
const http = require("node:http");
const pages = {
  "/start": fs.readFileSync("/tmp/kudy-g1702-demo/start.html"),
  "/internal": fs.readFileSync("/tmp/kudy-g1702-demo/internal.html"),
};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(pages[req.url] ?? "not found");
});
server.listen(8077, "127.0.0.1", () => {
  fs.writeFileSync("/tmp/kudy-g1702-demo/server.pid", String(process.pid));
  console.log("serving http://127.0.0.1:8077");
});
' > /tmp/kudy-g1702-demo/server.log 2>&1 < /dev/null & ) ; for i in 1 2 3 4 5 6 7 8 9 10; do node -e 'require("node:http").get("http://127.0.0.1:8077/start", (r) => { r.resume(); process.exit(0); }).on("error", () => process.exit(1))' 2>/dev/null && break; sleep 0.2; done && node tools/collector/collector.mjs init --db /tmp/kudy-g1702-demo/db.sqlite && node tools/collector/collector.mjs run --campaign /tmp/kudy-g1702-demo/campaign.yaml --db /tmp/kudy-g1702-demo/db.sqlite
```

```output
fixtures ready
collector: schema ready at /tmp/kudy-g1702-demo/db.sqlite
collector: campaign gdansk (e14d485a100e) — steps done 2, failed 0, running 0, pending 0
collector: raw_records total 2
collector: snapshots root /tmp/kudy-g1702-demo/snapshots
```

The fence audit log — one line per event, pinned serialization (field order
`url, decision, fetched`, one space after each colon): the seed and the
discovered article were fetched, the outside host was denied and never
fetched. The pilot criterion is a literal grep over this file:

```sh
cat /tmp/kudy-g1702-demo/server.log && cat /tmp/kudy-g1702-demo/snapshots/*/fence-audit.jsonl && echo "--- pilot grep: denied lines that were fetched (must be 0) ---" && grep -c '"decision": "denied", "fetched": true' /tmp/kudy-g1702-demo/snapshots/*/fence-audit.jsonl || true; echo "--- library rows ---" && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g1702-demo/db.sqlite");
for (const row of db.prepare("SELECT url, source_type, rights FROM raw_records ORDER BY url").all()) {
  console.log([row.url, row.source_type, row.rights].join(" | "));
}
'
```

```output
serving http://127.0.0.1:8077
{"url": "http://127.0.0.1:8077/start", "decision": "allowed", "fetched": true}
{"url": "http://127.0.0.1:8077/internal", "decision": "allowed", "fetched": false}
{"url": "https://portal.example/outside", "decision": "denied", "fetched": false}
{"url": "http://127.0.0.1:8077/internal", "decision": "allowed", "fetched": true}
--- pilot grep: denied lines that were fetched (must be 0) ---
0
--- library rows ---
http://127.0.0.1:8077/internal | web | research_only
http://127.0.0.1:8077/start | web | research_only
```

The fixture server is stopped by the pid it recorded at startup:

```sh
kill $(cat /tmp/kudy-g1702-demo/server.pid) && echo "fixture server stopped"
```

```output
fixture server stopped
```

The full acceptance suite:

```sh
node --test "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 67
ℹ pass 67
ℹ fail 0
```
