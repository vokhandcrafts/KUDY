# #261 — the error series counts every failing crawl step

*Showboat demo for issue #261 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g261-error-series-crawl-failures -->

docs/24 «Паўзук па сайтах» requires «спыненне па серыі памылак». The demo
serves a seed article linking four pages on a local fixed-port server (no
external network): `/a`, `/b`, `/c` have paragraph text but **no `<title>`** —
the fetch itself succeeds, the extract step fails — and `/d` is a normal
article. The production CLI (the real Playwright fetcher drives it) must stop
the run at the third consecutive non-fetch failure with the series diagnostic,
keeping `/d` queued; the next `run` resumes it.

Setup: fixtures and campaign in a fixed temp dir, a stale demo server killed
by its recorded pid, the fixture server started on port 8077, then `init` and
`run`. The run's stderr is captured to a file so the stopped diagnostic is
shown on its own — the server is started as a daemon inside a subshell
`( node … & )` with its stdio redirected to a file, nothing in the block holds
the pipes:

```sh
kill $(cat /tmp/kudy-g261-demo/server.pid 2>/dev/null) 2>/dev/null; rm -rf /tmp/kudy-g261-demo && mkdir -p /tmp/kudy-g261-demo && node -e '
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
// A page the browser downloads fine but the extractor cannot identify:
// paragraphs without a <title> — a non-fetch step failure.
const untitled = [
  "<!DOCTYPE html>", "<html lang=\"en\">", "<head>", "</head>", "<body>",
  "  <p>A page of text that carries no title at all.</p>",
  "  <p>Second filler paragraph with plain text.</p>",
  "</body>", "</html>", "",
].join("\n");
fs.writeFileSync("/tmp/kudy-g261-demo/start.html", article("Gdansk start page", [["/a", "first"], ["/b", "second"], ["/c", "third"], ["/d", "fourth"]]));
fs.writeFileSync("/tmp/kudy-g261-demo/a.html", untitled);
fs.writeFileSync("/tmp/kudy-g261-demo/b.html", untitled);
fs.writeFileSync("/tmp/kudy-g261-demo/c.html", untitled);
fs.writeFileSync("/tmp/kudy-g261-demo/d.html", article("The fourth page", []));
fs.writeFileSync("/tmp/kudy-g261-demo/campaign.yaml", [
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
  "/start": fs.readFileSync("/tmp/kudy-g261-demo/start.html"),
  "/a": fs.readFileSync("/tmp/kudy-g261-demo/a.html"),
  "/b": fs.readFileSync("/tmp/kudy-g261-demo/b.html"),
  "/c": fs.readFileSync("/tmp/kudy-g261-demo/c.html"),
  "/d": fs.readFileSync("/tmp/kudy-g261-demo/d.html"),
};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(pages[req.url] ?? "not found");
});
server.listen(8077, "127.0.0.1", () => {
  fs.writeFileSync("/tmp/kudy-g261-demo/server.pid", String(process.pid));
  console.log("serving http://127.0.0.1:8077");
});
' > /tmp/kudy-g261-demo/server.log 2>&1 < /dev/null & ) ; for i in 1 2 3 4 5 6 7 8 9 10; do node -e 'require("node:http").get("http://127.0.0.1:8077/start", (r) => { r.resume(); process.exit(0); }).on("error", () => process.exit(1))' 2>/dev/null && break; sleep 0.2; done && node tools/collector/collector.mjs init --db /tmp/kudy-g261-demo/db.sqlite && node tools/collector/collector.mjs run --campaign /tmp/kudy-g261-demo/campaign.yaml --db /tmp/kudy-g261-demo/db.sqlite 2> /tmp/kudy-g261-demo/stderr.log
```

```output
fixtures ready
collector: schema ready at /tmp/kudy-g261-demo/db.sqlite
collector: campaign gdansk (7f98af677f9b) — steps done 1, failed 3, running 0, pending 1
collector: raw_records total 1
collector: snapshots root /tmp/kudy-g261-demo/snapshots
```

The run stopped: seed done, three failed steps, `/d` still pending. The
stopped diagnostic names the last failure and quotes the bare extract error —
a missing `<title>`, not a fetch failure:

```sh
cat /tmp/kudy-g261-demo/server.log && cat /tmp/kudy-g261-demo/stderr.log
```

```output
serving http://127.0.0.1:8077
collector: run stopped — error series: 3 consecutive crawl failures, last at http://127.0.0.1:8077/c (missing <title> — the page cannot be identified) — run stopped, queued steps resume on the next run
```

The run_log rows and the fence audit: every one of the three failures was a
successful download (the audit shows `allowed, fetched: true` for each) — the
series counter sees non-fetch failures too, and the unclaimed `/d` stays
`pending` for resume:

```sh
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g261-demo/db.sqlite");
for (const row of db.prepare("SELECT kind, ref, status FROM run_log ORDER BY id").all()) {
  console.log([row.kind, row.ref.replace("http://127.0.0.1:8077", ""), row.status].join(" | "));
}
' && echo "--- fence audit ---" && cat /tmp/kudy-g261-demo/snapshots/*/fence-audit.jsonl
```

```output
seed | /start | done
crawl | /a | failed
crawl | /b | failed
crawl | /c | failed
crawl | /d | pending
--- fence audit ---
{"url": "http://127.0.0.1:8077/start", "decision": "allowed", "fetched": true}
{"url": "http://127.0.0.1:8077/a", "decision": "allowed", "fetched": false}
{"url": "http://127.0.0.1:8077/b", "decision": "allowed", "fetched": false}
{"url": "http://127.0.0.1:8077/c", "decision": "allowed", "fetched": false}
{"url": "http://127.0.0.1:8077/d", "decision": "allowed", "fetched": false}
{"url": "http://127.0.0.1:8077/a", "decision": "allowed", "fetched": true}
{"url": "http://127.0.0.1:8077/b", "decision": "allowed", "fetched": true}
{"url": "http://127.0.0.1:8077/c", "decision": "allowed", "fetched": true}
```

The next `run` resumes the queue: `/d` completes, no series stop:

```sh
node tools/collector/collector.mjs run --campaign /tmp/kudy-g261-demo/campaign.yaml --db /tmp/kudy-g261-demo/db.sqlite && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/tmp/kudy-g261-demo/db.sqlite");
for (const row of db.prepare("SELECT url, source_type, rights FROM raw_records ORDER BY url").all()) {
  console.log([row.url, row.source_type, row.rights].join(" | "));
}
'
```

```output
collector: campaign gdansk (7f98af677f9b) — steps done 1, failed 0, running 0, pending 0
collector: raw_records total 2
collector: snapshots root /tmp/kudy-g261-demo/snapshots
http://127.0.0.1:8077/d | web | research_only
http://127.0.0.1:8077/start | web | research_only
```

The fixture server is stopped by the pid it recorded at startup:

```sh
kill $(cat /tmp/kudy-g261-demo/server.pid) && echo "fixture server stopped"
```

```output
fixture server stopped
```

The collector's full acceptance suite:

```sh
node --test "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 100
ℹ pass 100
ℹ fail 0
```
