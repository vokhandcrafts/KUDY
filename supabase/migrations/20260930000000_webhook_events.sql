-- G08.06 — the optional /v1/rc-webhook bookkeeping store
-- (docs/architecture/09 §5, §5.1). The webhook is accounting, not the grant
-- gate: the durable event log keyed by the RevenueCat event id (delivery is
-- at-least-once, retries reuse the id), with effects_applied marking the
-- idempotent effect replay of a crash between persist and the rights
-- effects. Not device-owned (the app_user_id of an event may be an alias),
-- so no device-delete cascade here; retention is G09.03's row.
create table webhook_events ( event_id text primary key, type text not null, event_at timestamptz, received_at timestamptz not null default now(), payload jsonb not null, effects_applied boolean not null default false );
alter table webhook_events enable row level security;
revoke all on webhook_events from anon, authenticated;
grant select, insert, update, delete on webhook_events to service_role;
