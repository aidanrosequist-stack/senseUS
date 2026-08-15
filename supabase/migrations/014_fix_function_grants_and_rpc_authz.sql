-- migration: 014_fix_function_grants_and_rpc_authz.sql
--
-- Follow-up to running run_security_checks() for the first time
-- (2026-08-15), which flagged 29 functions with anon/authenticated
-- EXECUTE grants outside the allowlist. Investigated all 29
-- individually — reading each function's body, checking whether it's
-- called from the frontend, and checking whether any RLS policy
-- depends on it — rather than guessing from names. Three findings:
--
-- 1. Several functions migration 008 already believed it had locked
--    down (call_alert_function, calculate_all_integrity_weights,
--    run_integrity_checks, etc.) are STILL callable by anon/authenticated
--    right now. Not new drift: migration 008 only ran
--    `revoke ... from public`, but Supabase grants EXECUTE on every
--    new function directly to anon/authenticated by default, separate
--    from the PUBLIC pseudo-role. Revoking from PUBLIC alone never
--    touched those direct grants. Confirmed directly: run_security_checks()
--    itself, created and revoked-from-public in migration 013 minutes
--    before this was discovered, was ALSO still flagged. This
--    migration revokes from public, anon, AND authenticated explicitly
--    for every function that should be internal-only.
--
-- 2. activate_sponsored_question (called from Admin.jsx) had NO
--    ownership/admin check at all — unlike every other admin-triggered
--    RPC in this codebase. Any authenticated user could call it
--    directly via supabase.rpc() and activate any pending sponsorship
--    themselves, bypassing the admin approval step entirely. Fixed
--    with the same is_admin_user() check already used elsewhere.
--
-- 3. get_candidate_questions (called from useQuestions.js) trusted
--    p_user_id from the client with no check it matched the caller.
--    Any authenticated user could pass another user's UUID and see
--    which specific questions that person has or hasn't
--    answered/skipped yet — not their vote choices, but still
--    behavioral data about a specific named person they shouldn't be
--    able to pull directly. Fixed by folding `p_user_id = auth.uid()`
--    into the query itself (LANGUAGE sql, so no exception-raising —
--    a mismatched call now just returns zero rows, matching the
--    silent-denial philosophy already used in protect_admin_columns,
--    migration 011).
--
-- The remaining flagged functions are trigger functions (RETURNS
-- trigger) — Postgres refuses to invoke those outside an actual
-- trigger context regardless of grants, the same reasoning migration
-- 008 already used to leave moderate_comment/protect_admin_columns
-- alone. Left untouched here for the same reason.
--
-- 4. That last point turned into its own small bug: run_security_checks()'s
-- own check_unauthorized_admin_grant() (migration 013's trigger
-- function) got flagged by the very first live run, for exactly the
-- reason above — it's a trigger function, so the flag is harmless, but
-- nothing told the check that. Every trigger function in this codebase
-- would flag the same way forever unless each one gets manually added
-- to the allowlist one at a time. Fixed properly instead: the check
-- itself now excludes anything whose return type is `trigger`, since
-- that's the actual, structural reason it's safe — not something that
-- should depend on a maintained list. Updated in both
-- run_security_checks() (below) and supabase/ci/security_checks.sql
-- (kept in sync by hand, same as noted in that file).
-- ============================================================


