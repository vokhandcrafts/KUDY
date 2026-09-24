# Lessons learned — the closed-PR review corpus (2026-09-19)

This file is the evidence base for the repo's two normative rule files. It records what
actually recurred in code review, how often, and why, so the rules are not folklore.

- **Writing code:** the mandatory prevention rules live in `implementation-rules.md`
  (rules 1–2, 7, 12 refreshed from this corpus; rules 13–17 added from it). Read that
  file before implementing — this file explains the failures behind those rules.
- **Reviewing a diff:** the detection checks live in `code-review.md` §4 ("Recurring
  corpus classes"). This file carries the counts and the real occurrences behind them.

## How the corpus was built

- All 52 closed PRs (#2–#120, 51 merged — #90 was closed unmerged; 2026-09-07 … 2026-09-19).
- 566 review comments fetched (Cursor 381, CodeRabbit 129, operator 54, dispatcher 2).
- 369 distinct findings extracted, then clustered **by defect logic**: the same
  underlying mistake is one pattern regardless of wording or file. A finding re-flagged
  in a later review round of the same PR counts as a new instance; a comment verifying
  an earlier fix does not. Workflow boilerplate (claim/handback, CI status, bot
  summaries) is excluded.
- Counts are instances; the "PRs" column is distinct PRs. Borderline merges are
  documented per lesson so the number can be recomputed under a stricter definition.

## The ranked patterns

| # | Defect logic (one line) | Inst. | PRs | Prevention |
|---|-------------------------|------:|----:|------------|
| 1 | A derived artifact restates the accepted contract differently (dropped fields/qualifiers, invented literals, wrong owner or flow, merged states, fixture vs registry) | 95 | 18 | rules 2, 13 |
| 2 | Docs and PR bodies hand-type counts, statuses or evidence claims that no longer match the artifact they describe | 57 | 25 | rule 13 |
| 3 | Invalid or edge-case input crashes a validator/service or is misdiagnosed; contract rules never enforced; unsafe path building | 34 | 8 | rule 14 |
| 4 | Documented rules and recent fixes have no test that fails on their removal | 30 | 8 | rules 1, 14 |
| 5 | Relative links and section citations resolve to nothing or to the wrong anchor | 24 | 11 | rule 16 |
| 6 | Belarusian prose: russisms, Latin/Cyrillic homoglyphs, «ў/у» convention misses | 24 | 11 | rule 12 |
| 7 | Tests give false confidence: helpers pre-process so probes bypass the production path; live suite weaker than mock; contracted fields unasserted | 19 | 2 | rule 15 |
| 8 | Deliverable incomplete or ambiguous against the task contract (omitted matrix rows / atomic steps) | 17 | 3 | rule 17 |
| 9 | The deliverable exists but nothing wires it into the runner/CI — a revert stays green | 11 | 6 | rule 7 |
| 10 | Smaller recurring classes (§10) | 31 | 13 | various |

Class sums: rows 1–9 = 311 instances, row 10 = 31 → 342 clustered instances; the
remaining 27 findings were one-offs with no recurring logic and are not listed (311 +
31 + 27 = 369). Sums carry a ±2 uncertainty from borderline instances that could sit in
either of two adjacent classes at extraction time.

## 1. Contract restatement drift — 95 instances / 18 PRs

Every artifact that repeats the contract in its own words eventually contradicts it.

- PR #91 (22 findings): diagrams routed location events past the controller and
  pipeline; the interface catalogue omitted `focus_lost_at`, `play_seq`,
  `ActivationResult`; a walkthrough invented the `hash_mismatch` literal; the doc
  claimed verbatim names while silently switching camelCase↔snake_case.
- PR #43 (13 findings, re-flagged across three rounds): stop-level status wording
  ("available", "heard" keyed by stop) survived the story-keyed derived-status refactor
  and kept contradicting the accepted model.
- PR #42 (17 findings): fixtures contradicted the registry — success cases against an
  unpublished locale, targets missing documented entries, fields the contract never
  defined.
- PR #107 (10 findings): backlog and issue drafts gated G10 parts on blockers the plan
  scopes to launch only.
- PR #47: code merged the states the contract distinguishes (internal fault and
  provider outage both became `500 entitlement_unavailable` instead of `503` +
  `Retry-After`).

Why it keeps happening: restatements are written from memory of the canon, second-order
docs paraphrase earlier paraphrases, and nothing re-opens the canonical line at push
time. Under the strictest definition (docs and diagrams only) this class is 75; adding
fixtures makes 92; adding code-level merges makes 95 — every counting convention puts
it first.

**Lesson:** restating a contract is a copy operation. Copy the names and signatures
verbatim, anchor the source, mark proposals as proposals — or link instead of
restating. A "verbatim" claim is a testable claim, and tests fail.

## 2. Stale facts, counts and statuses in docs and PR bodies — 57 / 25 PRs

Half the repo's PRs shipped a hand-typed number or status that was already wrong.

- PR #120: Checks line "218/218" while the delta made it 221; PR body repeated it.
- PR #116: results doc claimed a green suite against actual 150/1; one doc said 24 tests,
  the file had 23, HEAD had 29.
- PR #118: results doc said 6 tests after the guard test made it 7.
- PR #98: link-check table claimed "36 resolved" while the embedded output said 18.
- PR #101: "728 packages" vs ~723 on a clean `npm ci`; re-flagged as 733 vs 734.
- PR #45: "12 mutations" while `check-regressions.mjs` defined 16; PR #47: "15/15"
  against 20/20; PR #46: "seven passing tests" vs 8.

Why it keeps happening: the number is written mid-PR and never re-synced after the next
commit; statuses are copied from memory of the board instead of re-read at push time.

**Lesson:** a count typed into prose is a pin to a moving artifact. Regenerate every
count and status against final HEAD in the same session that pushes — run the suite
last, paste or quote its output — or don't type the number at all.

## 3. Invalid and edge-case input mishandled — 34 / 8 PRs

Validators written against happy-path fixtures; semantics implemented from intuition.

- PR #114: the shared JSON-Schema reader mis-implemented Draft-07 (`type:number`
  rejected integers; `if/then` branches without `type:object` skipped `required`);
  `format: date-time` declared but never validated; namespace checks targeted the wrong
  key set and skipped locale-nested media ids.
