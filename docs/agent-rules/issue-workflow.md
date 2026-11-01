# Issue task workflow (external agents)

This file is the single source of truth for any agent — external or in-checkout —
that executes a task tracked as a GitHub issue in this repository. The issue board
is shared with the PR dispatcher and with the human operator, so the labels and
comments below are a protocol, not a suggestion. If you only read one task file
(`docs/agent-tasks/...`), you still follow this file.

Related rules: `showboat.md` (proof of work), `code-review.md` (self-review before
done), `dispatcher-loop.md` (writer boundaries), `documentation-language.md`.

## 1. The label contract

| Label | Meaning | Who sets it |
|---|---|---|
| `agent:ready` | Claimable. The dispatcher scans this label to pick work. | Operator or automation only |
| `agent:running` | Claimed by exactly one executor (dispatcher or an external agent). | The claiming agent |
| `agent:blocked` | Stopped; a human must act before work continues. | The blocked agent |
| `agent:approved` | The dispatcher's review gate passed. | The dispatcher only — never you |
| `epic` | A parent issue with subtasks. Never claim it, never work it. | Operator only |
| `needs:owner` | Runs only in a live session with the owner present; no unattended pickup by the dispatcher or Zcode. | Operator only |
| `prio:N` | Ordering hint for the operator (`prio:1` first). | Operator only |

Status labels (`agent:ready`, `agent:running`, `agent:blocked`) are
single-valued: when you add one, remove the previous one in the same update.
An open issue carries at most one of them at any moment.

### Zcode executor exception

When a task is executed by a Zcode session, Zcode may select any open,
unfinished issue without requiring `agent:ready`. Before doing any work, it
must atomically replace the issue's current status label with `agent:running`.
The `agent:running` label is a claim: another executor must not take the issue
while it is present. Zcode must not take an issue that already has
`agent:running`, and must not take an `epic`, an issue labeled `needs:owner`, or an issue with an
open `Blocked-by` prerequisite. A `needs:owner` issue runs only in a live session
with the owner present.

On hand-back, `agent:running` is replaced with `agent:ready`; on a blocking
condition it is replaced with `agent:blocked`. The existing `agent:approved`
ownership rule remains unchanged.

## 2. Before you claim — all must hold for non-Zcode executors

1. The issue is **open** and labeled `agent:ready`.
2. It is not an `epic`, it has no `needs:owner` label, and its `Blocked-by: #NN` prerequisites are all **closed**.
3. It has numbered, observable acceptance criteria (the issue template guarantees
   the shape; older issues may not). No criteria → do not start; see §6.
4. Dependencies from `docs/agent-tasks/README.md` hold: G01.01 → G01.02 → G01.03
   in sequence; G00.04 is never started while a G01 task writes the same shared docs.
5. You hold **no other claim**. One task at a time, no exceptions.

The operator decides which issues go to external agents. A task being claimable is
not an instruction to take it — take only what you were given.

## 3. Claiming

Do this in one pass, before writing any code:

1. Replace `agent:ready` with `agent:running` on the issue.
2. Post the **claim comment**:

   ```markdown
   ## Claim
   - Agent: <your name/model, e.g. codex-cli gpt-5.2>
   - Branch: <tool>/<issue-number>
   - Started: <UTC timestamp>

   ## Brief
   - Goal: <one sentence in your own words>
   - Sources read: <task file, docs, code you actually opened>
   - Constraints: <scope limits you will respect, incl. Out of scope>
   - Plan per criterion: 1. … 2. … 3. …
   - Questions: none | <what the materials do not answer>
   ```

3. If `Questions` is not empty: additionally replace `agent:running` with
   `agent:blocked` and stop. Wait for a human answer in the issue, then set
   `agent:running` again and proceed. Do not guess requirements.

The brief mirrors the dispatcher's own gate: an incomplete or generic brief is the
same defect there as a missing one. Work happens on a branch named `<tool>/<issue-number>`
(existing convention: `codex/11`, `cursor/jscpd-company-gate-3e5a`), branched from `main`.

## 4. While running

