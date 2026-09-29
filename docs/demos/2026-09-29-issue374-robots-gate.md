# G17.15 — the robots.txt gate keeps the crawl off disallowed paths

*Showboat demo for issue #374 (`tools/collector` crawl), created 2026-09-29.*

<!-- showboat-id: issue374-robots-gate -->

Before the crawl fetches any http(s) URL, the campaign reads the host's
robots.txt (once per run, the request itself politeness-gated) and never
requests disallowed paths: a refused seed fails its step with a readable
diagnostic and a campaign whose every seed is refused stops with a readable
diagnostic instead of an empty «successful» run, while a refused discovered
link completes with a skip note and every refusal lands in the fence audit
with its reason. The demo serves robots.txt and pages from a local
127.0.0.1 fixture server (the only network), runs the real campaign loop
through the production robots transport, and masks the random port the
server got — everything else is the pipeline's own output. The net guard
(G17.16) is stood down in the handlers below: the demo's subject is the
robots gate, and the guard refuses the loopback fixture host by design
(the guard's own demo is docs/demos/2026-09-29-g1716-netguard.md).

```sh
node --input-type=module -e '
import fs from "node:fs";
import http from "node:http";
import { runCampaign, defaultHandlers } from "./tools/collector/runloop.mjs";
import { openStore, sha256Hex } from "./tools/collector/store.mjs";
import { parseCampaign } from "./tools/collector/campaign.mjs";
import { articlePage, campaignYaml, httpFetchPage, writeCampaignFile } from "./tools/collector/testkit.mjs";

async function serve(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const route = routes[req.url] ?? { status: 404, body: "not found" };
    res.writeHead(route.status ?? 200, { "content-type": "text/html; charset=utf-8" });
    res.end(route.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    mask: (text) => text.replaceAll(`127.0.0.1:${port}`, "127.0.0.1:<port>"),
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function crawl(server, seeds) {
  const dir = fs.mkdtempSync("kudy-demo-374-");
  const file = writeCampaignFile(dir, campaignYaml({ seeds, delay_s: "delay_s: [0.01, 0.02]" }));
  const parsed = parseCampaign(fs.readFileSync(file, "utf8"));
  const db = openStore(dir + "/db.sqlite");
  const run = await runCampaign(db, parsed.campaign, {
    sourcePath: file,
    contentHash: sha256Hex(fs.readFileSync(file, "utf8")),
    snapshotsRoot: dir + "/snapshots",
    handlers: defaultHandlers({ fetchPage: httpFetchPage, netGuard: async () => {} }),
  });
  return { run, db, dir };
}

const server = await serve({
  "/robots.txt": { body: "User-agent: *\nDisallow: /secret" },
  "/start": { body: articlePage("Start", [["/secret", "the forbidden page"], ["/open", "the allowed page"]]) },
  "/secret": { body: articlePage("Secret", []) },
  "/open": { body: articlePage("Open", []) },
});
const first = await crawl(server, "seeds:\n  - " + server.url("/start"));
console.log("== a robots-disallowed path is never fetched ==");
console.log(`steps done ${first.run.done}, failed ${first.run.failed}, stopped: ${first.run.stopped}`);
const records = first.db.prepare("SELECT url FROM raw_records ORDER BY url").all().map((r) => r.url.replace(/^.*:\d+/, ""));
console.log("collected:", records.join(" "));
const secret = first.db.prepare("SELECT status, detail FROM run_log WHERE ref LIKE ?").get("%/secret");
console.log("secret step:", secret.status, "|", secret.detail.split(" | ").pop());
const audit = fs.readFileSync(`${first.dir}/snapshots/${first.run.campaignId.slice(0, 12)}/fence-audit.jsonl`, "utf8");
console.log("audit:", server.mask(audit.trimEnd().split("\n").find((line) => line.includes("robots-denied"))));
await server.close();
fs.rmSync(first.dir, { recursive: true, force: true });

const blocked = await serve({
  "/robots.txt": { body: "User-agent: *\nDisallow: /" },
  "/one": { body: articlePage("One", []) },
  "/two": { body: articlePage("Two", []) },
});
const second = await crawl(blocked, `seeds:\n  - ${blocked.url("/one")}\n  - ${blocked.url("/two")}`);
console.log("== a campaign whose every seed is blocked stops with a reason ==");
console.log(`steps done ${second.run.done}, failed ${second.run.failed}`);
console.log("stopped:", second.run.stopped);
const seedError = second.db.prepare("SELECT error FROM run_log WHERE kind = ? ORDER BY ref").all("seed");
console.log("seed diagnostics:", seedError.map((r) => r.error.replace(/^robots\.txt of [^ ]+ disallows/, "robots.txt disallows")).join(" ;; "));
await blocked.close();
fs.rmSync(second.dir, { recursive: true, force: true });
'
```

```output
== a robots-disallowed path is never fetched ==
steps done 3, failed 0, stopped: null
collected: /open /start
secret step: done | skipped: robots.txt of 127.0.0.1 disallows /secret — not fetched
audit: {"url": "http://127.0.0.1:<port>/secret", "decision": "robots-denied", "fetched": false, "reason": "robots.txt of 127.0.0.1 disallows /secret"}
== a campaign whose every seed is blocked stops with a reason ==
steps done 0, failed 2
stopped: all 2 http(s) seed(s) refused by robots.txt — run stopped, nothing collected
seed diagnostics: robots.txt disallows /one — seed not fetched ;; robots.txt disallows /two — seed not fetched
```
