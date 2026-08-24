-- senseUS: Move the audience-targeted Admin Broadcast tool server-side
--
-- PROBLEM (same bug class as scaling audit finding #11, migration 023 —
-- that migration only covered "push as breaking news"; this is the other
-- broadcast tool on the same page, Admin.jsx's "Broadcast" tab):
-- the Send Broadcast handler fetched every matching profile id to the
-- client via `supabase.from("profiles").select("id")` with no limit, and
-- for the "active users" audience also fetched every `votes` row from the
-- last 30 days with no limit just to dedupe user ids in JS. PostgREST caps
-- an unbounded select at 1000 rows by default — today this genuinely
-- reaches every matching user, but once either the user base or vote
-- volume crosses that cap, this would silently notify only a subset, with
-- no error and no indication to the admin. The client then built the full
-- notification array itself and sent it in one `.insert()` call, which
-- also doesn't scale indefinitely as a single request payload.
--
-- FIX:
-- broadcast_admin_notification does the audience filtering and the
-- notification insert entirely server-side via INSERT ... SELECT, so
-- there's no client-side row cap to hit no matter how large the user base
-- or vote history gets, and no round trip of user ids through the client
-- at all. A `p_dry_run` flag lets the same filter logic run as a plain
-- COUNT for the pre-send confirmation dialog (mirroring the confirm-count
-- pattern already used for "push as breaking news"), so the preview count
-- and the actual send can never drift apart from each other — they're
-- the exact same WHERE clause, not two hand-kept-in-sync copies of it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.broadcast_admin_notification(
  p_title text,
  p_body text,
  p_priority text,
  p_action_url text,
  p_audience text,
  p_country_code text DEFAULT NULL,
  p_age_min int DEFAULT NULL,
  p_age_max int DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
 RETURNS TABLE(notified_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_year int := date_part('year', now())::int;
  v_count bigint;
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  if p_audience not in ('all', 'active', 'country', 'age', 'country_age') then
    raise exception 'Invalid audience: %', p_audience;
  end if;

  if not p_dry_run and (p_title is null or btrim(p_title) = '' or p_body is null or btrim(p_body) = '') then
    raise exception 'Title and message are required.';
  end if;

  if p_dry_run then
    select count(*) into v_count
    from public.profiles p
    where
      (p_audience <> 'active' or p.id in (
        select distinct user_id from public.votes
        where created_at >= now() - interval '30 days'
      ))
      and (p_audience not in ('country', 'country_age') or p_country_code is null or p.country_code = p_country_code)
      and (p_audience not in ('age', 'country_age') or p_age_min is null or p.birth_year <= v_current_year - p_age_min)
      and (p_audience not in ('age', 'country_age') or p_age_max is null or p.birth_year >= v_current_year - p_age_max);

    return query select v_count;
    return;
  end if;

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  select
    p.id,
    'admin_broadcast',
    p_priority,
    p_title,
    p_body,
    p_action_url
  from public.profiles p
  where
    (p_audience <> 'active' or p.id in (
      select distinct user_id from public.votes
      where created_at >= now() - interval '30 days'
    ))
    and (p_audience not in ('country', 'country_age') or p_country_code is null or p.country_code = p_country_code)
    and (p_audience not in ('age', 'country_age') or p_age_min is null or p.birth_year <= v_current_year - p_age_min)
    and (p_audience not in ('age', 'country_age') or p_age_max is null or p.birth_year >= v_current_year - p_age_max);

  get diagnostics v_count = row_count;

  return query select v_count;
end;
$function$;

grant execute on function public.broadcast_admin_notification(text, text, text, text, text, text, int, int, boolean) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('broadcast_admin_notification', 'Client RPC (Admin.jsx, Broadcast tab) — admin-only, enforced inside the function via is_admin_user(); filters recipients (all/active/country/age) and inserts their notifications entirely server-side, replacing a client round trip of profile and vote ids that was silently capped at 1000 rows by PostgREST''s default row limit. p_dry_run=true runs the same filter as a COUNT only, used for the pre-send confirmation number.')
on conflict (function_name) do nothing;
