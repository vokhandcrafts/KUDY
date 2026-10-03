-- G16.01 — private feedback tables (docs/architecture/21 §5.2), additive:
-- new tables and FKs only, no rewrite of session or device state.
--
--   feedback_target_registry — the trusted allowlist of published targets
--     (guide/place id/version/locale); the publisher fills it, clients never
--     write. `prepared` rows fail closed (the API answers 503) until the
--     publication is reconciled; `published` rows accept ratings, and taking
--     a target out of discovery never erases one already left (21 §5.2).
--   feedback_current — one row per (device, target key): the current rating
--     or the delete tombstone. `score` is null only in a tombstone, a
--     tombstone carries no reasons and no previous score (schema-checked);
--     revision starts at 1 on create and increments on every committed
--     mutation.
--   feedback_mutations — the per-device idempotency ledger; the payload hash
--     distinguishes an identical retry (replay the stored result) from a
--     different payload under the same mutation_id (409).
--   feedback_send_rate / feedback_ip_rate — fixed-window request counters
--     (21 §5.3: 30/min per device, 120/min per IP); hashed keys only.
--
-- The three device-owned tables carry `on delete cascade`, so the existing
-- DELETE /v1/device transaction (device-core DEVICE_DELETE_SQL, G09.03)
-- clears a device's ratings, ledger and rate counters without a second
-- endpoint; the FK also makes a post-delete recreate impossible.
--
-- Deny-by-default in the two stacked layers of the device migration
-- (20260922120000): REVOKE from `anon`/`authenticated` first, then RLS with
-- no permissive policies — direct client table access is denied even if a
-- grant is re-added; only the service role (Edge Functions) touches rows.
--
-- Portable check: runs on plain Postgres once the Supabase roles exist; the
-- feedback suites in supabase/tests/feedback/ replay this exact file on
-- PGlite — it is the single source, no mirrored step list (the drift the
-- rls.test.ts sync guard watches for cannot arise here by construction).

create table feedback_target_registry (
  target_kind text not null,
  target_id text not null,
  target_version text not null,
  locale text not null,
  status text not null check (status in ('prepared', 'published')),
  published_at timestamptz,
  primary key (target_kind, target_id, target_version, locale),
  check ((status = 'published' and published_at is not null) or (status = 'prepared' and published_at is null))
);

create table feedback_current (
  device_id uuid not null references devices (device_id) on delete cascade,
  target_kind text not null,
  target_id text not null,
  target_version text not null,
  locale text not null,
  revision integer not null check (revision >= 1),
  score integer check (score is null or score between 1 and 5),
  reason_codes jsonb not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (device_id, target_kind, target_id, target_version, locale),
  check ((deleted_at is null and score is not null) or (deleted_at is not null and score is null and reason_codes = '[]'::jsonb))
);

create table feedback_mutations (
  device_id uuid not null references devices (device_id) on delete cascade,
  mutation_id uuid not null,
  payload_hash text not null,
  target_kind text not null,
  target_id text not null,
  target_version text not null,
  locale text not null,
  result_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (device_id, mutation_id)
);

create table feedback_send_rate (
  device_id uuid not null references devices (device_id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (device_id, window_start)
);

create table feedback_ip_rate (
  ip_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (ip_hash, window_start)
);

alter table feedback_target_registry enable row level security;
alter table feedback_current enable row level security;
alter table feedback_mutations enable row level security;
alter table feedback_send_rate enable row level security;
alter table feedback_ip_rate enable row level security;

revoke all on feedback_target_registry from anon, authenticated;
revoke all on feedback_current from anon, authenticated;
revoke all on feedback_mutations from anon, authenticated;
revoke all on feedback_send_rate from anon, authenticated;
revoke all on feedback_ip_rate from anon, authenticated;

grant select, insert, update, delete on feedback_target_registry to service_role;
grant select, insert, update, delete on feedback_current to service_role;
grant select, insert, update, delete on feedback_mutations to service_role;
grant select, insert, update, delete on feedback_send_rate to service_role;
grant select, insert, update, delete on feedback_ip_rate to service_role;
