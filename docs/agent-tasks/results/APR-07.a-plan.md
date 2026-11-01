# APR-07.a — implementation inventory and recovery design (working draft)

Issue: #835. This is a working design note, not evidence that acceptance criteria pass.

## Verified from main, 2026-11-01

- `services/device.ts`: `deleteDeviceAccount` currently returns `Promise<void>` and treats every HTTP 403 like a successful delete. The default DELETE transport discards the response body, so it cannot verify the canonical `device_auth_failed` error. It performs SQLite cleanup before clearing SecureStore, without persisted recovery state.
- `services/db/db.ts`: `clearDeviceAccountState` removes the device, event queue, and feedback tables and deletes only the `analytics_consent` settings key.
- `services/crash.ts`: independent `crash_consent` setting survives the current cleanup.
- `services/analytics.ts`: `flushAnalytics` checks consent before and between batches but has no shared deletion serialization boundary.
- `services/feedbackSync.ts`: feedback flush has its own per-driver in-flight guard; it can run concurrently with device deletion and mutate local queue state after a delete response.
- `services/device.ts`: `ensureDeviceIdentity` likewise has an independent in-flight registration guard. Restart recovery and registration must share a durable deletion boundary.
- `docs/architecture/decisions/APR-07-device-data-deletion.md` explicitly prohibits interpreting canonical 403 as proof of remote erasure.
- Source: repository `main` was fetched by GitHub connector. An executable test run has **not** been performed.

## Proposed implementation boundaries (not yet validated)

1. Add a small, non-secret durable deletion phase/status, owned by the SQLite service, with transactional transitions; keep the original secret only in SecureStore until it is safe to clear. Specify recovery rules for each crash window before changing registration.
2. Parse and validate the response body of DELETE. Distinguish **remote_confirmed** only for a validated 204; treat a canonical 403 `device_auth_failed` as **remote_unverified**. Any other or malformed 403 preserves identity/secret/retry capability.
3. Clear `analytics_consent`, `crash_consent`, and any other actually connected privacy/disclosure keys, but preserve session/guide hints/migration history/zone A bundles and `event_queue_seq`. Test preservation against real SQLite.
4. Establish one driver-scoped coordination boundary for registration, deletion, analytics sends and feedback sends. Late responses must never mark previously deleted rows as sent or create/replay an old identity.
5. Retry incomplete local cleanup before registration/sending after restart. Separate the persisted result of remote confirmation from local completion; never synthesize remote confirmation on restart.
6. Exercise the production DELETE handler and migration cascades with synthetic multi-device records. Check the feedback-report export removal/regeneration procedure using a synthetic saved export on a connected report host.
7. Add regressions to the default test runner and prove their negative/revert behavior, then run typecheck, test, arch:check, jscpd and Showboat before describing the change as complete.

## Verification blocker

The local Projects MCP runner rejects even `python3 -c 'print("ok")'` in the clean dedicated worktree with:

`Project tree is too large to verify sensitive-path masks safely.`

Therefore none of the required test/Showboat or report-host checks have run. Do not treat this draft as a tested fix or merge it as a completed issue. Repair the local command runner (or provide an equivalent isolated execution environment) and resume from this plan.
