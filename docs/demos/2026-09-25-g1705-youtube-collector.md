# G17.05 — YouTube collector: transcripts through yt-dlp

*Showboat demo for issue #160 (`tools/collector`), created 2026-09-25.*

<!-- showboat-id: g1705-youtube-collector -->

The YouTube collector turns campaign video ids into timecode-anchored
transcripts, complete metadata and a slug-named cover; subtitle-less videos
land in the asr-backlog and the run continues. Live YouTube fetches are
manual (no network here): the demo drives the production run loop with the
yt-dlp binary behind its `command` boundary replaced by a stub that emits
bundled fixtures — the spawn, the JSON parsing and the VTT handling are the
real production code paths. The cover image is served by a local fixture
server on port 8081.

Setup: fixtures, campaign (one subtitled video + one subtitle-less), the
stub command, the cover server, then the production `runCampaign`:

```sh
kill $(cat /tmp/kudy-g1705-demo/server.pid 2>/dev/null) 2>/dev/null; rm -rf /tmp/kudy-g1705-demo && mkdir -p /tmp/kudy-g1705-demo && node -e '
const fs = require("node:fs");
const dir = "/tmp/kudy-g1705-demo";
const vtt = [
  "WEBVTT", "",
  "1", "00:00:01.000 --> 00:00:04.500", "Witajcie w Gdańsku.", "",
  "2", "00:00:05.000 --> 00:00:09.250", "Stocznia Gdańska zaczęła strajk w sierpniu 1980.", "",
  "3", "00:00:10.000 --> 00:00:14.000", "To początek Solidarności.", "",
].join("\n") + "\n";
const info = {
  id: "dQw4w9WgXcQ",
  title: "Gdansk shipyard — the August story",
  channel: "History of the Coast",
  upload_date: "20240815",
  duration: 217.4,
  language: "en",
  thumbnail: "http://127.0.0.1:8081/cover.jpg",
  subtitles: { en: [{ ext: "vtt" }] },
  automatic_captions: { en: [{ ext: "vtt" }] },
};
const playlist = {
  dQw4w9WgXcQ: { info, vtt: { en: vtt } },
  aQw4w9WgXcQ: { info: { ...info, id: "aQw4w9WgXcQ", subtitles: {}, automatic_captions: {} }, vtt: {} },
};
fs.writeFileSync(dir + "/yt-dlp-stub.mjs", "import fs from \u0027node:fs\u0027;\nconst args = process.argv.slice(2);\nconst playlist = " + JSON.stringify(playlist) + ";\nconst id = args.find((a) => a.includes(\u0027watch?v=\u0027)).split(\u0027watch?v=\u0027)[1];\nconst entry = playlist[id];\nif (!entry) { console.error(\u0027stub: no fixture for \u0027 + id); process.exit(1); }\nconst outIdx = args.indexOf(\u0027-o\u0027);\nif (outIdx === -1) { console.log(JSON.stringify(entry.info)); process.exit(0); }\nconst lang = args[args.indexOf(\u0027--sub-langs\u0027) + 1];\nconst vttText = entry.vtt[lang];\nif (!vttText) { console.error(\u0027stub: no vtt for \u0027 + id + \u0027/\u0027 + lang); process.exit(1); }\nfs.writeFileSync(args[outIdx + 1] + \u0027.\u0027 + lang + \u0027.vtt\u0027, vttText);\n");
fs.writeFileSync(dir + "/seed.html", "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <title>Seed page</title>\n</head>\n<body>\n  <p>First filler paragraph with plain text.</p>\n  <p>Second filler paragraph with plain text.</p>\n  <p>Third filler paragraph with plain text.</p>\n</body>\n</html>\n");
fs.writeFileSync(dir + "/campaign.yaml", [
  "city: gdansk",
  "seeds:",
  "  - file:///tmp/kudy-g1705-demo/seed.html",
  "topics: [history]",
  "fence:",
  "  depth: 3",
  "  extra_domains: []",
  "  delay_s: [2, 5]",
  "youtube:",
  "  - dQw4w9WgXcQ",
  "  - aQw4w9WgXcQ",
].join("\n") + "\n");
console.log("fixtures ready");
' && ( node -e '
const fs = require("node:fs");
const http = require("node:http");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "image/jpeg" });
  res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd8, 0xff, 0xd9]));
});
server.listen(8081, "127.0.0.1", () => {
  fs.writeFileSync("/tmp/kudy-g1705-demo/server.pid", String(process.pid));
  console.log("serving cover on 8081");
});
' > /tmp/kudy-g1705-demo/server.log 2>&1 < /dev/null & ) ; node --input-type=module -e '
import { pathToFileURL } from "node:url";
const repo = process.cwd();
const mod = async (p) => await import(pathToFileURL(repo + "/" + p).href);
const { runCampaign, defaultHandlers } = await mod("tools/collector/runloop.mjs");
const { createYoutubeFetch } = await mod("tools/collector/youtube.mjs");
const { parseCampaign } = await mod("tools/collector/campaign.mjs");
const { openStore } = await mod("tools/collector/store.mjs");
const fs = await import("node:fs");
const dir = "/tmp/kudy-g1705-demo";
const source = fs.readFileSync(dir + "/campaign.yaml", "utf8");
const parsed = parseCampaign(source);
const db = openStore(dir + "/db.sqlite");
const handlers = defaultHandlers({
  youtubeFetch: createYoutubeFetch({ command: [process.execPath, dir + "/yt-dlp-stub.mjs"] }),
});
const run = await runCampaign(db, parsed.campaign, {
  sourcePath: dir + "/campaign.yaml",
  contentHash: (await import("node:crypto")).createHash("sha256").update(source).digest("hex"),
  snapshotsRoot: dir + "/snapshots",
  handlers,
});
console.log(`campaign run: steps done ${run.done}, failed ${run.failed}`);
const rows = db.prepare("SELECT url, rights, snapshot_path, content_hash FROM raw_records WHERE source_type = \u0027youtube\u0027 ORDER BY url").all();
for (const row of rows) {
  console.log(`${row.url} | ${row.rights} | snapshot ${row.snapshot_path ? "written" : "none"} | hash ${row.content_hash ? "filled" : "empty"}`);
}
const filled = rows.find((row) => row.snapshot_path);
console.log("--- files ---");
console.log(fs.readdirSync(filled.snapshot_path).sort().join("\n"));
console.log(fs.readdirSync(filled.snapshot_path + "/media").join("\n"));
console.log("--- transcript.md ---");
console.log(fs.readFileSync(filled.snapshot_path + "/transcript.md", "utf8").trimEnd());
const metadata = JSON.parse(fs.readFileSync(filled.snapshot_path + "/metadata.json", "utf8"));
console.log("--- metadata ---");
for (const key of ["title", "channel", "upload_date", "duration_s", "language", "subtitle_kind", "subtitle_language", "cover"]) {
  console.log(`${key}: ${metadata[key]}`);
}
const backlog = fs.readFileSync(dir + "/snapshots/" + run.campaignId.slice(0, 12) + "/asr-backlog.jsonl", "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
console.log("--- asr-backlog ---");
for (const entry of backlog) {
  console.log(`${entry.video_id} | ${entry.reason}`);
}
const steps = db.prepare("SELECT ref, status FROM run_log WHERE kind = \u0027youtube\u0027 ORDER BY ref").all();
for (const step of steps) {
  console.log(`step ${step.ref.slice(0, 11)}: ${step.status}`);
}
'
```

