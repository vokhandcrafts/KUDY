-- G08.02 — product → route/tier mapping (docs/architecture/09 §5 «Мяжа
-- /grant»: the server finds the product for route_id × tier itself; the
-- client never chooses product_id or the storage bucket). Exactly one product
-- per (route_id, tier) — the unique constraint is the schema-level form of
-- the spike's `findProduct` single-match rule: a second row for the same pair
-- is rejected by the database instead of resolved by guesswork.
--
-- The grant flow reads this table through the service role only. Deny-by-
-- default in the same two stacked layers as 20260922120000_device_tables_rls.sql
-- (REVOKE from clients + RLS without permissive policies); rows are managed
-- by the operator through the service role.

create table grant_products (
  product_id text primary key,
  route_id text not null,
  tier text not null,
  unique (route_id, tier)
);

alter table grant_products enable row level security;

revoke all on grant_products from anon, authenticated;

grant select, insert, update, delete on grant_products to service_role;
