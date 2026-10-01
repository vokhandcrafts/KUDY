-- G09.02 — per-device fixed-window send counter for POST /v1/events
-- (09 §5: the events endpoint authenticates with the device secret; the
-- request limit is keyed by device, not by IP — an authenticated identity is
-- the natural bucket, and the raw IP is never stored, matching the
-- device_registration_rate idiom).
-- Device delete cascades: the counter is device-owned service-role data and
-- dies with the device row (09 §5 DELETE /v1/device, G09.03 retention).
create table event_send_rate (
  device_id uuid not null references devices (device_id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (device_id, window_start)
);

alter table event_send_rate enable row level security;

revoke all on event_send_rate from anon, authenticated;

grant select, insert, update, delete on event_send_rate to service_role;