-- ============================================================
-- FIX 1: activate_sponsored_question — add the missing admin check
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_sponsored_question(p_sponsored_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_question_id uuid;
  v_sponsor_name text;
  v_domain text;
  v_duration_days integer;
  v_live_political_count integer;
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  select sq.question_id, sq.sponsor_name, sq.duration_days, q.domain
  into v_question_id, v_sponsor_name, v_duration_days, v_domain
  from sponsored_questions sq
  join questions q on q.id = sq.question_id
  where sq.id = p_sponsored_id;

  if v_domain = 'politics & policy' then
    select count(*) into v_live_political_count
    from sponsored_questions sq2
    join questions q2 on q2.id = sq2.question_id
    where q2.domain = 'politics & policy' and sq2.status = 'live';

    if v_live_political_count >= 2 then
      raise exception 'Both political sponsorship slots are currently full.';
    end if;

    if exists (
      select 1 from sponsored_questions sq3
      join questions q3 on q3.id = sq3.question_id
      where sq3.sponsor_name = v_sponsor_name
        and q3.domain = 'politics & policy'
        and sq3.archived_at is not null
        and sq3.archived_at > now() - interval '90 days'
    ) then
      raise exception 'This sponsor is in cooldown and cannot activate another political sponsorship yet.';
    end if;

    if exists (
      select 1 from sponsored_questions sq4
      join questions q4 on q4.id = sq4.question_id
      where sq4.sponsor_name = v_sponsor_name
        and q4.domain = 'politics & policy'
        and sq4.status = 'live'
    ) then
      raise exception 'This sponsor already has a live political sponsorship.';
    end if;
  end if;

  update sponsored_questions
  set status = 'live', live_at = now()
  where id = p_sponsored_id;

  update questions
  set is_sponsored = true,
      sponsor_id = p_sponsored_id,
      published_at = coalesce(published_at, now()),
      archive_at = now() + (v_duration_days || ' days')::interval
  where id = v_question_id;
end;
$function$;


-- ============================================================
-- FIX 2: get_candidate_questions — self-only, enforced in the query
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_candidate_questions(p_user_id uuid, p_country_code text, p_limit integer DEFAULT 75)
 RETURNS SETOF questions
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select q.*
  from questions q
  where p_user_id = auth.uid()
    and q.published_at is not null
    and q.published_at <= now()
    and q.archived_at is null
    and not exists (select 1 from votes v where v.user_id = p_user_id and v.question_id = q.id)
    and not exists (select 1 from question_skips s where s.user_id = p_user_id and s.question_id = q.id)
  order by
    case
      when q.geo_scope in ('global', 'country_own') then 0
      when q.geo_scope in ('country', 'regional') and q.country_code = p_country_code then 0
      else 1
    end,
    random()
  limit p_limit;
$function$;


-- ============================================================
-- FIX 3: real grant lockdown — public, anon, AND authenticated
--
-- CREATE OR REPLACE above preserves existing grants (confirmed
-- Postgres behavior), so FIX 1/2 didn't touch these functions' access
-- — they still need their own explicit lockdown below. postgres and
-- service_role keep access throughout (cron jobs and Edge Functions
-- using the service-role key are unaffected).
-- ============================================================

revoke execute on function public.call_alert_function(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.call_alert_function(text, text, text, jsonb) to postgres, service_role;

revoke execute on function public.log_anomaly_only(text, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.log_anomaly_only(text, text, jsonb, uuid, text) to postgres, service_role;

revoke execute on function public.calculate_all_integrity_weights() from public, anon, authenticated;
grant execute on function public.calculate_all_integrity_weights() to postgres, service_role;

revoke execute on function public.calculate_badges() from public, anon, authenticated;
grant execute on function public.calculate_badges() to postgres, service_role;

revoke execute on function public.reset_expired_streaks() from public, anon, authenticated;
grant execute on function public.reset_expired_streaks() to postgres, service_role;

revoke execute on function public.run_integrity_checks() from public, anon, authenticated;
grant execute on function public.run_integrity_checks() to postgres, service_role;

revoke execute on function public.check_pending_alert_emails() from public, anon, authenticated;
grant execute on function public.check_pending_alert_emails() to postgres, service_role;

revoke execute on function public.archive_due_questions() from public, anon, authenticated;
grant execute on function public.archive_due_questions() to postgres, service_role;

revoke execute on function public.take_question_snapshots() from public, anon, authenticated;
grant execute on function public.take_question_snapshots() to postgres, service_role;

-- run_security_checks() itself gets its grant fix as part of FIX 4
-- below, alongside the trigger-function exclusion fix — both touch
-- the same function, no point doing it twice.


-- ============================================================
-- FIX 4: exclude trigger functions from the grants check by nature,
-- not by allowlist upkeep. Same check as migration 013's
-- run_security_checks(), plus one line: trigger functions are simply
-- never counted as "unexpected," full stop.
-- ============================================================
create or replace function public.run_security_checks()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  unprotected_tables text[];
  unexpected_grants text[];
  protect_fn_body text;
  unprotected_columns text[];
  col record;
  unauthorized_admins jsonb;
begin

  -- 1. Every public table should have RLS enabled.
  select array_agg(relname order by relname) into unprotected_tables
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relkind = 'r'
    and relrowsecurity = false;

  if unprotected_tables is not null and array_length(unprotected_tables, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('RLS is disabled on %s public table(s): %s', array_length(unprotected_tables, 1), array_to_string(unprotected_tables, ', ')),
      jsonb_build_object('check', 'rls_disabled', 'tables', unprotected_tables)
    );
  end if;

  -- 2. No non-trigger function should have anon/authenticated EXECUTE
  -- unless it's on the intentionally_public_functions allowlist.
  -- Trigger functions are excluded structurally (data_type = 'trigger'
  -- in information_schema.routines) — Postgres refuses to invoke them
  -- outside a real trigger context no matter what's granted, so a
  -- grant on one is never itself the problem.
  select array_agg(distinct rp.routine_name order by rp.routine_name) into unexpected_grants
  from information_schema.routine_privileges rp
  join information_schema.routines r
    on r.routine_schema = rp.routine_schema and r.routine_name = rp.routine_name
  where rp.routine_schema = 'public'
    and rp.grantee in ('anon', 'authenticated')
    and r.data_type != 'trigger'
    and rp.routine_name not in (select function_name from public.intentionally_public_functions);

  if unexpected_grants is not null and array_length(unexpected_grants, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s function(s) are callable by anon/authenticated but are not on the intentionally_public_functions allowlist: %s', array_length(unexpected_grants, 1), array_to_string(unexpected_grants, ', ')),
      jsonb_build_object('check', 'unexpected_function_grants', 'functions', unexpected_grants)
    );
  end if;

  -- 3. Every profiles column must be either client-writable or
  -- actively locked in protect_admin_columns().
  select pg_get_functiondef('public.protect_admin_columns()'::regprocedure) into protect_fn_body;

  unprotected_columns := array[]::text[];
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name not in (select column_name from public.profiles_client_writable_columns)
  loop
    if protect_fn_body !~ ('new\.' || col.column_name || '\s*:=') then
      unprotected_columns := array_append(unprotected_columns, col.column_name);
    end if;
  end loop;

  if array_length(unprotected_columns, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s profiles column(s) are neither client-writable nor locked by protect_admin_columns(): %s', array_length(unprotected_columns, 1), array_to_string(unprotected_columns, ', ')),
      jsonb_build_object('check', 'unprotected_profile_columns', 'columns', unprotected_columns)
    );
  end if;

  -- 4. Admin allowlist backstop.
  select jsonb_agg(jsonb_build_object('id', id, 'anon_name', anon_name, 'created_at', created_at))
  into unauthorized_admins
  from public.profiles
  where is_admin = true
    and id not in (select user_id from public.authorized_admins);

  if unauthorized_admins is not null then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s profile(s) have is_admin = true but are not in authorized_admins.', jsonb_array_length(unauthorized_admins)),
      jsonb_build_object('check', 'unauthorized_admin', 'profiles', unauthorized_admins)
    );
  end if;

end;
$$;

revoke execute on function public.run_security_checks() from public, anon, authenticated;
grant execute on function public.run_security_checks() to postgres, service_role;


-- ============================================================
-- FIX 5: allowlist the confirmed-legitimate public RPCs
-- ============================================================
insert into public.intentionally_public_functions (function_name, note) values
  ('get_vote_tally', 'Client RPC (Vote.jsx, QuestionPreview.jsx) — read-only vote tally, no sensitive data'),
  ('get_vote_tallies_batch', 'Client RPC (Activity.jsx, AdminReports.jsx, useQuestions.js) — same as get_vote_tally, batched'),
  ('activate_sponsored_question', 'Client RPC (Admin.jsx) — admin-only action, ownership enforced inside the function as of migration 014'),
  ('get_candidate_questions', 'Client RPC (useQuestions.js) — self-only, enforced inside the function as of migration 014'),
  ('is_admin_user', 'Not a client RPC, but must stay callable by authenticated: used inside the "Admins can view all profiles" RLS policy on profiles. Revoking this breaks profile lookups for every logged-in user, not just non-admins.')
on conflict (function_name) do nothing;


-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the lockdown actually took this time:
--    select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and grantee in ('anon','authenticated')
--    and routine_name in ('call_alert_function','log_anomaly_only',
--      'calculate_all_integrity_weights','calculate_badges',
--      'reset_expired_streaks','run_integrity_checks',
--      'check_pending_alert_emails','archive_due_questions',
--      'take_question_snapshots','run_security_checks');
--    -> should return zero rows.
--
-- 2. Confirm the app still works: activate a sponsorship as yourself
--    (should still work, you're the admin), and load the question
--    feed as a normal logged-in test account (should still work,
--    querying your own candidate questions).
--
-- 3. Re-run the full check:
--    select public.run_security_checks();
--    select count(*) from anomaly_log where triggered_at > now() - interval '5 minutes';
--    -> should be 0.
-- ============================================================
