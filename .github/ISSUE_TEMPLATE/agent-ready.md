---
name: Agent-ready task
about: Task the PR dispatcher may pick. Label agent:ready is the allow flag.
title: ""
labels:
  - agent:ready
---

## Goal

One paragraph. What is true when this is done.

## Acceptance criteria

Numbered. Each line is observable (test, command, screen, file).

1. [ ]
2. [ ]

## Out of scope

What the writer must not do.

## Dependencies

PRs/issues that must be **merged** first. Leave empty if none.

## Proof

Command or test that fails if the change is reverted.

```
```

## Notes for the dispatcher

Repo and permissions come from dispatcher config, not from this text.
Do not ask the agent for extra network, secrets, or host paths here.
