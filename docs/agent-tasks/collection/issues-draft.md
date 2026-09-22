# Issue drafts — G17 web collection (published 2026-09-21)

Record of what was published to GitHub. The brief files in this folder are the canonical, fuller versions; the bodies below copy their acceptance criteria. If bodies on GitHub change later, this file stays the record of the original publication. Spec: `docs/24_web_collection.md` (lands via the spec PR — referenced in each body until merge).

Labels: none set by the publisher — `epic`, `agent:ready`, `prio:*` belong to the operator.

---

## Epic — "G17 epic — Web collection: sources → raw library → cleaned Source for 07"

## Epic

Parent epic of the G17 web-collection tasks (the web audio channel epic is #108). The `epic` label is set by the operator.

## Goal

An internal, local tool that turns author-chosen web sources (news portals, wikis, YouTube) into a raw library with passports and rights, then cleans it into `Source` records for the content pipeline `07`. Nothing publishes; guides are assembled by the author by hand.

Specification: `docs/24_web_collection.md` (draft — lands via PR #152). Pipeline: `docs/07_content_pipeline.md`.

## Tasks

| Task | Outcome | Blocked-by |
|---|---|---|
| G17.01.a | Collector scaffold: campaign schema, storage schema, run loop | — |
| G17.01.b | Raw snapshot, passport, dedup, resume | G17.01.a |
| G17.02 | Web crawler with a fence (Playwright) | G17.01.b |
| G17.03 | Media: photos paired with text | G17.01.b |
| G17.04 | Wiki collector (MediaWiki API) | G17.01.b |
| G17.05 | YouTube collector (yt-dlp transcripts) | G17.01.b |
| G17.06 | Cleaning rules engine v1 | G17.02, G17.04, G17.05 |
| G17.07 | Search, basket, draft export | G17.06 |
| G17.08 | Pilot campaign: Gdansk | G17.06 + founder-decisions tracking issue |

## Notes for the dispatcher

Tasks stay in backlog until the operator adds labels. G17.08 additionally waits for the founder-decisions tracking issue (pilot portal, photo sources). Briefs: `docs/agent-tasks/collection/`.

---

## Task — "G17.01.a Collector scaffold: campaign schema, storage schema, run loop"

## Epic

Epic: #154.

## Goal

`tools/collector/` exists with a runnable CLI skeleton (`init`, `run --campaign <file>`, `status`): campaign YAML validated by Zod, SQLite schema created on first run, run loop idempotent and resumable. Full brief: `docs/agent-tasks/collection/G17.01.a.md`.

## Acceptance criteria

1. [ ] A campaign YAML missing `city` or with invalid `fence` values is rejected with a diagnostic naming the offending field — negative test fails if the validation is reverted.
2. [ ] First `run` creates the full schema; running the same campaign twice inserts no duplicate `raw_records`/`campaigns` rows (idempotency test).
3. [ ] An interrupted run (second invocation in a test) resumes without duplicating records (rule: resume, not restart).
4. [ ] Every passport field from the spec table (`24`, «Пашпарт запісу») exists in `raw_records` with the exact spec name — schema test compares against the documented list.
5. [ ] The package's test suites are enumerated by the default `npm test` and pass locally; the jscpd gate is clean.

## Out of scope

Any network fetching; snapshot writing, cleaning, photo logic; changes to `docs/07` or product code.

## Dependencies

None — first G17 task.

## Proof

Revert the Zod fence validation → criterion 1's negative test fails.

```
npm test
```

---

## Task — "G17.01.b Raw snapshot, passport, dedup, resume"

## Epic

Epic: #154.

## Goal

Given a fetched page (fixture HTML — no network), write the raw snapshot per article (snapshot.html, text.md with anchors, metadata.json, media/ dir) and register the `raw_records` passport; dedup by canonical URL and by content hash. Full brief: `docs/agent-tasks/collection/G17.01.b.md`.

## Acceptance criteria

1. [ ] Fixture page → snapshot files exist; every anchor in `text.md` keeps its target URL.
2. [ ] Same fixture twice → one `raw_records` row; same text under a different URL → second row with equal `content_hash` linked to the first.
3. [ ] A corrupt fixture (empty HTML, missing title) produces a diagnostic in the run log and no crash (corrupt-input rule).
4. [ ] `content_hash` verified against the file re-read from disk (no silent EOL conversion).
5. [ ] Suites wired into default `npm test`; jscpd gate clean.

## Out of scope

Fetching pages (later collectors); photo download (empty `media/` dir only); cleaning; search.

## Dependencies

`Blocked-by: #155` — G17.01.a.

## Proof

Revert the `content_hash` dedup check → criterion 2's test fails.

```
npm test
```

---

## Task — "G17.02 Web crawler with a fence (Playwright)"

## Epic

Epic: #154.

## Goal

A crawler that walks campaign seeds inside the fence (same-domain + extra_domains, depth ≤ 3, article heuristic, politeness delays, stop on error series) and hands every fetched article to the G17.01.b snapshot writer. Tests run local fixture servers only. Full brief: `docs/agent-tasks/collection/G17.02.md`.

## Acceptance criteria

1. [ ] Fence audit log shows 0 fetches outside allowed hosts — fails if the domain check is reverted.
2. [ ] A page 4 hops from the seed is not fetched.
3. [ ] Nav-only fixture marked `skipped`; article fixture snapshotted.
4. [ ] N consecutive failures stop the run with a diagnostic; queue state allows resume.
5. [ ] Two consecutive requests to one host differ by at least the configured minimum delay.
6. [ ] Every fetched article produces a `raw_records` row through the G17.01.b path (end-to-end, no test shortcut).

## Out of scope

Photos (G17.03), wiki/YouTube sources (G17.04/05), cleaning (G17.06).

## Dependencies

`Blocked-by: #156` — G17.01.b.

## Proof

Revert the same-domain check → criterion 1's audit-log assertion fails.

```
npm test
```

---

## Task — "G17.03 Media: photos paired with text"

## Epic

Epic: #154.

## Goal

From raw snapshots, extract content images (≥ ~150 px), store them per-article as `<article-slug>-img-NN.<ext>`, register them in the `media` table, and place each at its original position in `text.md` with alt and caption. Full brief: `docs/agent-tasks/collection/G17.03.md`.

## Acceptance criteria

1. [ ] Only ≥150 px images saved; sub-150 px icons excluded — negative test names the size rule.
2. [ ] Every saved image has a complete `media` row and a slug filename; re-run keeps numbering stable.
3. [ ] The markdown image sits at the paragraph index where it appeared in the source.
4. [ ] Same image on two articles → equal hashes on both rows.
5. [ ] Broken image URL → diagnostic row, no crash; suites wired into `npm test`; jscpd clean.

## Out of scope

Cleaning-stage normalization (G17.06), YouTube thumbnails (G17.05), image processing beyond download+hash.

## Dependencies

`Blocked-by: #156` — G17.01.b.

## Proof

Revert the size filter → criterion 1's negative test fails.

```
npm test
```

---

## Task — "G17.04 Wiki collector (MediaWiki API)"

## Epic

Epic: #154.

## Goal

Fetch campaign articles/categories through the MediaWiki API, expand wiki links within topic/depth limits, store `raw_records` (`source_type=wiki`, `rights=licensed`) with attribution metadata. Fixtures only in tests. Full brief: `docs/agent-tasks/collection/G17.04.md`.

## Acceptance criteria

1. [ ] Fixture API responses produce `raw_records` with `source_type=wiki` and complete attribution metadata (each field asserted).
2. [ ] Category expansion respects the topic filter and depth — negative test names the filter.
3. [ ] `rights=licensed` set automatically for wiki sources — reverting the mapping fails the test.
4. [ ] Missing title → logged diagnostic, run completes; suites wired into `npm test`; jscpd clean.

## Out of scope

Non-MediaWiki encyclopedias; cleaning; photos.

## Dependencies

`Blocked-by: #156` — G17.01.b.

## Proof

Revert the wiki→licensed rights mapping → criterion 3's test fails.

```
npm test
```

---

## Task — "G17.05 YouTube collector (yt-dlp transcripts)"

## Epic

Epic: #154.

## Goal

Fetch subtitles with `yt-dlp` (manual > automatic), store the transcript split into paragraphs with timecodes, video metadata, thumbnail as cover; subtitle-less videos land in `asr-backlog`. Tests use bundled VTT fixtures — no network. Full brief: `docs/agent-tasks/collection/G17.05.md`.

## Acceptance criteria

1. [ ] VTT fixture → paragraphs each anchored to a timecode; paragraph count and first/last timecodes asserted.
2. [ ] Fixture with both manual and automatic subtitles → manual stored and kind recorded.
3. [ ] Metadata row complete; thumbnail named per the slug rule.
4. [ ] Video id without subtitles → `asr-backlog` entry, run continues with a diagnostic.
5. [ ] Missing yt-dlp binary → explicit diagnostic at startup, no partial records; suites wired into `npm test`; jscpd clean.

## Out of scope

Punctuation restoration of auto-captions (G17.06), speech recognition, audio download.

## Dependencies

`Blocked-by: #156` — G17.01.b.

## Proof

Revert the manual-over-automatic preference → criterion 2's test fails.

```
npm test
```

---

## Task — "G17.06 Cleaning rules engine v1"

## Epic

Epic: #154.

## Goal

A data-driven cleaning engine with versioned rule packages per source type (`news-v1`, `wiki-v1`, `youtube-v1`): main-content extraction, strip nav/ads, anchor + photo normalization, date/language; cleaned output as a new version (raw never rewritten); author review export bundle. No LLM in v1. Full brief: `docs/agent-tasks/collection/G17.06.md`.

## Acceptance criteria

1. [ ] Per type, a raw fixture cleans with no nav/ad/"read also" markers and with every content paragraph present (no content loss).
2. [ ] Raw bytes on disk identical before and after cleaning.
3. [ ] Changed rules + re-run produce version 2; both versions retained; run log names the package version.
4. [ ] Anchors keep anchor+URL form; photos stay at their positions with captions.
5. [ ] Review export bundle generated with visible citations; suites wired into `npm test`; jscpd clean.

## Out of scope

LLM passes; search/basket (G17.07); changes to `07` stages.

## Dependencies

`Blocked-by: #157, #159, #160` — G17.02, G17.04, G17.05.

## Proof

Revert the "new version" write path (overwrite raw) → criterion 2's byte-identity test fails.

```
npm test
```

---

## Task — "G17.07 Search, basket, draft export"

## Epic

Epic: #154.

## Goal

CLI search (city/topic/type + full text), basket of fragments, markdown draft export with citation lines (URL + collected_at); exported records move `status: cleaned → used` and keep `raw_record_id` for `07`. Full brief: `docs/agent-tasks/collection/G17.07.md`.

## Acceptance criteria

1. [ ] Search hits expected records under city/topic/type filters; full text finds a record by a phrase from its cleaned text.
2. [ ] Export produces a markdown draft where each fragment carries its citation line (URL + date).
3. [ ] Exported records have `status=used`; repeat export does not duplicate fragments.
4. [ ] Empty basket → diagnostic, no empty file; suites wired into `npm test`; jscpd clean.

## Out of scope

Guide auto-composition (rejected by the spec), changes to `07`, app code.

## Dependencies

`Blocked-by: #161` — G17.06.

## Proof

Revert the citation-line writer → criterion 2's test fails.

```
npm test
```

---

## Task — "G17.08 Pilot campaign: Gdansk"

## Epic

Epic: #154.

## Goal

One complete campaign on real sources (chosen portal + Wikipedia set + 5–10 manual-subtitle YouTube videos) run locally end-to-end, every acceptance criterion of spec `24` «Пілот» evidenced, post-pilot questions answered. Full brief: `docs/agent-tasks/collection/G17.08.md`.

## Acceptance criteria

1. [ ] Spec `24` «Пілот» criteria 1–7: each verified in `docs/agent-tasks/results/G17.08.md` with command/log/path evidence — an unticked criterion is a finding (implementation rule 17).
2. [ ] Results file names the tool and rule-package versions actually used.
3. [ ] Results file answers: second news family readiness; ASR need (`asr-backlog` size); final handoff format to `07`.

## Out of scope

Publishing anything, a second city, ASR, changes to `07` or the app.

## Dependencies

`Blocked-by: #157, #159, #160, #161` — G17.02, G17.04, G17.05, G17.06, and the founder-decisions tracking issue (#153).

## Proof

The fence audit log of the pilot run shows 0 fetches outside allowed hosts.

```
grep -c '"decision": "denied", "fetched": true' <pilot-run>/fence-audit.jsonl   # prints 0
```

---

## Tracking — "Founder decisions: approve spec 24 and pick the pilot news portal"

## Epic

Standalone tracking issue; unblocks G17.08.

## Goal

Spec `docs/24_web_collection.md` is a draft. The founder reviews it and answers the open questions so the pilot can start.

## Acceptance criteria

1. [ ] Spec 24 approved or amended (draft banner in `docs/readme.md` removed).
2. [ ] Pilot news portal chosen (recorded here or in the campaign file).
3. [ ] Decision: are subtitle-less videos important soon (`asr-backlog` priority yes/no).
4. [ ] Decision: topic dictionary — shared across cities or per city.
5. [ ] Decision: guide photos — own + free (Wikipedia) only, or negotiated sources (museums, archives).

## Out of scope

No code changes.

## Dependencies

Unblocks G17.08.

## Proof

Not applicable (decision issue).
