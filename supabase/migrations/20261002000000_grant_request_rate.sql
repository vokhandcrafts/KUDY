-- G20.26 — per-device fixed-window request counter for POST /v1/grant
-- (network-privacy N8: after the device identity check, before the RevenueCat
-- call; the authenticated device is the natural bucket — the event_send_rate
-- idiom of G09.02 — and the raw IP is never stored).
-- Device delete cascades: the counter is device-owned service-role data and
-- dies with the device row (09 §5 DELETE /v1/device, G09.03 retention).
-- Rollback/recovery: `drop table grant_request_rate;` removes only the
-- counters — the grant gate then fails closed (its increment can no longer
-- return a valid attempt count, and a limiter fault never opens the gate),
-- so the rollback degrades to 503, never to an unguarded provider path;
-- re-running this migration restores the table.
create table grant_request_rate (
  device_id uuid not null references devices (device_id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (device_id, window_start)
);

alter table grant_request_rate enable row level security;

revoke all on grant_request_rate from anon, authenticated;

grant select, insert, update, delete on grant_request_rate to service_role;