```output
fixtures ready
campaign run: steps done 3, failed 0
https://www.youtube.com/watch?v=aQw4w9WgXcQ | research_only | snapshot none | hash empty
https://www.youtube.com/watch?v=dQw4w9WgXcQ | research_only | snapshot written | hash filled
--- files ---
media
metadata.json
subtitles.vtt
transcript.md
gdansk-shipyard-the-august-story-cover.jpg
--- transcript.md ---
[00:00:01] Witajcie w Gdańsku.

[00:00:05] Stocznia Gdańska zaczęła strajk w sierpniu 1980.

[00:00:10] To początek Solidarności.
--- metadata ---
title: Gdansk shipyard — the August story
channel: History of the Coast
upload_date: 2024-08-15
duration_s: 217
language: en
subtitle_kind: manual
subtitle_language: en
cover: media/gdansk-shipyard-the-august-story-cover.jpg
--- asr-backlog ---
aQw4w9WgXcQ | no subtitles available
step aQw4w9WgXcQ: done
step dQw4w9WgXcQ: done
```

The fixture server is stopped by the pid it recorded at startup:

```sh
kill $(cat /tmp/kudy-g1705-demo/server.pid) && echo "fixture server stopped"
```

```output
fixture server stopped
```

The full collector suite (includes the YouTube AC1–AC5 suites):

```sh
node --test "tools/collector/*.test.mjs" 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 91
ℹ pass 91
ℹ fail 0
```
