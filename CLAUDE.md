# Claude Code instructions

@docs/agent-rules/showboat.md
@docs/agent-rules/code-review.md
@docs/agent-rules/review-gate.md
@docs/agent-rules/design-qa.md
@docs/agent-rules/documentation-language.md

For a design-QA review, read `docs/agent-rules/design-qa.md` and run it on request and before closing any task that changes the interface. Design-QA is not run in CI and needs no model API key. Record unavailable device or baseline evidence as NOT-VERIFIED.

Before completing any implementation task, apply the Showboat decision rule in the imported policy.

When asked to review a diff, a PR, a branch before merge, or code just written, apply the imported code review policy.

When writing or editing any documentation file, apply the imported documentation language policy.
