-- senseUS: Move AdminReports dashboard aggregation server-side
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #12):
-- AdminReports.jsx's 60-second poll fetched every profiles and votes row
-- from the last 30 days with no limit, just to bucket them into a
-- 30-point daily chart in JS — at meaningful vote volume this becomes a
-- multi-MB payload every minute. Separately, the "top 20 by votes" table
-- fetched the 400 most-recently-created questions and sorted THOSE
-- client-side by vote count — since the bound was on recency, not votes,
-- any older high-engagement question outside that 400-row window could
-- never surface once the catalog exceeds ~400, silently returning the
-- wrong ranking rather than just a slow one. The query also pulled a
-- votes(count) nested aggregate that was fetched and never used.
--
-- FIX:
-- Two admin-only RPCs doing the aggregation in Postgres:
--   get_daily_activity   — one GROUP BY per day, for both series at once
--   get_top_questions_by_votes — ranks ALL questions by vote count in the
--                                 database, not a 400-row client slice
-- Both are gated by is_admin_user() (same check used elsewhere in the
-- admin surface, e.g. activate_sponsored_question in migration 014) since
-- they return platform-wide aggregate data, not scoped to the caller.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_daily_activity(p_since timestamptz)
 RETURNS TABLE(day date, registrations bigint, votes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  with days as (
    select generate_series(date_trunc('day', p_since)::date, current_date, interval '1 day')::date as day
  ),
  reg as (
    select date_trunc('day', p.created_at)::date as day, count(*) as c
    from public.profiles p
    where p.created_at >= p_since
    group by 1
  ),
  v as (
    select date_trunc('day', vt.created_at)::date as day, count(*) as c
    from public.votes vt
    where vt.created_at >= p_since
    group by 1
  )
  select d.day, coalesce(reg.c, 0)::bigint, coalesce(v.c, 0)::bigint
  from days d
  left join reg on reg.day = d.day
  left join v on v.day = d.day
  order by d.day;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_questions_by_votes(p_limit int DEFAULT 20)
 RETURNS TABLE(id uuid, text text, domain text, human_moderation_required boolean, created_at timestamptz, vote_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select q.id, q.text, q.domain, q.human_moderation_required, q.created_at, count(v.id) as vote_count
  from public.questions q
  left join public.votes v on v.question_id = q.id
  group by q.id, q.text, q.domain, q.human_moderation_required, q.created_at
  order by vote_count desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

grant execute on function public.get_daily_activity(timestamptz) to authenticated;
grant execute on function public.get_top_questions_by_votes(int) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since these
-- functions now have authenticated EXECUTE grants that aren't yet on the
-- allowlist it checks against. Both are admin-gated internally via
-- is_admin_user(), same reasoning already recorded for
-- activate_sponsored_question in migration 014.
insert into public.intentionally_public_functions (function_name, note) values
  ('get_daily_activity', 'Client RPC (AdminReports.jsx) — admin-only, enforced inside the function via is_admin_user(); replaces an unbounded 30-day profiles/votes fetch aggregated in JS'),
  ('get_top_questions_by_votes', 'Client RPC (AdminReports.jsx) — admin-only, enforced inside the function via is_admin_user(); ranks all questions by vote count in Postgres instead of sorting a 400-row recency-bounded client slice')
on conflict (function_name) do nothing;
