-- G08.01 — canonical server tables (docs/architecture/09 §4: Postgres holds
-- `devices`, `entitlements`-cache, `event_log`; writes only via Edge Functions
-- through the service role) and 19 §2.4 (migrations assigned to G08.01).
--
-- Deny-by-default in two stacked layers:
--   1. REVOKE from `anon`/`authenticated` — no grants even where the Supabase
--      default privileges would add them;
--   2. ENABLE ROW LEVEL SECURITY with no permissive policies — rows are
--      invisible and unwritable for clients even if a grant is re-added.
-- The client (anon key) therefore cannot read or write device rows directly;
-- only the service role (Edge Functions) touches these tables.
--
-- Portable check: runs on plain Postgres once the Supabase roles exist
-- (`anon`, `authenticated`, `service_role`); the RLS test in
-- supabase/functions/_shared/rls.test.ts creates them and applies this file.

create table devices (
  device_id uuid primary key,
  secret_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Positive grant cache only (`09` §5.1: refusals are never cached), TTL via
-- `expires_at`; payload holds the grant response of the owning G08.02 flow.
create table entitlement_cache (
  device_id uuid not null references devices (device_id) on delete cascade,
  route_id text not null,
  tier text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  primary key (device_id, route_id, tier)
);

-- Client-generated `event_id` is the idempotency key (`09` §5: батч падзей,
-- ідэмпатэнтна па event_id); device delete cascades (`09` §5, DELETE /v1/device).
create table event_log (
  event_id uuid primary key,
  device_id uuid not null references devices (device_id) on delete cascade,
  type text not null,
  at timestamptz not null,
  payload jsonb not null
);

-- Per-IP registration rate counter (`09` §5: rate-limit па IP). Keyed by
-- sha256(ip) — the raw address is never stored (`09` §6.1: no raw network
-- identifiers beyond what the platform already logs). Retention: old
-- (ip_hash, window_start) rows are deletable service-role data and get a
-- TTL sweep with the G09.03 retention job; until then rows are short-lived
-- counters, and the keyed hash is pseudonymization, not anonymization.
create table device_registration_rate (
  ip_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (ip_hash, window_start)
);

alter table devices enable row level security;
alter table entitlement_cache enable row level security;
alter table event_log enable row level security;
alter table device_registration_rate enable row level security;

revoke all on devices from anon, authenticated;
revoke all on entitlement_cache from anon, authenticated;
revoke all on event_log from anon, authenticated;
revoke all on device_registration_rate from anon, authenticated;

grant select, insert, update, delete on devices to service_role;
grant select, insert, update, delete on entitlement_cache to service_role;
grant select, insert, update, delete on event_log to service_role;
grant select, insert, update, delete on device_registration_rate to service_role;
