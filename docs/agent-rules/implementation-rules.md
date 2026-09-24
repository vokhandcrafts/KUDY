# Implementation rules — recurring defects and their prevention

This file turns the defect patterns found by the 2026-09-15 global code-architecture
review (`docs/architecture/22_code_architecture_review.md`, findings AR-1…AR-6) and by
the fix campaign's own review cycles (PRs #85–#92, 2026-09-15/16) into mandatory rules.
Each rule names the real occurrences, the rule, and the pre-push check.

Read it alongside `code-review.md` (self-review before done), `showboat.md` (proof of
work), and `issue-workflow.md` (process). Where a rule extends an existing one, the
extension is stated explicitly. Add a rule here when the same defect class appears a
second time; cite its occurrences.

The 2026-09-19 closed-PR corpus (52 closed PRs — 51 merged, #90 closed unmerged — 369
findings) is the evidence base in `lessons-learned.md`; rules 13–17 and the corpus
refresh of rules 1, 2, 7 and 12 come from it.

## 1. Every fix ships with a check that fails when reverted — config counts as code

**Occurrences (×3):** PR #85 HIGH — nothing failed if `.gitattributes` was reverted;
PR #92 HIGH — nothing failed if the `npm test` globs were reverted to `.a`-only;
PR #86 warning — the drain-limit reset path had no test.

**Rule:** a "fix" includes configuration, git attributes, runner wiring, ignore files
and docs. If the defect is reproducible by reverting a line, the same PR adds a
committed check that fails on that revert — a test, a CI-visible assertion (e.g.
`git check-attr`), or a guard over the wiring itself. Verify the guard by reverting
the fix temporarily and watching the check fail **before** pushing.

