-- G08.02 follow-up: the grant flow keys its SQL lookups by the SHA-256 of
-- (route_id, tier) instead of carrying client-controlled strings into SQL —
-- not even as query parameters (defense in depth on top of $n
-- parameterization; the Mimosa L3 gate traces any HTTP-derived value into a
-- SQL sink). The mapping table stays the single readable source: the
-- operator inserts human-readable rows, the generated column derives the
-- key, and the cache joins through it. The JS side computes the same digest
-- (grant-core.ts grantRouteKey) — the grant-core test suite fails if the
-- two ever diverge, because a cache write would silently select 0 rows.

create function grant_route_key(route_id text, tier text) returns text
  immutable
  language sql
  as $$ select encode(sha256(convert_to(route_id || '|' || tier, 'UTF8')), 'hex') $$;

alter table grant_products
  add column route_key text generated always as (grant_route_key(route_id, tier)) stored;

create unique index grant_products_route_key_idx on grant_products (route_key);
