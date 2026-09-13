# Agent instructions

Before completing any implementation task, read and follow `docs/agent-rules/showboat.md`. It defines the mandatory, measurable conditions for creating a Showboat proof of work.

When reviewing a diff, a PR, a branch before merge, or code you or another agent just wrote, read and follow `docs/agent-rules/code-review.md`. It defines review scope, the pre-checks to run before reading, the KUDY checklist, and the severity-graded output format.

When you claim, execute, block or hand back a task tracked as a GitHub issue in this repository, read and follow `docs/agent-rules/issue-workflow.md`. It defines the status-label protocol shared with the dispatcher, the claim and handback comments, and the PR contract that closes the issue on merge.

Search before adding helpers. On a jscpd fail, refactor or reuse; do not paste a second variant.

Local pre-push: `npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .`
