# Voka / Judge PR review gate

This is the canonical disposition and GitHub finding-tracking contract for **both**
Voka (code reviewer) and Judge. Apply it to every PR review, including standalone
reviews in Chat, scheduled reviews and dispatcher reviews. The issue and the PR
remain distinct: a review can pass while the PR is not ready to merge.

## Severity rule (owner decision, 2026-11-01)

Count distinct, verified, **unresolved** root-cause findings on the PR's current
HEAD. The final PR review gate combines the latest Voka and Judge reviews for
that same HEAD. If both agents report the same defect, count it **once** by a
stable root-cause key and location, retaining the higher severity. Never lower
severity to achieve PASS or count the same defect twice to force FAIL.

| Unresolved findings on current HEAD | Review gate |
| --- | --- |
| At least 1 CRITICAL | FAIL |
| At least 1 HIGH | FAIL |
| At least 3 distinct MEDIUM | FAIL |
| 0 CRITICAL, 0 HIGH and at most 2 MEDIUM | PASS, regardless of LOW count |

Examples: 2 MEDIUM + 20 LOW = PASS; 3 MEDIUM = FAIL; 1 HIGH = FAIL;
1 CRITICAL = FAIL. Two MEDIUM from Voka and one different MEDIUM from Judge
also yield FAIL. The same MEDIUM found by both agents counts once.

Each reviewer reports their own finding counts and a provisional Voka/Judge
PASS/FAIL using this threshold. The **combined** PR review gate is calculated
from both latest reviews, not by merely AND-ing two provisional PASS results.
A missing review or stale HEAD is **PENDING**, never PASS.

The review result and **merge readiness are separate**. Draft status, failing
required CI, incomplete acceptance criteria, missing independent Judge approval,
missing issue-tracking evidence or any other independent merge condition may
still prohibit merge. They MUST NOT turn a severity-only PASS into a Voka/Judge
FAIL. Express them as separate merge blockers.

## GitHub Issues for findings

For every unresolved finding **allowed to remain when the review gate PASSes**,
publish or reuse a real GitHub Issue **before declaring the review workflow
complete**. A passing review with outstanding findings and uncreated/unlabeled
Issues is `PASS / tracking INCOMPLETE`, not a green merge authorization.

- Search existing open and closed Issues for the source PR + stable finding key.
  Create at most **one Issue per distinct root cause**, not one per rerun or agent.
  If both reviewers confirm one defect, reuse the Issue and apply both labels.
- Voka findings require label **`voka-finding`**; Judge findings require the
  existing **`judge-finding`** label. Do not substitute `agent:blocked`,
  `agent:running`, or an unverified label. If a label is not provisioned, report
  the blocker and do not claim issue tracking succeeded.
- Issue body must include `Source PR: https://github.com/OWNER/REPO/pull/N`,
  `Source HEAD: <sha>`, `Found by: Voka | Judge | Voka, Judge`,
  `Finding key: <stable-key>`, severity, exact file/line, evidence, impact,
  a concrete fix and a link to the review comment. Include the original
  implementation Issue link when known; the source PR is mandatory even then.
- The Issue remains open for follow-up on main once the source PR merges.
  Do **not** silently fix unrelated follow-up debt in the source PR or mark it
  `agent:ready` without the normal dispatch rules. If fixed on the source PR,
  close the finding Issue with a link to the resolving commit/review; re-evaluate
  the latest HEAD and do not count the resolved finding.
- The PR review report links **each** filed/reused finding Issue. A PR comment
  alone is **not** an Issue and cannot satisfy the tracking requirement.
- CRITICAL/HIGH and groups of 3+ MEDIUM are blocking findings to fix on the
  source branch, with evidence in PR review comments. Their promotion to separate
  backlog Issues is optional while the review FAILs; if the PR is later allowed
  to pass with unresolved findings, the Issue rule above becomes mandatory.

The gate does not create Issues itself. The agent/orchestrator must execute
GitHub Issue searches, creates, labels and read-back verification. A tool
failure is `tracking INCOMPLETE`; never invent an Issue URL or label.

## Publishing and automation

1. Re-fetch PR HEAD and read both current reviews; discard stale findings and
   confirm which have been fixed on this exact SHA.
2. Compute the gate from distinct unresolved findings (including both agents).
   Report severity counts, `Voka PASS/FAIL`, `Judge PASS/FAIL`, and the
   **combined review gate** separately.
3. If the combined gate PASSes with findings, publish/reuse and read back
   required labeled Issues, then link them in the PR report.
4. Mark merge readiness independently. Never merge without the current review
   gate PASS, complete required Issue tracking, required CI, completed acceptance
   criteria, and any required independent Judge approval.
5. Pure threshold / tracking-input validation is provided by
   `tools/ci/review-gate.mjs`. External bots and dispatchers must call the
   validator and wire the GitHub operations; repository tests alone cannot
   validate issues created in GitHub or change external bot configuration.
