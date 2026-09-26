# Issue #316 — checklist severity of the audio verification instrument

*Showboat demo for issue #316 (`tools/validate/verify-audio`), created 2026-09-26.*

<!-- showboat-id: issue-316-verify-audio-checklist -->

The summary checklist must not outstate its diagnostics (issue #316). Two
defects, one fix in `machineRow`: the fired set now includes the `infos`
array, so the informational duration-guideline row reaches its pass-with-note
outcome (the branch used to be dead — the note could never appear), and a
warning row shows `warn`, not `fail`, while `ok` stays true.

The committed fixture holds 2 s and 3 s recordings, both outside the 60–120 s
guideline of 13 §3, so the informational row must carry its note:

```sh
node tools/validate/verify-audio.mjs --in fixtures/content/audio-verify | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  const row = r.checklist.find((c) => c.item === "duration inside the 60–120 s guideline");
  console.log("ok:", r.ok);
  console.log("outcome:", row.outcome);
  console.log("note:", row.note);
})'
```

```output
ok: true
outcome: pass
note: outside the 60–120 s guideline; recorded, non-blocking (09 §3 invariant 7)
```

A warning never becomes a fail: a transcript with an ad call (13 §3) is laid
over the committed fixture bytes in a temp package, and its checklist row
shows `warn` while the report stays non-blocking:

```sh
T=$(mktemp -d) && mkdir -p "$T/be/base/audio" && cp fixtures/content/audio-verify/be/base/stops.json "$T/be/base/" && cp fixtures/content/audio-verify/be/base/audio/*.m4a "$T/be/base/audio/" && node -e '
const fs = require("fs");
const p = process.argv[1] + "/be/base/stops.json";
const stories = JSON.parse(fs.readFileSync(p, "utf8"));
stories[0].transcript = "Хочаце больш? Купіць пашырэнне можна ў дадатку.";
fs.writeFileSync(p, JSON.stringify(stories, null, 2));' "$T" && node tools/validate/verify-audio.mjs --in "$T" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  const row = r.checklist.find((c) => c.item === "no ad call to buy the extension in the narration");
  console.log("ok:", r.ok);
  console.log("outcome:", row.outcome);
})'; rc=$?; rm -rf "$T"; exit $rc
```

```output
ok: true
outcome: warn
```
