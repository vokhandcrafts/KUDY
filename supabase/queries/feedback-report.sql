-- G16.04 — the author report query (docs/architecture/21 §6): one read-only
-- aggregate operation over the current non-deleted rating rows. The author
-- runs it through the existing administrative access (MFA admin, dashboard
-- or psql); it is never wired into an Edge Function and never granted to a
-- role — anon/authenticated stay revoked on the feedback tables
-- (20261004000000), so no mobile credential can read aggregates.
--
-- Each output row is one full target key (kind, id, version, locale):
-- guide/place are never merged, and different versions or content locales
-- stay separate rows by default (21 §6: «Не змешвае guide/place; агрэгат па
-- розных версіях толькі яўны і падпісаны» — no cross-version merge ships).
-- Everything is computed on the fly from current rows; no rolling totals
-- are persisted anywhere, so an edit or a delete changes the next
-- calculation immediately.
--
-- The column list is an allowlist: no device or mutation identity, no raw
-- feedback rows — the export builder (tools/feedback-report/export.mjs)
-- refuses any row carrying a field outside this list.
--
-- Field semantics: first_rated_at/last_rated_at are min/max updated_at of
-- the SURVIVING current rows — an edit moves the row's updated_at forward,
-- so first_rated_at is «earliest surviving change», never «first ever
-- rating» (a superseded or deleted vote does not count).
--
-- Single source: tools/feedback-report and the tests read this file; do not
-- restate the query elsewhere (implementation-rules 2).

with current_rows as (
  select target_kind, target_id, target_version, locale, score, reason_codes, updated_at
  from feedback_current
  where deleted_at is null
),
reasons as (
  select
    target_kind, target_id, target_version, locale,
    jsonb_object_agg(code, n) as reason_counts
  from (
    select
      target_kind, target_id, target_version, locale,
      jsonb_array_elements_text(reason_codes) as code,
      count(*) as n
    from current_rows
    group by target_kind, target_id, target_version, locale, code
  ) per_code
  group by target_kind, target_id, target_version, locale
)
select
  c.target_kind,
  c.target_id,
  c.target_version,
  c.locale,
  count(*)::bigint as rating_count,
  round(avg(c.score), 2) as mean_score,
  count(*) filter (where c.score = 1)::bigint as hist_1,
  count(*) filter (where c.score = 2)::bigint as hist_2,
  count(*) filter (where c.score = 3)::bigint as hist_3,
  count(*) filter (where c.score = 4)::bigint as hist_4,
  count(*) filter (where c.score = 5)::bigint as hist_5,
  min(c.updated_at) as first_rated_at,
  max(c.updated_at) as last_rated_at,
  coalesce(r.reason_counts, '{}'::jsonb) as reason_counts
from current_rows c
left join reasons r
  on r.target_kind = c.target_kind
 and r.target_id = c.target_id
 and r.target_version = c.target_version
 and r.locale = c.locale
group by c.target_kind, c.target_id, c.target_version, c.locale, r.reason_counts
order by c.target_kind, c.target_id, c.target_version, c.locale;
