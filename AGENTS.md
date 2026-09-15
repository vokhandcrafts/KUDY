# Agent instructions

Before completing any implementation task, read and follow `docs/agent-rules/showboat.md`. It defines the mandatory, measurable conditions for creating a Showboat proof of work.

Before implementing any fix or feature, read and follow `docs/agent-rules/implementation-rules.md`. It lists the recurring defect patterns from the 2026-09-15 architecture review and the fix campaign (reverted-fix guards, contract restatement drift, platform assumptions, generated mirrors, runner wiring, stale docs, executor collisions) with the mandatory pre-push check for each.

When reviewing a diff, a PR, a branch before merge, or code you or another agent just wrote, read and follow `docs/agent-rules/code-review.md`. It defines review scope, the pre-checks to run before reading, the KUDY checklist, and the severity-graded output format.

When you claim, execute, block or hand back a task tracked as a GitHub issue in this repository, read and follow `docs/agent-rules/issue-workflow.md`. It defines the status-label protocol shared with the dispatcher, the claim and handback comments, and the PR contract that closes the issue on merge.

Search before adding helpers. On a jscpd fail, refactor or reuse; do not paste a second variant.

Local pre-push: `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .`

## Publish task breakdowns to GitHub Issues

After splitting an approved specification into tasks, create or update the corresponding GitHub Issues in this repository as part of the same work. Local task files alone do not complete the task breakdown. This rule authorizes issue creation and synchronization without another confirmation.

- Inspect existing issues first. Match stable task IDs, reuse existing issues and epics, and preserve unrelated content and execution state.
- Include the outcome, scope, testable acceptance criteria, proof requirements and specification/task-file references. Follow `.github/ISSUE_TEMPLATE/agent-ready.md` and the project's ticket-writing rules.
- Link tasks to their epic with `Epic: #NN` and dependencies with `Blocked-by: #NN`. If a prerequisite has no issue, create its tracking issue with the actual scope and dependencies; do not silently omit the blocker or invent an issue number.
- Keep tasks in backlog unless execution is explicitly authorized and prerequisites are verified. Board visibility is not permission to add `agent:ready`, start workers or change dispatcher settings.
- Verify that referenced documents are available in the runner checkout. If they are only local, state that publication is a prerequisite; do not present broken GitHub links as available documentation or queue the task.
- Record issue URLs beside the local task index, read back the created/updated issues, and verify their visibility in the dispatcher's backlog. Report any unavailable board verification explicitly.
- If publishing is blocked by permissions, usage limits or a service failure, preserve the completed drafts and created issue numbers, report the exact remaining tasks, and resume without duplicates when the blocker clears. Do not bypass an approval rejection or claim that unpublished tasks are in GitHub.
