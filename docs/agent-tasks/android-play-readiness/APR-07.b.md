# APR-07.b — Add My KUDY device deletion and align every privacy-policy locale

## Epic

Epic: #299

## Goal

My KUDY exposes the verified device-data deletion service with honest confirmation, offline, partial-failure and completion states. The privacy-policy source and every translation describe that actual path and its limits. GP-12 stays open until the app, backend evidence and policy agree.

## Acceptance criteria

1. [ ] Through the established service/controller/UI layers, expose an accessible localized device-data deletion action in My KUDY without importing storage, network or credentials into the screen. Use the shared production database and SecureStore; do not make a parallel delete helper or register a device to delete it. Missing/unsafe endpoint configuration is an explicit unavailable state, never a sample domain or false success. Recheck composition after #663/#664 rather than overwriting their work.
2. [ ] Confirmation names what is removed and what stays. Cancel has no effect; duplicate taps share one operation; busy and error states are accessible. Offline, server failure and partial local cleanup have a named retry; success waits for the service's complete result. Missing credentials distinguish local-only cleanup from remotely confirmed deletion. Avoid a success message that claims erasure of all provider/platform records.
3. [ ] In production composition, prove that deletion/restart preserves local history, heard progress, active/paused walk state, hints, downloads, language and store purchase/restore capability; it removes device-bound queues, identity and consents as proved by APR-07.a. Stale mounted controller state or pending responses cannot restore old feedback/identity or resume sending. No old action is submitted under a later identity, and no new analytics/crash submission occurs without fresh consent.
4. [ ] Update web.ui.privacyDeletion and related affected records in contracts/ui-messages/source.json and every translation catalog, then regenerate web/lib/i18n/*.ts with the existing tool. Verify be/en/uk/de/es/fr/cs/sv/zh through rendered privacy pages and navigation/interaction tests: actual screen/action name, scope including feedback and queued actions, preserved local progress/downloads/purchases, network/retry behavior, and any proven retention limits agree. Never edit generated mirrors directly or leave a locale claiming an unavailable button. Publish the corrected policy and app as a coordinated release; no success claim from only changing text.
5. [ ] Run synthetic integration tests through the real app action, service, default transport, production handler and actual server migrations. Include other-device isolation, old-credential rejection and the service failure matrix; only platform/transport boundaries may be substituted in portable tests. Removing UI wiring, guarded error handling or a changed locale's promised behavior must fail a committed check wired into npm test; source matching alone is insufficient.
6. [ ] On an isolated Android release installation, record cancellation, successful deletion, offline/retry, restart after partial cleanup and preservation of a synthetic downloaded guide/history. Record application ID, source SHA, artifact hash and non-secret backend checks. A real deployed backend is required for a remote-erasure claim; otherwise report the exact environment blocker and keep GP-12 open. Do not touch a personal installation or production user's records.
7. [ ] Update the GP-12 audit row and results from fresh evidence; hand the exact deletion semantics and provider limitations to existing #811 / #299 without claiming Play acceptance. Run npm run messages:generate:check, npm run messages:check, npm run typecheck, npm test, npm run arch:check, then npx --yes jscpd@5.1.2 --config .jscpd.json --no-tips .; verify Showboat proof. Results: docs/agent-tasks/results/APR-07.b.md.

## Out of scope

Account creation or a new deletion website, redesign of Settings/G26, purchase entitlement changes, #833 backup implementation, provider account erasure, Play Console submission and .github/dispatcher changes. Existing #811 owns the Data safety inventory and form draft; do not create a duplicate.

## Dependencies

Blocked-by: #805, #835, #663, #664

#835 tracks APR-07.a. #663/#664 serialize edits to the production composition and Android runner. APR-07.a and the decision must be merged and available in main; publication alone is not permission to run.

## Proof

Production UI-to-service tests, actual policy-page rendering for each locale, real server isolation/cascade tests, isolated revert failures and a synthetic Android release deletion/restart record. Record unavailable native/backend environments as blockers, not passes; preserve release gates.

## Sources and publication

This issue body is the executable specification. Current sources at main 02d5180: app/(tabs)/my.tsx, controllers/deviceRoot.ts, controllers/deviceServices.ts, controllers/createServices.ts, services/device.ts, contracts/ui-messages/source.json and web/lib/i18n/. The local task file is a publication mirror. The decision docs/architecture/decisions/APR-07-device-data-deletion.md is available to a main runner only after the #805 PR merges.

## Notes for the dispatcher

Backlog only. Do not add agent:ready, start workers, change dispatcher settings or take #663/#664 while claimed. Follow docs/agent-rules/issue-workflow.md, implementation-rules.md, code-review.md and showboat.md. Apply the existing interface design system; this task does not approve a new visual direction.