- PR #116: null array elements crashed the validator instead of producing diagnostics;
  missing identity fields produced `duplicate-id#undefined`; several implemented and
  documented rules had zero regression tests.
- PR #120: `story_id` interpolated into a store path without separator checks;
  `route.json` without required stops silently defaulted to `[]`; the unsafe-path guard
  covered only the media pass.
- PR #105: corrupt tier JSON threw an uncaught `SyntaxError`, breaking the error
  contract; `isPathSafe` accepted empty segments.
- PR #41/#45: truthiness used where presence was meant; length comparison where
  membership was meant.

Why it keeps happening: negative fixtures are an afterthought, and each validator
re-implements schema semantics instead of sharing one reader.

**Lesson:** every rule is guilty until a negative test convicts it, and parsers owe
diagnostics, not stack traces. Corrupt input (null elements, missing fields, empty
strings, wrong types) is a normal test case, not an exotic one.

## 4. Documented rules without a failing-on-removal test — 30 / 8 PRs

- PR #85: nothing failed if the `.gitattributes` eol rule was removed.
- PR #86: the drain-limit reset path was documented but untested (re-flagged).
- PR #105: the 512 KiB index guard and two of three leak codes had no negative test;
  the positive `.map` assertion could not prove the build fails when `.map` is present.
- PR #118: the README↔seeded-error sync was guarded only by a comment.
- PR #120: the free+extended tier path was unpinned; the fixture covered paid only.
- PR #114: the "invalid fixtures" asserted only "something fails", not which rule.
- PR #42: negative fixtures violated two rules at once (e.g. private-path: kind and
  path together), so no validator could isolate either.
- PR #116: implemented and documented rules (detail-ref mismatch, tier mismatch, guide
  duration range) carried zero regression tests.

Why it keeps happening: the fix or rule lands and the test for it is assumed; teams
read "documented" as "protected".

**Lesson:** documented ≠ protected. If a line can be reverted without a red build, the
rule it carries does not exist yet.

## 5. Broken links and wrong citations — 24 / 11 PRs

- PR #96: three findings citing `09 §6.2` where the rule lives in §2; broken
  `G01.03` ADR links repeated across one results file.
- PR #99: blueprint link resolving under `decisions/` where the file lives elsewhere;
  §3.6.2 cross-reference to a nonexistent subsection.
- PR #46: `../../spikes/…` resolving outside `docs/`; PR #50: an ADR handoff link
  labelled G05 targeting the G00.01 brief; PR #98: label `env.example` vs target
  `.env.example`; PR #113: a dependency cell naming a task without its tracking issue.

Why it keeps happening: citations are typed by hand and never opened; a link-check run
exists in at least one results doc but its output was stale (class 2).

**Lesson:** a link is a contract claim. Open every link you add, or automate a link
checker and paste its fresh output.

## 6. Belarusian language defects — 24 / 11 PRs

