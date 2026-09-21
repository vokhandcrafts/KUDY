# G18 issues — published texts (source of the acceptance criteria)

Created from this file 2026-09-22 via [issue-workflow](../../agent-rules/issue-workflow.md);
criteria are copied verbatim from the briefs — do not edit an issue body without
going back to the [plan](../../plans/2026-09-21-zcode-lessons-adoption.md) and the
brief. Real numbers and links are filled in below after creation.

## G18.01 — Machine-checked layer boundaries (#164)

**Goal:** the module boundaries that today only review catches become a machine
check: dependency-cruiser forbids cycles, checks layer direction and forbids
platform imports in `core/`; nonzero exit on **new** violations, legacy violations
in a dated baseline updated only in review.

**Acceptance criteria:**

1. `npm run arch:check` exits 0 on the repository at the final HEAD of the task PR.
2. A committed test (`tools/arch/arch-check.test.mjs`, wired into the `npm test`
   glob) builds a sandbox with a copy of the repo config and planted violations —
   (a) a two-file cycle, (b) a `core/` production file importing `node:fs`, (c) one
   layer-direction violation — and asserts the checker exits nonzero naming the
   violated rule.
3. The baseline exists, is dated, and carries an explanation for every entry
   (expected on 2026-09-22: zero entries); `npm run arch:baseline` regenerates it;
   updates happen only in review.
4. CI coverage and wiring are guarded: removing the `tools/arch` glob entry from
   `npm test`, or the `arch:check` script from `package.json`, turns a committed
   check red (extend `tools/ci/check-required-checks.mjs`; CI already runs
   `npm test` via required-checks — no `.github/` edits).
5. `implementation-rules.md` gains a new § naming `npm run arch:check` with the
   «configuration is code» requirement (extension of §1), and the root `AGENTS.md`
   local pre-push line lists `npm run arch:check` next to jscpd.

**Out of scope:** rules for `app/`/`controllers/` (do not exist yet); deep-import
limits; fixing existing violations (baseline only); editing `.github/`; scanning
`spikes/` and `docs/run-model`.

**Proof:** `node --test tools/arch/arch-check.test.mjs`.

**Brief:** `docs/agent-tasks/zcode-lessons/G18.01.md` (layer matrix table with
canonical sources 09 §6 + 19 §2).

## G18.02 — Domain vocabulary (#165)

**Goal:** a single index of domain terms — term / short definition / canonical
source link (01, 09, 15, 19, 21) / `_Avoid_` — cross-indexing existing canon only;
no new definitions, no new behavior. Placement: `docs/architecture/25_domain_vocabulary.md`
(24 is taken by the web-collection spec draft, PR #152).

**Acceptance criteria:**

1. Every term row carries exactly one canonical source link, and every link
   resolves at push time (implementation-rules §16).
2. Every row carries an `_Avoid_` example.
3. No new behavior or definition is introduced: anything not present in the canon
   is either absent or explicitly marked as a proposal, never stated as decided.
4. The update rule — a new term lands in its canonical source first, the
   vocabulary only indexes it afterwards — is one paragraph inside the file itself.
5. A structural guard test (under `tools/validate/`, already in the `npm test`
   glob) fails when the file is removed or when a row loses its source link or
   `_Avoid_` cell.

**Out of scope:** renaming anything; i18n of terms; new definitions; a second
rules file.

**Proof:** `node --test tools/validate/vocabulary-guard.test.mjs`.

**Brief:** `docs/agent-tasks/zcode-lessons/G18.02.md`.

## G18.03 — Module surface reader `tools/arch-surface` (#166)

**Goal:** a small `node:`-only script that prints, for a given directory, its
files, exports and external imports — live facts next to 19, never instead of it.

**Acceptance criteria:**

1. Running the script on `core/discovery` and on `services/contentRepo` produces
   the correct file/export/import lists — verified by hand against the code, with
   the comparison recorded in the results file.
2. A test on a fixture directory (committed fixtures) asserts the printed surface
   for known inputs; the test file is wired into the `npm test` glob.
3. The output is deterministic plain text (stable ordering, no timestamps).
4. No new dependencies: `package.json` is unchanged apart from (at most) the test
   glob entry.

**Out of scope:** dependency-graph analysis or rule enforcement (dependency-cruiser
from G18.01 owns that); renderers beyond plain text; watch mode; caching; edits to 19.

**Proof:** `node --test "tools/arch-surface/*.test.mjs"`.

**Dependencies:** `Blocked-by: #164, #165` (plan order; no technical dependency).

**Brief:** `docs/agent-tasks/zcode-lessons/G18.03.md`.

## G18.04 — Size guideline in the review rules (#167)

**Goal:** encode the size orientation as a review-time requirement, not dogma and
not a CI gate: file over ~400 lines or contract over ~12 public methods obliges
one assessment phrase in review. No standalone refactor of `build-bundle.mjs`
(680 lines) for the count — assessment on the next real touch.

**Acceptance criteria:**

1. `code-review.md` gains the one-phrase requirement with the ≤400-lines /
   ≤12-public-methods orientation, worded as orientation, not dogma.
2. The guideline lives in `code-review.md` only — no second copy elsewhere.
3. A guard test (under `tools/validate/`, already in the `npm test` glob) fails if
   the guideline requirement is removed from `code-review.md`.
4. `tools/build-bundle/build-bundle.mjs` is not touched.

**Out of scope:** refactors motivated only by line count; hard limits or CI gates
on file size; other agent-rules files.

**Proof:** `node --test tools/validate/size-guideline-guard.test.mjs`.

**Brief:** `docs/agent-tasks/zcode-lessons/G18.04.md`.
