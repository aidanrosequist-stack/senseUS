-- senseUS: Move daily/weekly report aggregation server-side
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #13):
-- Both send-daily-report and send-weekly-report pulled entire (or,
-- for the daily domain-breakdown query, completely unwindowed) tables
-- into Deno function memory to aggregate in JS — each doing two separate
-- full scans of `votes` for two different aggregations that could come
-- from one GROUP BY each, plus an N+1 (a separate round trip per "top
-- question" just to fetch its text). Same 1000-row PostgREST default
-- applies to a plain .select() — once votes/profiles exceed that, these
-- reports were starting to silently under-report with no error, and
-- getting closer to the edge function execution timeout every quarter
-- as the underlying tables grow.
--
-- FIX:
-- Four RPCs doing GROUP BY aggregation in Postgres instead. p_since is
-- optional (null = all-time) on the two that need it, so the same
-- function serves both the weekly report's all-time views and the daily
-- report's 24h-windowed ones instead of duplicating the query.
--
-- Trust model: these run only from the report edge functions under the
-- service_role key (see isAuthorized() in each function, which checks
-- the caller presented the service role key itself) — they're revoked
-- from anon/authenticated/public below, same pattern already used for
-- other backend-only functions like run_security_checks and
-- calculate_badges (migration 014). They are NOT added to
-- intentionally_public_functions since that allowlist is for the
-- opposite case (functions intentionally granted to client roles).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_report_top_questions(p_limit int DEFAULT 5, p_since timestamptz DEFAULT NULL)
 RETURNS TABLE(question_id uuid, text text, votes bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select q.id as question_id, q.text, count(v.id) as votes
  from public.votes v
  join public.questions q on q.id = v.question_id
  where p_since is null or v.created_at >= p_since
  group by q.id, q.text
  order by votes desc
  limit greatest(1, least(coalesce(p_limit, 5), 100));
$function$;

CREATE OR REPLACE FUNCTION public.get_report_domain_breakdown(p_since timestamptz DEFAULT NULL)
 RETURNS TABLE(domain text, votes bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select q.domain, count(v.id) as votes
  from public.votes v
  join public.questions q on q.id = v.question_id
  where (p_since is null or v.created_at >= p_since)
    and q.domain is not null
  group by q.domain
  order by votes desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_report_integrity_distribution()
 RETURNS TABLE(bucket text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    case
      when integrity_weight = 1.0 then '1.0000'
      when integrity_weight <= 1.002 then '1.0001–1.0020'
      else '1.0021–1.0050'
    end as bucket,
    count(*) as count
  from public.profiles
  group by 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_report_badge_holder_count()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)
  from public.profiles
  where badges is not null and array_length(badges, 1) > 0;
$function$;

revoke execute on function public.get_report_top_questions(int, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_report_domain_breakdown(timestamptz) from public, anon, authenticated;
revoke execute on function public.get_report_integrity_distribution() from public, anon, authenticated;
revoke execute on function public.get_report_badge_holder_count() from public, anon, authenticated;
