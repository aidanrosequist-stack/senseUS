-- senseUS: close the systemic gap that let public_votes/public_profiles
-- (migration 049) go unnoticed, on both fronts Aidan asked about after
-- reviewing the three follow-up audit queries pulled from Supabase
-- Studio on 2026-08-28.
--
-- CONTEXT: the anon-EXECUTE-on-nearly-every-function result (query 3)
-- traces back to the same root mechanism migration 014 already
-- documented for tables/views -- Supabase's project bootstrap runs its
-- own `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated` once, at project creation. Every `CREATE FUNCTION`
-- since then has been auto-granted EXECUTE to BOTH anon and
-- authenticated, regardless of what a migration's own explicit `grant
-- execute ... to authenticated` line says -- that line only adds,
-- REVOKE was never called for the anon side unless a migration did it
-- by hand (confirmed: repo-wide grep finds zero
-- `ALTER DEFAULT PRIVILEGES` statements anywhere, and only two
-- `revoke execute ... from ... anon` blocks, both in migration 014,
-- both for backend-only cron functions).
--
-- Migration 014 (2026-08-15) already caught and fixed this once, for
-- the functions that existed then -- but it fixed it by adding most
-- client RPCs to `intentionally_public_functions`, an allowlist that
-- only suppresses run_security_checks()'s alert. It does NOT revoke the
-- underlying anon grant. That was a deliberate, reasonable call at the
-- time (every one of those functions already validates the caller
-- internally -- see below), but it means every client RPC written
-- since 014 has quietly kept its default anon-EXECUTE grant, and the
-- allowlist has been growing to match rather than the actual grants
-- being tightened. Query 3's ~35-function result is that gap, made
-- visible.
--
-- ACTUAL RISK, function by function (read every one of the 15 below in
-- full before writing this): every single one already has its own
-- internal guard -- `if not is_admin_user() then raise exception`,
-- `if auth.uid() is null then raise exception`, or a query condition
-- that resolves to zero rows when auth.uid() is null (get_comparison's
-- `where mv.user_id = auth.uid()`, get_candidate_questions' `where
-- p_user_id = auth.uid()`). Calling any of these as a fully
-- unauthenticated request today fails cleanly or returns nothing -- NOT
-- the same failure mode as public_votes/public_profiles, which handed
-- back real rows with no check of any kind. So this migration is
-- defense-in-depth and closing off the actual "avoid this in the
-- future" gap Aidan asked about, not a second live-data leak.
--
-- Two functions genuinely are supposed to be anon-executable and are
-- untouched here: get_vote_tally (QuestionPreview.jsx, the public
-- /q/:number route) and get_sponsorship_reach_counts (SponsorWithUs.jsx,
-- the public /sponsor route) -- confirmed by reading every anon-reachable
-- route in App.jsx (/, /register, /login, /privacy, /terms, /mission,
-- /how-it-works, /transparency, /ethos, /sponsor, /q/:number) and
-- grepping each for supabase.rpc(...) calls. is_admin_user() is also
-- left untouched -- migration 014 already decided it must stay
-- authenticated-callable (used inside the "Admins can view all
-- profiles" RLS policy), and revoking it from anon risks turning a
-- clean "false" into a policy-evaluation permission error for any
-- anon-facing query path that happens to reference it, for zero actual
-- security benefit (it returns a boolean, no data).
--
-- FIX, three parts:
--   1. Explicitly revoke the anon EXECUTE grant on all 15 functions that
--      are authenticated-only or admin-only by design, alongside the
--      internal checks they already have.
--   2. ALTER DEFAULT PRIVILEGES so every function created FROM NOW ON
--      stops auto-granting EXECUTE to anon or authenticated at all --
--      matching what every migration examined already does in practice
--      (every client RPC in this codebase already has its own explicit
--      `grant execute ... to authenticated` line; none of them were
--      relying on the default). This is the actual "avoid this in the
--      future" fix for functions: a new RPC with no explicit grant line
--      is now unreachable by anyone but postgres/service_role, instead
--      of silently anon-and-authenticated-executable by default.
--   3. Extend run_security_checks() with a new check (#6) mirroring
--      check #2, but for VIEWS instead of functions: any view granted to
--      anon/authenticated that is security_invoker=false (bypasses RLS
--      for whoever it's granted to -- the exact mechanism migration 049
--      fixed) and isn't on a new intentionally_public_views allowlist
--      now fires the same critical alert check #2 already fires for
--      functions. This is the part that would have caught the original
--      public_votes/public_profiles bug automatically instead of
--      needing a secondhand comment to surface it.
--
-- Also captured here for the first time: public_sponsors
-- (`select question_id, sponsor_name from sponsored_questions where
-- status = 'live'`), found via query 1 -- like public_votes/
-- public_profiles before migration 049, it was set up by hand and never
-- in any migration file. Unlike those two, its exposure was already
-- narrow (2 non-sensitive columns, pre-filtered to live sponsorships) --
-- but it's read by Vote.jsx and useQuestions.js, both of which sit
-- behind routes that already require login, so the anon grant it
-- currently has (SELECT-only, not ALL -- confirmed via query 2) serves
-- no feature that actually needs it. Locked to authenticated-only,
-- matching public_votes/public_profiles, and captured in version
-- control for the first time.
-- ============================================================


-- ============================================================
-- PART 1: capture + lock down public_sponsors
-- ============================================================

CREATE OR REPLACE VIEW public.public_sponsors AS
 SELECT question_id,
    sponsor_name
   FROM public.sponsored_questions
  WHERE (status = 'live'::text);

COMMENT ON VIEW public.public_sponsors IS 'Curated public-facing slice of sponsored_questions (question_id + sponsor_name, live sponsorships only). security_invoker=false (the default) is intentional, same reasoning as public_profiles/public_votes. Locked to authenticated-only as of migration 050 (2026-08-28) -- previously also granted to anon (SELECT-only) despite no anon-reachable feature (Vote.jsx and useQuestions.js both sit behind login) actually using it.';

REVOKE ALL ON public.public_sponsors FROM anon, authenticated;
GRANT SELECT ON public.public_sponsors TO authenticated;


-- ============================================================
-- PART 2: revoke the default anon-EXECUTE grant on every function that
-- is authenticated-only or admin-only by design. authenticated keeps
-- exactly the grant each function's own migration already gave it --
-- only the anon side changes here.
-- ============================================================

revoke execute on function public.accept_comparison_token(text) from anon;
revoke execute on function public.activate_sponsored_question(uuid) from anon;
revoke execute on function public.admin_search_questions(text, int) from anon;
revoke execute on function public.broadcast_admin_notification(text, text, text, text, text, text, int, int, boolean) from anon;
revoke execute on function public.broadcast_breaking_news(uuid) from anon;
revoke execute on function public.cast_vote(uuid, text) from anon;
revoke execute on function public.get_candidate_questions(uuid, text, integer) from anon;
-- Migration 045 added a second overload (p_region text, 4th param) but
-- never dropped the original 3-arg one -- both still exist as distinct
-- functions with their own separate grants (confirmed via pg_proc),
-- so both need revoking here, not just whichever one useQuestions.js
-- calls today.
revoke execute on function public.get_candidate_questions(uuid, text, integer, text) from anon;
revoke execute on function public.get_comment_reply_counts(uuid[]) from anon;
revoke execute on function public.get_comparison(uuid) from anon;
revoke execute on function public.get_daily_activity(timestamptz) from anon;
revoke execute on function public.get_top_questions_by_votes(int) from anon;
revoke execute on function public.get_vote_tallies_batch(uuid[]) from anon;
revoke execute on function public.increment_flag_count(uuid) from anon;
revoke execute on function public.log_admin_action(text, text, uuid, jsonb) from anon;
revoke execute on function public.search_questions(text, int) from anon;


-- ============================================================
-- PART 3: stop the recurrence at the source -- new functions no longer
-- auto-grant EXECUTE to anon or authenticated. Every future client RPC
-- migration must keep doing what every past one already does: an
-- explicit `grant execute on function ... to authenticated` (or, in the
-- rare legitimately-public case, `to anon` too) right after
-- CREATE FUNCTION. postgres and service_role are untouched -- cron jobs
-- and Edge Functions using the service-role key are unaffected either
-- way, since they were never relying on this default.
-- ============================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;


-- ============================================================
-- PART 4: intentionally_public_views -- same shape and purpose as
-- intentionally_public_functions (013), for views instead of functions.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.intentionally_public_views (
  view_name text PRIMARY KEY,
  note text,
  added_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.intentionally_public_views (view_name, note) VALUES
  ('public_profiles', 'security_invoker=false is intentional -- exists specifically so any authenticated user can see this curated slice regardless of profiles'' own RLS (comment vote-coloring, Compare.jsx). Locked to authenticated-only, SELECT-only as of migration 049 (2026-08-28) -- previously also granted to anon and granted ALL.'),
  ('public_votes', 'security_invoker=false is intentional, see public_profiles. Locked to authenticated-only, SELECT-only as of migration 049 (2026-08-28) -- previously also granted to anon and granted ALL.'),
  ('public_sponsors', 'security_invoker=false is intentional -- shows which sponsor is behind a live sponsored question (Vote.jsx, useQuestions.js). Locked to authenticated-only as of migration 050 (2026-08-28) -- previously also granted to anon (SELECT-only) with no anon-reachable feature using it.'),
  ('sponsored_queue', 'security_invoker=true (migrations 039/047) -- already respects RLS on its own underlying tables for whoever queries it, included here for completeness so it is documented alongside the other three views rather than because this check would ever flag it.')
ON CONFLICT (view_name) DO NOTHING;

ALTER TABLE public.intentionally_public_views ENABLE ROW LEVEL SECURITY;
-- No policies added on purpose -- same "RLS enabled + zero policies =
-- anon/authenticated get nothing by default" pattern as
-- intentionally_public_functions and the other allowlist tables (013).


-- ============================================================
-- PART 5: run_security_checks() -- add check #6 (views), otherwise
-- unchanged from migration 036's version (the trigger-exclusion fix).
-- ============================================================

create or replace function public.run_security_checks()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  unprotected_tables text[];
  unexpected_grants text[];
  unexpected_view_grants text[];
  protect_fn_body text;
  unprotected_columns text[];
  col record;
  unauthorized_admins jsonb;
  trig record;
  missing_coverage text[];
  trig_type int;
begin

  -- 1. Every public table should have RLS enabled. A table with
  -- policies defined but RLS off is the exact failure mode fixed in
  -- migration 008 -- the policies are silently inert.
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

  -- 2. No function should have anon/authenticated EXECUTE unless it's
  -- on the deliberate allowlist above -- EXCEPT trigger functions
  -- (RETURNS trigger), which are excluded structurally: Postgres
  -- refuses to invoke those outside a real trigger context no matter
  -- what's granted, so a grant on one is never itself the problem.
  -- Unchanged from migration 036.
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

  -- 3. Every profiles column must be either client-writable (allowlist
  -- above) or actively locked in protect_admin_columns().
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

  -- 5. Protective triggers must cover every event they're expected to.
  -- Unchanged from migration 034.
  missing_coverage := array[]::text[];
  for trig in select * from public.protected_trigger_coverage loop
    select t.tgtype::int into trig_type
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where t.tgname = trig.trigger_name
      and c.relname = trig.table_name
      and c.relnamespace = 'public'::regnamespace
      and not t.tgisinternal;

    if trig_type is null then
      missing_coverage := array_append(missing_coverage, format('%s (not found on %s)', trig.trigger_name, trig.table_name));
    else
      if trig.expect_insert and (trig_type & 4) = 0 then
        missing_coverage := array_append(missing_coverage, format('%s missing INSERT coverage', trig.trigger_name));
      end if;
      if trig.expect_update and (trig_type & 16) = 0 then
        missing_coverage := array_append(missing_coverage, format('%s missing UPDATE coverage', trig.trigger_name));
      end if;
    end if;
    trig_type := null;
  end loop;

  if array_length(missing_coverage, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s protective trigger(s) have incomplete event coverage: %s', array_length(missing_coverage, 1), array_to_string(missing_coverage, '; ')),
      jsonb_build_object('check', 'protective_trigger_coverage', 'issues', missing_coverage)
    );
  end if;

  -- 6. NEW (migration 050). Any view granted to anon/authenticated must
  -- either be security_invoker=true (so granting it is exactly as safe
  -- as granting the underlying tables -- the caller's own RLS still
  -- applies) or be on the intentionally_public_views allowlist (a human
  -- has reviewed exactly what columns it exposes and to which role).
  -- security_invoker=false, the Postgres default, makes a view run as
  -- ITS OWNER, bypassing RLS on the underlying tables entirely for
  -- whichever role the view itself is granted to -- this is exactly the
  -- mechanism that let public_votes/public_profiles grant anon complete
  -- read access to every user's votes and profile for an unknown period
  -- before migration 049 (2026-08-28) caught it via a secondhand
  -- comment, not this check (which didn't exist yet). This check exists
  -- so the next one like it fires here instead.
  select array_agg(distinct c.relname order by c.relname) into unexpected_view_grants
  from information_schema.table_privileges tp
  join pg_class c
    on c.relname = tp.table_name
   and c.relnamespace = 'public'::regnamespace
  where tp.table_schema = 'public'
    and tp.grantee in ('anon', 'authenticated')
    and c.relkind = 'v'
    and not ('security_invoker=true' = any(coalesce(c.reloptions, array[]::text[])))
    and c.relname not in (select view_name from public.intentionally_public_views);

  if unexpected_view_grants is not null and array_length(unexpected_view_grants, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s view(s) are security_invoker=false (bypasses RLS for whoever they''re granted to) and callable by anon/authenticated but are not on the intentionally_public_views allowlist: %s', array_length(unexpected_view_grants, 1), array_to_string(unexpected_view_grants, ', ')),
      jsonb_build_object('check', 'unexpected_view_grants', 'views', unexpected_view_grants)
    );
  end if;

  perform public.record_function_heartbeat('run_security_checks');
end;
$function$;

-- Grants/schedule unchanged -- CREATE OR REPLACE above only changes the
-- function body.


-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the anon revokes took:
--    select routine_name from information_schema.routine_privileges
--    where routine_schema = 'public' and grantee = 'anon'
--    and routine_name in ('accept_comparison_token','activate_sponsored_question',
--      'admin_search_questions','broadcast_admin_notification',
--      'broadcast_breaking_news','cast_vote','get_candidate_questions',
--      'get_comment_reply_counts','get_comparison','get_daily_activity',
--      'get_top_questions_by_votes','get_vote_tallies_batch',
--      'increment_flag_count','log_admin_action','search_questions');
--    -> should return zero rows.
--
-- 2. Confirm the two intentionally-anon functions are untouched:
--    select routine_name from information_schema.routine_privileges
--    where routine_schema = 'public' and grantee = 'anon'
--    and routine_name in ('get_vote_tally','get_sponsorship_reach_counts');
--    -> should return both.
--
-- 3. Confirm public_sponsors is locked down:
--    select grantee, privilege_type from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'public_sponsors';
--    -> should show only authenticated / SELECT (plus postgres/service_role/
--    table owner rows, which is normal).
--
-- 4. Confirm the app still works end to end: load the public /q/:number
--    preview and /sponsor page signed out (both should still work), then
--    vote, view Activity, view a Conversation, use Compare, and (as
--    admin) use Admin.jsx's search, broadcast, and reports tabs signed in.
--
-- 5. Re-run the full check and confirm it's quiet:
--    select public.run_security_checks();
--    select count(*) from anomaly_log where triggered_at > now() - interval '5 minutes';
--    -> should be 0.
-- ============================================================