**Check:** for every defect fixed by the diff, name the reverted-line check; no answer
means not done. (Extends `code-review.md` §4 "a test that fails if the change is
reverted" to non-test files.)

**Corpus 2026-09-19 (×30 / 8 PRs):** documented rules with no failing-on-removal test —
PRs #42, #85, #86, #105, #114, #116, #118, #120 (`lessons-learned.md` §4). The rule
covers documented contract rules, not only fixed defects.

## 2. Restated contracts are copied verbatim, never paraphrased

**Occurrences (×7, one PR's review cycles, #91):** `acceptFix()` events missing
`fix`; `RunState` missing `focus_lost_at?` and later `play_seq`; an invented
`LocationMode` enum; a sequence diagram routing location events past the pipeline and
controller; readiness attributed to download instead of contentRepo; `AudioFinished`
missing `story_id?` after `09` was amended; `activate()` missing `locale`;
camelCase↔snake_case with no declared boundary.

**Rule:** any artifact that restates a contract (class map, diagram, interface
catalogue, walkthrough, README example) must (a) copy each name and signature verbatim
from its canonical source at write time, with the source anchored in the text;
(b) mark anything it proposes as proposed; (c) be the only restatement — later
artifacts link to it instead of restating. If two spellings exist by convention
(e.g. snake_case contracts vs camelCase TypeScript), declare the boundary and the
single mapping point in the document.

**Check:** pick every restated field/signature in the new artifact, open its canonical
line, compare. The diff must be empty or intentional.

**Corpus 2026-09-19 (×95 / 18 PRs):** the largest class in the corpus — diagrams,
catalogues, fixtures, backlogs and code each restating the canon (PR #91 ×22, #42
fixtures ×17, #43 stale model wording ×13, #107 dependency over-blocking ×10;
`lessons-learned.md` §1). Fixtures and issue drafts are restatements too.

## 3. Search the repo for the idiom before writing platform-sensitive code

**Occurrences (×2):** AR-2 — `serve.mjs` hardcoded `/` in path containment while the
correct `startsWith(root + sep)` idiom already existed in
`spikes/G00.03-sandbox-grant/server/grant-server.mjs`; AR-1 — EOL conversion breaking
hash verification.

**Rule:** before writing any path, EOL, encoding or byte-comparison logic, grep the
repo for an existing implementation and reuse the exact idiom. Never hardcode `/` in
path containment; never assume LF where bytes are hashed; never assume POSIX where
the repo runs on Windows.

**Check:** grep for the pattern you are about to write; a differing sibling
implementation is a finding against your diff.

## 4. Byte-addressed content pins its environment in the same change

**Occurrences (×1, class-wide):** AR-1 — `lock.json` records sha256 over LF bytes; a
CRLF checkout broke integrity verification. The blocker had been documented in two
evidence files and left unresolved.

**Rule:** when hashing or byte-comparing repo files, the same change commits the
environment pin (`.gitattributes` with `eol=lf` or `-text` for those paths) and
re-checks-out the affected files. A documented-but-unfixed blocker is not a
mitigation.

**Check:** `git check-attr eol -- <hashed paths>` returns the pinned value, and the
PR carries a fresh-checkout reproduction command.

## 5. Generated mirrors of source files are gitignored in the same change

**Occurrences (×2 in one campaign):** `spikes/G00.02-offline-map/runtime/` (an
activation copy of `source/`) broke the jscpd gate and polluted `git status` twice —
on `zcode/78` and again on `zcode/80` — as soon as `prepare-data.mjs` succeeded.

**Rule:** any script that copies repository files into a build/runtime output
directory ships with that directory in `.gitignore` in the same PR. Mirrors of source
files are clone-gold for copy-paste gates.

**Check:** run the generation script, then `git status --short` and the jscpd gate;
both must be clean.

## 6. Resolve contract-vs-code contradictions before merging; never canonize behavior with a test

**Occurrences (×1 explicit + ×1 historical):** AR-3 — the closed error list documented
`400 invalid_request` while the code made it unreachable, and a merged test asserted
the connection drop (`status === 0`), turning a gap into a deliberate contradiction
(PR #53).

**Rule:** when a documented contract and code disagree, the same PR either changes the
code to the contract or amends the contract — and the test asserts the **documented**
outcome. A test that pins current behavior across a known contradiction is a HIGH
defect, not a safety net.

**Check:** for every changed behavior, quote the doc line it must match; if none
exists, the PR writes one.

## 7. Green means complete: the test runner is a contract

**Occurrences (×1 explicit + ×1 guard repeat):** AR-6 — `npm test` green at 20/20
while the G00.03.b adversarial suites in `tests/` never ran; PR #92 HIGH — nothing
prevented reverting to that state.

**Rule:** the default test command must enumerate what it runs, and every suite is
wired into it in the same PR that adds the suite. Optional/live suites self-skip with
a visible reason in the reporter output. Runner wiring is guarded (rule 1).

**Check:** run the default command and match the printed test count against the
expected total; skip reasons must be visible.

**Corpus 2026-09-19 (×11 / 6 PRs):** #85 unwired spike tests, #92 revertable npm-test
globs, #101 scaffold checks with no CI workflow, #105 a wiring guard that cannot see
its own removal (×3, accepted residual) — `lessons-learned.md` §9.

## 8. Documents about behavior expire — append a resolution pointer, never rewrite

**Occurrences (×2):** AR-1 — the CRLF blocker documented in the G00.02.b evidence and
results files and left unfixed; PR #86 — `results/G00.03.b.md` still described the
connection drop after AR-3 changed the behavior.

**Rule:** when a PR changes documented behavior, grep `docs/agent-tasks/results/` and
spike evidence for the old behavior and append a dated 2–3-line resolution pointer
linking the PR. History sections are never rewritten.

**Check:** `git grep` the old-behavior keywords across `docs/agent-tasks/results/` and
`spikes/*/evidence/` — every hit is either still true or carries a pointer.

## 9. Evidence must prove the environment it claims

**Occurrences (×1 explicit, applies to every spike task):** PR #85 LOW — the demo
could not by itself prove the Windows `core.autocrlf` claim; platform claims rested on
prose notes.

**Rule:** platform-specific claims (OS, EOL, store, device, env vars) in demos and PR
descriptions name the host and show the relevant environment state as command output
(`git config core.autocrlf`, OS version, variable presence) — not as prose. One
unverified platform claim stated as a fact is a finding on its own (`code-review.md`
§4).

**Check:** for each platform claim in the PR, one command in the demo prints the
claimed state.

## 10. One executor per issue; re-fetch before every push

**Occurrences (×2, both caused rework):** the #21 claim race (a parallel session
pushed over an open PR branch); the #82 collision — a parallel agent pushed review
fixes to `zcode/82` twice while another executor held the claim.

**Rule:** `issue-workflow.md` already forbids two claims. In practice: re-check the
issue's labels and comments immediately before claiming; `git fetch` and rebase
(never force-push) before **every** push; if foreign commits appear on your branch,
integrate them and say so in the PR instead of overwriting.

**Check:** before each push, `git log HEAD..origin/<branch>` is empty after rebase.

## 11. Captured outputs are part of the diff

**Occurrences (×2):** PR #86 — adding a test changed the suite count and silently
invalidated the Showboat demo's captured output; demo outputs rot whenever a command's
output changes.

**Rule:** any change that alters a command's output (counts, wording, statuses)
re-captures and re-verifies the affected demos in the same PR. Captured output must
be deterministic in the first place: strip timing lines (`duration_ms`, …), normalize
line endings (`| tr -d ""` on Windows), and silence process-management noise. When
a demo starts a background server on a fixed port, kill it by the listening PID
(`netstat`+`taskkill`) with all kill noise redirected — shell job pids are
unreliable — and give tests that boot the same server an EADDRINUSE retry.

**Check:** `uvx showboat==0.6.1 verify <file>` passes for every demo touched or
affected by the diff; two consecutive runs of every demo block are byte-identical.

## 12. Language self-grep for human-facing text

**Occurrences (×4 in one PR):** «Никад», corrupted «пр такаж», mixed-script `схемa`
(Latin a inside a Cyrillic word), Russian stem `хэш-мисмач`; earlier sessions had the
same class.

**Rule:** Belarusian prose in docs and PR text: no mixed-script tokens, no Russian
stems for terms the repo has already decided (`несупадзенне`, `ніколі`,
`рэалізацыя`), no unexpanded command placeholders in protocol comments.

**Check:** grep the diff for `[А-Яа-яЁёЎў][A-Za-z]` and `[A-Za-z][А-Яа-яЁёЎў]`
(mixed script) and for the known Russian stems; fix or justify each hit.

**Corpus 2026-09-19 (×24 / 11 PRs):** the class recurred across 11 PRs after this rule
existed — «коранi», «дзецi», «Уже», «Манifest», «Канрэтныя» (`lessons-learned.md` §6).
Ortho convention for Belarusian prose: «ў» only after a vowel, «у» after punctuation.

## 13. Counts and statuses in docs and PR text are regenerated, never hand-typed

**Occurrences (×57 / 25 PRs):** PR #120 "218/218" vs actual 221; PR #116 claimed a
green suite vs actual 150/1 and "24 tests" vs 23; PR #98 link-check "36 resolved" vs
embedded 18;
PR #101 728 vs ~723 packages; PR #47 "15/15" vs 20/20; PR #45 "12 mutations" vs 16;
PR #46 "seven tests" vs 8; blocked/unblocked statuses contradicting the board
(`lessons-learned.md` §2).

**Rule:** any number or status claim a diff adds to a results doc, README or PR body
is copied from the output of the command run against final HEAD in the pushing session
— run the suite and every check last, then write the claims. If the artifact cannot be
re-run at push time, the claim carries a date and the exact command instead of a bare
number.

**G18.05 extension (issue #200, step c):** outside results files and captured demo
output, docs carry no test/module/rule counts at all — the reader runs the producing
command (`npm test`, `npm run arch:check`) instead of a number that rots at the next
merge. A count inside a results file or a captured `output` block of a demo is a dated
historical record and stays. The prose half of the gate is machine-checked:
`tools/docs-ledger/counts-guard.test.mjs` scans non-results docs for
`[0-9]+ (pass|modules)` outside `output` fences and fails naming file and line.

**Check:** re-run the suite and each check the diff reports on; every count and status
in the diff must match the fresh output. A stale claim is a finding even when the code
is perfect. Run the counts guard (it is part of `npm test`); every bare count the diff
adds must sit in a results file or a captured `output` block.

## 14. Every rule ships with an isolating negative test; corrupt input yields diagnostics, not crashes

**Occurrences (×64 / 11 PRs across corpus classes 3–4):** PR #114 Draft-07 semantics
mis-implemented and declared-but-unvalidated formats; PR #116 null array elements
crashing the validator and `duplicate-id#undefined` for missing identity fields; PR
#120 `story_id` interpolated into a store path without separator checks and
schema-required stops silently defaulted; PR #105 uncaught `SyntaxError` on corrupt
tier JSON; PR #42 negative fixtures that violated two rules at once
(`lessons-learned.md` §3–§4).

**Rule:** a validation rule without a negative test that names it does not exist. Each
negative fixture isolates exactly one violation and says which. Every parser/validator
also takes a corrupt-input case (null array elements, missing fields, empty strings,
wrong types) and must answer with diagnostics, never a thrown error. External strings
that build paths or ids are separator-checked against the existing safe-path idiom
(rule 3) before interpolation.

**Check:** for each new/changed rule in the diff, name the failing-on-removal negative
test; for each parser, name the corrupt-input test; both answers must exist before
push.

## 15. A test must reach the production path; mock and live suites are parity-checked

**Occurrences (×19 / 2 PRs):** PR #53 — mock probes passed auth through a wrapping
helper production never uses, the live suite omitted the backslash-traversal and
raw-secret cases the mock had, `Retry-After` stayed unasserted through two rounds; PR
#105 — the AC4 test ran through `stubContext` and never reached the production
`resolveRef`, re-flagged three times (`lessons-learned.md` §7).

**Rule:** test helpers may arrange state but must not pre-process inputs in any way the
production path does not. Live/external suites cover at least the mock suite's
negative-case list, and every header/field the contract documents is asserted
explicitly.

**Check:** trace one new test end-to-end from arrange to the production entrypoint, and
diff the mock and live negative-case lists; both belong in the review notes.

## 16. Links and section citations resolve at push time

**Occurrences (×24 / 11 PRs):** PR #96 — the refund rule cited `09 §6.2` instead of §2
three times plus broken G01.03 ADR links; PR #99 — a blueprint link resolving under
`decisions/`, a cross-reference to a nonexistent §3.6.2; PR #46 — `../../spikes/`
escaping `docs/`; PR #50 — a G05-labelled link targeting the G00.01 brief; PR #113 — a
dependency cell without its tracking issue (`lessons-learned.md` §5).

**Rule:** every relative link and `§`-citation in the diff is opened before push and
cites the rule's canonical home, not a secondary mention. A link-check output pasted
into results docs is re-captured fresh (rule 11) — a stale link-check table is itself a
stale-claims finding (rule 13).

**Check:** open — or run a link checker over — every link the diff adds; each `§`-cite
names a section that exists in the cited file.

## 17. Done is walked against the task contract, item by item

**Occurrences (×17 / 3 PRs):** PR #46 — required disposition, checklist rows and the
self-review step omitted from the results file; device-matrix rows collapsed or
ambiguous; the author's own severity verdict embedded as if it were an independent
review. PR #48 — atomic-step-3 run-model checks omitted, re-flagged after a non-fix
(`lessons-learned.md` §8).

**Rule:** before reporting done, open the issue/task card and the parent matrix and
tick every atomic step, required row and disposition in the results doc — from the
card, not from memory. An author self-review is labelled as such and never formatted
like a reviewer verdict. Ambiguity in a matrix cell is split or annotated, not
compressed.

**Check:** the review diffs the task card's acceptance criteria against the results doc
line by line; an unticked card item is a finding regardless of code quality.

## 18. Layer boundaries are machine-checked — the gate's own wiring is guarded (extends §1)

**Occurrences:** the AR-finding class in `22` (module-boundary violations that only
review catches; audit 2026-09-21) and the G18.01 acceptance survey — the brief's
"zero violations" claim held only for its two surveyed facts, while the full-matrix
machine scan found 6 cross-zone imports (2 production `web/` → `tools/`), all
baselined consciously in the same review.

**Rule:** the 09 §6 / 19 §2 layer matrix is enforced by `npm run arch:check`
(dependency-cruiser, pinned exact in devDependencies; config
`.dependency-cruiser.cjs` is a verbatim machine projection of the canon — no
invented rules, §2). New violations fail; existing ones live in the dated
baseline `tools/arch/baseline.json` with per-entry explanations in
`tools/arch/README.md`, updated only consciously, in review. The gate is
configuration-as-code (§1): the config file, the `arch:check`/`arch:baseline`
scripts and the `tools/arch` npm-test glob are each guarded — removing any turns
a committed check red (`tools/arch/arch-check.test.mjs`, extended
`tools/ci/check-required-checks.mjs`). A PR that adds a zone or changes
cross-zone dependencies updates the config in the same PR.

**Check:** `npm run arch:check` green before push; every new baseline entry has
its README explanation; the revert experiment (drop the script or the glob, watch
the guard fail) ran in the shipping session.

## Environment facts on the primary host — check, don't assume

- Windows with `core.autocrlf=true`: bytes on disk may differ from blobs (rules 2–4).
- The `gh` active account may flip to a second account and 404 on this private repo:
  `gh auth switch -u vokhandcrafts` before GitHub API work — "repository not found"
  is this, not a missing repo.
- The pre-push copy-paste gate is `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .`;
  it counts generated mirrors of source files (rule 5).
- Node ≥ 22 expands test globs itself; test scripts must not assume shell globbing.
- Several agent sessions may share one checkout: uncommitted work and branch switches
  by another session can appear in your worktree — inspect `git status` before
  committing, and stash-with-message (then restore) rather than discarding foreign
  changes.