- Russisms: «Уже» (#96), «зависимость» (#51), «незафикаваныя артефакты» (#52),
  «хэш-мисмач» (#91), «лічильнік» (#96).
- Latin/Cyrillic homoglyphs: «коранi» (#48), «дзецi» (#94), «падгінaюцца» (#94),
  «схемa» (#91), «Манifest» (#96), «Idempotentнасць» (#91).
- Typos and convention misses: «Канрэтныя» (#84), «Никад» (#91), «пр такаж» (#91),
  «ў» after a semicolon where the convention requires «у» (#50, #102).

Why it keeps happening: human-facing text is written without the mixed-script grep, and
the repo orthography convention (from `documentation-language.md` practice) is not
written down in the checklists.

**Lesson:** rule 12's grep is the minimum; add the ortho convention — «ў» only after a
vowel, «у» after punctuation — and the known russism list to every self-review of
added Belarusian text.

## 7. False-confidence tests — 19 / 2 PRs

- PR #53 (13 findings across rounds): mock probes passed auth through a wrapping helper
  production never uses, so scheme validation was never exercised; the live suite
  omitted the backslash-traversal and raw-secret cases the mock had; `Retry-After` went
  unasserted through two review rounds; the log-hygiene test's title claimed more than
  it asserted.
- PR #105: the AC4 test went through `stubContext`, never reaching the production
  `resolveRef` — re-flagged three times.

Why it keeps happening: helpers are added for convenience and quietly reshape the input
space; nobody diffs the mock and live case lists.

**Lesson:** a test that does not reach the production path tests the harness. The live
suite is a superset check, not a subset check.

## 8. Deliverable incomplete against the task contract — 17 / 3 PRs

- PR #46: the results file omitted the required product-decision disposition, the
  tsc/lint N/A row and the self-review step; the device matrix collapsed two device
  classes into one row and implied one row satisfied the whole M0 milestone.
- PR #48: the run-model checks required by atomic step 3 were omitted — re-flagged at
  MEDIUM after a non-fix; cell 10 bundled two scenarios.
- PR #46: the author's own severity verdict was embedded in the deliverable's checks
  table, reading as an independent review outcome.

Why it keeps happening: results docs are written from memory of the task instead of by
walking the task card.

**Lesson:** done is checked line by line against the task card and the parent matrix —
and an author's self-review is labelled as such, never presented as a verdict.

## 9. Unwired checks — 11 / 6 PRs

- PR #85: spike tests not wired into CI; the new guard ran manually only.
- PR #92: nothing failed if `npm test` globs reverted to `.a`-only coverage.
- PR #101: no CI workflow ran the scaffold's typecheck/test/expo-doctor.
- PR #105: the test-wiring guard could not see its own removal — re-flagged three
  times and accepted as a residual.

Why it keeps happening: writing the check feels like enforcing it; the invocation step
is a separate change nobody makes.

**Lesson:** a check nobody invokes is a comment. Same PR wires it, and demonstrates it
failing once.

## 10. Smaller recurring classes (31 instances / 13 PRs)

- **Dead code and unused imports** (6/4: #42, #45, #116, #120) — unused re-exports,
  duplicate headers, a dead disjunct already covered by the previous condition.
- **Dev-client flow inconsistency** (6/1: #101) — `eas.json` required
  `expo-dev-client` the dependency, scripts and setup docs didn't agree on.
- **Migration/rollback gaps in ADRs** (3/2: #40, #44) — finished rows lost by a
  partial migration; legacy ids never defined as inert; no lossless rollback contract.
- **Undocumented exported-API contracts** (3/2: #114, #120) — a synchronous throw,
  per-tier re-evaluation and a confinement duty visible only from callers.
- **Transport/security hardening** (3/2: #40, #47) — `http:` accepted for
  credential-bearing requests; the unforgeable publisher boundary left as a forgeable
  string field.
- **Markdown table corruption by raw pipes** (2/1: #43) — a `|` inside inline code
  splits the row; escape it.
- **Reproduction artifacts** (2/1: #50) — a historical mismatch claimed without a
  checked-in repro, and a repro snippet that fails from the repo root.
- **Validator coupled to git** (2/1: #42) — successor guidance that would make a
  production validator compare git blobs instead of the deployed artifact.
- **Measurement protocol comparability** (4/2: #48, #51) — transfer mode unrecorded
  between compared runs; host-side metrics presented as device evidence.

## Gates: enforced today vs proposed

Enforced today: jscpd copy-paste gate (code), `check-regressions.mjs` mutation suite,
`tsc --noEmit`, the test-wiring guard (with its self-check gap from #105), and rule 12's
mixed-script grep run by hand.

Proposed cheap gates (each a small script; candidates for follow-up issues):

1. **Link checker** over relative links and `§` anchors in changed `.md` files — kills
   class 5 mechanically.
2. **Count-drift check**: extract "N/M" and "N tests" claims from results docs and PR
   templates, compare against a fresh suite run — kills most of class 2.
3. **Rule↔test naming convention**: every contract rule id must appear in a negative
   test id, checked by grep — closes the blind spots of classes 3–4.
4. **Homoglyph grep as a committed CI script** (rule 12 already defines the pattern) —
   kills class 6 mechanically.

## Method notes and caveats

- Four clustering passes over one taxonomy brief; per-lesson breakdowns above allow
  recomputing any count under a stricter or looser definition.
- The corpus ends at PR #120 (2026-09-19). Re-run the crawl before quoting these counts
  in later debates: the numbers describe the corpus, not the repo's eternal nature.
- Raw data per PR (reviews, inline comments, conversation) was fetched from the GitHub
  API; the clustering rejected ~200 workflow/status comments as noise.
