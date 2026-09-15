# Implementation rules — recurring defects and their prevention

This file turns the defect patterns found by the 2026-09-15 global code-architecture
review (`docs/architecture/22_code_architecture_review.md`, findings AR-1…AR-6) and by
the fix campaign's own review cycles (PRs #85–#92, 2026-09-15/16) into mandatory rules.
Each rule names the real occurrences, the rule, and the pre-push check.

Read it alongside `code-review.md` (self-review before done), `showboat.md` (proof of
work), and `issue-workflow.md` (process). Where a rule extends an existing one, the
extension is stated explicitly. Add a rule here when the same defect class appears a
second time; cite its occurrences.

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
