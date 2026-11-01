# Dispatcher loop (writer / reviewer)

The PR dispatcher owns git push, PR, and approve. Codex in this checkout
only writes product code and a review JSON.

## Writer

- Implement the issue acceptance criteria. Stop at out of scope.
- Do not merge, do not change GitHub checks, do not edit files outside this
  checkout.
- Do not read or invent GitHub / dispatcher tokens.
- Leave a test (or named command) that fails if the change is reverted.

## Reviewer

Follow `code-review.md` **and `review-gate.md`**. Voka and Judge apply the
same thresholds; 3 distinct MEDIUM findings across their latest same-HEAD
reviews block the combined PR gate. On PASS, every remaining finding must
have a linked GitHub Issue with the reviewer's finding label before the
workflow is complete. Report merge readiness separately.

When the dispatcher asks for structured output, use
the prompt in the dispatcher repo (`prompts/reviewer.md`): JSON findings with
P0–P3. A fenced ` ```json ` block is accepted; a model `approve` line is not.

Map this policy’s labels: CRITICAL→P0, HIGH→P1, MEDIUM→P2, LOW→P3.
A model `approve` line is not an approval.