- Implement exactly the numbered criteria. "Out of scope" on the issue is binding;
  a neighbouring task's file is not yours to fix.
- Never edit the issue title, body or acceptance criteria of a claimed issue. The
  review gate digests the criteria; a silent edit invalidates every verdict. If a
  criterion is wrong or untestable, post it as a `Questions`-style comment and set
  `agent:blocked` (§6).
- Write results where the task file says — for agent-tasks that is
  `docs/agent-tasks/results/<ID>.md`, recording the actual outcome, not "done".
- Do not write shared documents (`docs/09…`, run-model, contracts) unless the task
  says so; parallel agents hold the same prohibition in the other direction.

## 5. Finishing

1. Run the pre-checks and self-review from `code-review.md` before you report done.
2. Apply the `showboat.md` decision rule; create and verify the demo when it triggers.
3. Run the copy-paste gate locally: `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .`
4. Open a **PR to `main`** with this body shape:

   ```markdown
   Closes #<issue-number>

   ## What
   <one paragraph>

   ## Evidence
   1. <criterion> — <command, test or file:line that proves it>
   2. …

   ## Proof
   <the single command that fails if the change is reverted>

   ## Out of scope kept
   <what you deliberately did not touch, or "nothing noted">
   ```

   `Closes #N` is mandatory: the issue closes when the PR merges, and the merge is
   the completion signal both the operator and the automation understand.
5. Merging is authorized (owner decision, 2026-09-26; revised review
   thresholds 2026-11-01): follow [review-gate.md](review-gate.md).
   The combined review gate FAILS at 1 CRITICAL, 1 HIGH, or 3 distinct
   MEDIUM findings across Voka and Judge's latest same-HEAD reports.
   Remaining LOW and up to 2 MEDIUM findings do not block **by severity**,
   but every remaining non-blocking finding must have a verified GitHub Issue
   with the originating PR and `voka-finding` / `judge-finding` labels
   before merge readiness can be green. Both reviews must be current, all
   other required checks and acceptance criteria must pass, and the Judge
   approval must be independent. The pipeline may then squash-merge its own
   PR to `main` and delete the branch. Never merge without all these gates;
   never change GitHub checks or branch protection, never read or invent
   tokens (`dispatcher-loop.md` applies to you).
6. After the merge: remove `agent:running` from the (now closed) issue. Nothing else
   is needed. If the PR was closed without merging, hand the task back (§6).

Blocking review findings on the PR are fixed in the same branch, with a fresh
review; never open a duplicate PR for the same issue. Findings allowed by the
Voka/Judge threshold are tracked in GitHub Issues as specified by
`review-gate.md`; they need not be fixed in the source PR. An Issue for
follow-up debt is distinct from the original implementation Issue. Do not
silently create duplicate finding Issues on each review rerun.

## 6. Blocked and hand-back

External blocker (missing account, device, secret, service) or a question that
stops you:

1. Replace `agent:running` with `agent:blocked`.
2. Post:

   ```markdown
   ## Blocked
   - Reason: <exact blocker>
   - Needs from a human: <the smallest decision or action that unblocks>
   - Work so far: <branch, commit, results file — or "nothing committed">
   ```

For a spike without the required tool or account, mark the outcome `blocked-external`
per `docs/agent-tasks/README.md` — never a mock pretending success.

Handing a task back unworked or abandoned:

1. Replace `agent:running` with `agent:ready`.
2. Post:

   ```markdown
   ## Handoff
   - Reason: <why you are not continuing>
   - State: <branch, commits, results file — or "nothing committed">
   ```

Never re-add `agent:ready` while your PR for the issue is still open.

## 7. Hard boundaries

- Exactly one status label per open issue, and only through the transitions above.
- Never set `agent:approved`, never add `agent:ready` to an issue yourself, never
  touch `epic` or `prio:*`.
- Never edit `.github/` workflows, templates or required checks.
- Never claim an issue with open `Blocked-by` prerequisites, and never run two claims.
- Comments and PR bodies use the fixed English headers shown here; human-facing
  documentation you produce follows `documentation-language.md`.
