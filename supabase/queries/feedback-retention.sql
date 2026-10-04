-- G16.04 — the feedback retention sweep (docs/architecture/21 §6): current
-- rows, tombstones and the mutation ledger are kept at most 14 months from
-- their last change (the same upper bound the 09 §10 raw-event term pins);
-- the fixed-window rate counters are dead weight after 24 hours, matching
-- the events counters (functions/_shared/retention-core.ts
-- RATE_RETENTION_HOURS — one hour windows can neither increment nor gate
-- again). Admin-run through the existing administrative access (MFA); the
-- schedule itself is deploy wiring, not-run in-repo (the G08.01/G09.02
-- precedent). Idempotent: a second run deletes nothing new.
--
-- After the sweep a replayed mutation with expected_revision > 0 conflicts —
-- the row is gone and a CAS create only accepts revision 0 — so an
-- old-device queued submission cannot revive expired data (21 §6). A
-- genuine new rating (expected_revision 0) is still accepted; the spec does
-- not promise an old installation its old scores back.
--
-- The device-delete half of «data deletion» needs no statement here: the
-- feedback tables cascade on devices (20261004000000), so the existing
-- DELETE /v1/device transaction already clears a device's ratings, ledger
-- and rate counters. Saved private reports do not survive either path —
-- docs/runbooks/feedback.md mandates removing and re-creating them after
-- any device-delete or sweep.

delete from feedback_current
where updated_at < now() - interval '14 months';

delete from feedback_mutations
where created_at < now() - interval '14 months';

delete from feedback_send_rate
where window_start < now() - interval '24 hours';

delete from feedback_ip_rate
where window_start < now() - interval '24 hours';
