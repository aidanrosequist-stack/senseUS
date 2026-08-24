-- senseUS: fix a regression in run_security_checks()'s unexpected-grants
-- check, introduced by this project's own recent work.
--
-- BACKGROUND: migration 014 (2026-08-15) deliberately excluded trigger
-- functions (RETURNS trigger) from the "callable by anon/authenticated"
-- check — Postgres refuses to invoke a trigger function outside a real
-- trigger context regardless of what's granted, so a stray anon/
-- authenticated EXECUTE grant on one is structurally harmless, not a
-- real gap. 014's version joined information_schema.routine_privileges
-- to information_schema.routines and filtered r.data_type != 'trigger'.
--
-- REGRESSION: migrations 033 and 034 (2026-08-22) each did a fresh
-- CREATE OR REPLACE FUNCTION run_security_checks() to add the heartbeat
-- call and the protective-trigger-coverage check, and both rebuilt
-- check #2's query from an older copy that predates 014's fix — losing
-- the join + trigger-type filter without anyone intending to. Confirmed
-- by re-reading every version of this function across migration
-- history side by side; 014's is the only one with the filter, and
-- both 033 and 034 are missing it.
--
-- IMPACT: every trigger function in the codebase (currently 16:
-- block_archived_question_votes, check_admin_action_volume,
-- check_coordinated_signup, check_flagged_question,
-- check_new_transparency_event, check_registration_spike,
-- check_unauthorized_admin_grant, check_vote_manipulation,
-- handle_updated_at, log_vote_change, moderate_comment,
-- protect_admin_columns, protect_comment_computed_columns,
-- require_recovery_email_for_export, secure_vote_fields, update_streak)
-- has been failing this check on every run since migration 033 shipped.
-- This was invisible until migration 035 (same pass) finally made alert
-- email delivery reliable enough to actually reach an inbox — the
-- underlying grants were never the problem; the monitoring code was.
-- No actual security exposure: confirmed all 16 are RETURNS trigger by
-- reading each definition directly, matching 014's own reasoning.
--
-- FIX: restore 014's join + filter, otherwise identical to 034's
-- version (heartbeat call and protective-trigger-coverage check both
-- kept). Only check #2's query changes.
--
-- Tested against a local Postgres instance with all 36 migrations
-- applied in order: confirmed the 16-function false alarm reproduces
-- exactly against 000-035, and is silent after this migration while a
-- deliberately-introduced non-trigger function with an anon grant
-- still correctly alerts (i.e. this restores 014's intent rather than
-- disabling the check).
--
-- NOTE for Aidan: supabase/ci/security_checks.sql (referenced in 014's
-- own comments as "kept in sync by hand") wasn't staged into this
-- session, so I couldn't check or update it here — worth a quick look
-- to confirm it matches this version too, same as 014 called for.
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
  -- migration 008 — the policies are silently inert.
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
  -- on the deliberate allowlist above — EXCEPT trigger functions
  -- (RETURNS trigger), which are excluded structurally: Postgres
  -- refuses to invoke those outside a real trigger context no matter
  -- what's granted, so a grant on one is never itself the problem.
  -- This is migration 014's original fix, restored here after 033/034
  -- silently reverted it (see this migration's header comment).
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

  perform public.record_function_heartbeat('run_security_checks');
end;
$function$;

-- Grants/schedule unchanged — CREATE OR REPLACE above only changes the
-- function body.


-- ============================================================
-- One-time verification (run manually after this migration is applied):
--
-- select public.run_security_checks();
-- select * from anomaly_log where details->>'check' = 'unexpected_function_grants' order by triggered_at desc limit 1;
-- -- Should show no new row (or, if you want to force a fresh read
-- -- rather than trust dedup/timing, temporarily run the query inside
-- -- check #2 by hand and confirm it returns zero rows).
-- ============================================================
