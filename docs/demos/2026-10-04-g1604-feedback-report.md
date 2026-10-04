# #75 — feedback report, retention and saved exports: the author's read path

*Showboat demo for issue #75 (G16.04, `tools/feedback-report` + the
`supabase/queries/` report and retention files), created 2026-10-04.*

21 §6 promises the author a report built only from current non-deleted
ratings, one row per full target key (guide/place, version, locale — never
merged), with an edit collapsing into the one vote it already contributed
and a deletion removing the next report's contribution; the saved export
carries its computation time and data period and holds no device or
mutation identity; retention keeps rows at most 14 months and a queued
submission replayed after the sweep cannot revive them.

Block 1 drives the production edge-wire path over real Postgres (PGlite)
through `tests/feedback/report-demo.ts`: three devices rate two targets,
the committed `supabase/queries/feedback-report.sql` aggregates them, the
first device's edit replaces its vote in place, the sweep removes the
aged guide row and the aged edit replay meets `409 revision_conflict`
while a genuine new rating is still accepted. Timestamps are wall-clock
and stay out of the trace.

Report, edit, sweep, replay:

```sh
LD_LIBRARY_PATH=$HOME/.local/lib node --experimental-strip-types tests/feedback/report-demo.ts 2>/dev/null
```

```output
report     : 2 keys
  guide:guide-route-a1@1/be count=2 mean=4.50 hist=0/0/0/1/1 reasons={"interesting_stories":1}
  place:place-a1@1/be count=1 mean=3.00 hist=0/0/1/0/0 reasons={"worth_visiting":1}
after edit : status=200 guide:guide-route-a1@1/be count=2 mean=3.50 hist=0/0/1/1/0 reasons={"clear_delivery":1}
after sweep: 1 keys (place-a1)
replay edit: status=409 error=revision_conflict
new rating : status=200 keys after=2
```

Reading the trace: two keys stay two rows — guide and place never merge;
the edit keeps `count=2` and moves the mean from 4.50 to 3.50 with the
reasons replaced (`clear_delivery` instead of `interesting_stories`) — one
vote updated, not a second vote added. After the guide's rows expire past
14 months the sweep leaves only the fresh place key; the device's queued
edit replayed against the removed row answers `409 revision_conflict` and
creates nothing, and a genuine `expected_revision 0` rating is accepted
(`keys after=2`).

Block 2 is the operational CLI flow from `docs/runbooks/feedback.md` §1:
a synthetic `psql --csv` export becomes a saved private report with its
computation time and period, listed, inspected, then removed — the file
lands in a temp dir (the runbook's real target `.scratch/feedback-reports/`
is git-ignored) and the `--computed-at` pin keeps the name deterministic.
The export carries only the aggregate allowlist — no device, mutation or
secret field exists in the document.

CSV in → saved export → listed → removed:

```sh
tmp=$(mktemp -d)
cat > "$tmp/raw.csv" <<'CSV'
target_kind,target_id,target_version,locale,rating_count,mean_score,hist_1,hist_2,hist_3,hist_4,hist_5,first_rated_at,last_rated_at,reason_counts
guide,guide-route-a1,1,be,3,4.33,0,0,1,0,2,2026-09-01T10:00:00Z,2026-09-20T10:00:00Z,"{""clear_delivery"": 2}"
place,place-a1,1,en,1,5.00,0,0,0,0,1,2026-09-02T10:00:00Z,2026-09-02T10:00:00Z,{}
CSV
node tools/feedback-report/cli.mjs --from-csv "$tmp/raw.csv" --out-dir "$tmp/exports" --computed-at 2026-10-04T19:00:00.000Z
node tools/feedback-report/cli.mjs --list-saved --out-dir "$tmp/exports"
cat "$tmp/exports/"*.json
node tools/feedback-report/cli.mjs --remove-saved --all --out-dir "$tmp/exports"
rm -rf "$tmp"
```

```output
saved: feedback-report-2026-10-04T19-00-00.000Z.json
aggregates: 2
feedback-report-2026-10-04T19-00-00.000Z.json	computed 2026-10-04T19:00:00.000Z	period 2026-09-01T10:00:00.000Z .. 2026-09-20T10:00:00.000Z	2 aggregates
{
  "schema_version": 1,
  "kind": "feedback-report",
  "computed_at": "2026-10-04T19:00:00.000Z",
  "period": {
    "from": "2026-09-01T10:00:00.000Z",
    "to": "2026-09-20T10:00:00.000Z"
  },
  "aggregates": [
    {
      "target_kind": "guide",
      "target_id": "guide-route-a1",
      "target_version": "1",
      "locale": "be",
      "rating_count": 3,
      "mean_score": 4.33,
      "hist_1": 0,
      "hist_2": 0,
      "hist_3": 1,
      "hist_4": 0,
      "hist_5": 2,
      "first_rated_at": "2026-09-01T10:00:00Z",
      "last_rated_at": "2026-09-20T10:00:00Z",
      "reason_counts": {
        "clear_delivery": 2
      }
    },
    {
      "target_kind": "place",
      "target_id": "place-a1",
      "target_version": "1",
      "locale": "en",
      "rating_count": 1,
      "mean_score": 5,
      "hist_1": 0,
      "hist_2": 0,
      "hist_3": 0,
      "hist_4": 0,
      "hist_5": 1,
      "first_rated_at": "2026-09-02T10:00:00Z",
      "last_rated_at": "2026-09-02T10:00:00Z",
      "reason_counts": {}
    }
  ]
}
removed: feedback-report-2026-10-04T19-00-00.000Z.json
```

The full acceptance suites are `tests/feedback/report-query.test.ts`
(aggregation, guards, RLS denial) and `tests/feedback/report-retention.test.ts`
(window sweep, idempotency, the queued-edit replay), plus the CLI suites in
`tools/feedback-report/`.
