# APR-07.a — Complete device deletion safely across failures and restart

## Epic

Epic: #299

## Goal

The existing device deletion service completes local privacy cleanup and cannot lose its recovery path or revive old work after a partial failure. This is the service prerequisite for the My KUDY action selected in #805; preserve the current authenticated server contract and all walk progress.

## Acceptance criteria

1. [ ] Recheck services/device.ts, services/db/db.ts, services/device-secure-store.ts, services/analytics.ts, services/crash.ts, services/feedbackSync.ts and the actual disclosure owners. Record the concrete privacy keys and deletion/recovery design before implementation. Reuse existing service and transaction helpers. Never store the device secret outside SecureStore or silently weaken the contract if a new trade-off is needed.
2. [ ] Successful deletion removes device identity, event_queue, feedback_local, feedback_outbox and every applicable privacy consent/disclosure marker, including the currently retained crash_consent. Preserve session, heard progress, guide hints, migration provenance, downloads, derived content indexes, unrelated settings and event_queue_seq. Test each boundary with real SQLite rather than source greps.
3. [ ] Exercise server-first deletion through the default HTTPS transport: 204, the existing canonical 403 device_auth_failed retry after a lost response, offline, timeout, unsafe endpoint, redirect, malformed/unexpected responses and 500. Failure cannot report success or destroy the only credential needed to retry; do not reinterpret an unrelated HTTP 403 as confirmed remote deletion. A missing secret permits only explicitly identified local cleanup, never fabricated remote success or registration for deletion.
4. [ ] Inject transaction and SecureStore failures before/after server completion; restart with the same persisted database/store. Pending cleanup must recover before any registration or sending, including the window where SQLite was cleared but the old secret remains. Persist only the minimum non-secret recovery state; successful completion is idempotent. Do not wipe the database or rely only on an in-memory flag.
5. [ ] Serialize deletion against identity registration and active event/feedback senders. A delayed response cannot repopulate cleared rows, restore old consent, recreate an old identity, or send old work under a new one. Cover concurrent calls and cancellation/restart; a failed deletion leaves sending paused until explicit recovery. New local walk events after deletion remain consent-gated and are distinguished from the old outbox.
6. [ ] Revalidate the existing production DELETE handler and real migration cascades with synthetic data: only the authenticated device's server rows disappear, other devices remain, old credentials and queued feedback/events are refused. No server change is required if existing behavior passes; fix a demonstrated contract defect only within this boundary. Keep store purchases and RevenueCat rights intact; do not claim provider records are erased by this endpoint. Carry out the existing docs/architecture/21_discovery_feedback_architecture.md section 6 duty to remove or regenerate saved feedback exports/aggregates after data-delete, using tools/feedback-report rather than a new reporting store. Prove the operational path with a saved synthetic export and a post-delete report; the absence of a connected report host is an explicit blocker, never an exemption. Client code must not receive report-host privileges.
7. [ ] Wire the behavioral regressions into npm test and demonstrate an isolated failure when each affected cleanup, recovery or serialization behavior is reverted. Run npm run typecheck, npm test, npm run arch:check, then npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .; create and verify Showboat proof. Results: docs/agent-tasks/results/APR-07.a.md.

## Out of scope

UI, public-policy wording, Data safety submission, backup implementation (#833), new user accounts/endpoints, provider-side account erasure, changes to .github workflows or dispatcher settings. Do not terminate or erase an active walk as a side effect.

## Dependencies

Blocked-by: #805

Closed prerequisite: #288. Recheck overlapping claims before execution. The deletion boundary must be published in main before this task starts.

## Proof

Real SQLite, default transport and production handler tests for every criterion; isolated revert failures; restart/late-response evidence; verified local Showboat demo. Tests described here are deliverables, not existing coverage claims. Use synthetic credentials and never print them.

## Sources and publication

This issue body is the executable specification. Existing sources are already on main at 02d5180: services/device.ts, services/db/db.ts, services/crash.ts, supabase/functions/_shared/device-core.ts, supabase/functions/_shared/device-wire.ts and supabase/tests/feedback/. The local task file is a publication mirror. The selected decision is docs/architecture/decisions/APR-07-device-data-deletion.md; until the #805 PR merges, that document is not available in a fresh main runner checkout.

## Notes for the dispatcher

Backlog only. Do not add agent:ready, launch workers or change another executor's claim. Follow docs/agent-rules/issue-workflow.md, implementation-rules.md, code-review.md and showboat.md. A design conflict that would reduce security or erase progress needs an explicit owner decision before implementation.
