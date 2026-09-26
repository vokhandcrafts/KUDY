# G03.03 — the audio verification instrument

*Showboat demo for issue #300 (`tools/validate/verify-audio`), created 2026-09-26.*

<!-- showboat-id: g0303-audio-verification -->

The instrument complements `validate-package` (which owns the structural media
rules) by measuring the recorded bytes themselves: ffprobe gives the container
duration, ffmpeg ebur128 the integrated loudness (09 §6 `audio` row: narration is
normalized to the −16 LUFS target, this instrument judges ±2 LU around it),
sha256 catches one recording bound to two stories, and the transcripts feed
the 13 §2/§3 checklist (no ad call, no narration that requires the previous
file, memorial tone proxy). Rows that only the author can decide are reported
as `human`, never machine verdicts.

The committed fixture package `fixtures/content/audio-verify` holds two real
recordings normalized once via `loudnorm I=-16` and pinned by
`fixtures/content/** -text`, so the measured values reproduce on any checkout:

```sh
node tools/validate/verify-audio.mjs --in fixtures/content/audio-verify | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  console.log("ok:", r.ok);
  console.log("errors:", r.errors.length, "warnings:", r.warnings.length, "infos:", r.infos.map((i) => i.rule).join(","));
  for (const m of r.measurements) console.log(m.file, "duration=" + m.duration_measured_s, "loudness=" + m.loudness_lufs, "tempo=" + m.tempo_chars_per_s);
  console.log("human checklist rows:", r.checklist.filter((c) => c.kind === "human").length);
})'
```

```output
ok: true
errors: 0 warnings: 0 infos: duration-guideline,duration-guideline
be/base/audio/story-1-base.m4a duration=2 loudness=-16.1 tempo=28.5
be/base/audio/story-2-base.m4a duration=3 loudness=-16 tempo=20
human checklist rows: 3
```

The two short fixtures sit below the 60–120 s guideline of 13 §3 — recorded
as `duration-guideline` infos, never blocking (09 §3 invariant 7).

The author template still carries its placeholder audio bytes (not a
recording), and the instrument says so honestly instead of passing a
non-recording through — this is the state an author sees before recording:

```sh
node tools/validate/verify-audio.mjs --in content/author-template | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const r = JSON.parse(s);
  console.log("ok:", r.ok);
  for (const e of r.errors) console.log("error:", e.rule, e.path);
})'
```

```output
ok: false
error: audio-unreadable be/base/audio/story-1-base.m4a
```

The acceptance suite isolates every diagnostic on its own fixture
(implementation-rules 14), including the fail-closed behaviour when
ffprobe/ffmpeg are missing:

```sh
node --test tools/validate/verify-audio.test.mjs 2>/dev/null | grep -E "^ℹ (tests|pass|fail)"
```

```output
ℹ tests 16
ℹ pass 16
ℹ fail 0
```
