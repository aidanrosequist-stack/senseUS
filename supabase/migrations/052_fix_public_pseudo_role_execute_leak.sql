-- senseUS: fix a real gap in migration 050's own fix, found while testing
-- migration 051 -- and fix the monitoring check so it can't recur
-- invisibly.
--
-- PART 1 — WHAT WENT WRONG: migration 050 revoked EXECUTE "from anon"
-- (and set `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS
-- FROM anon, authenticated`) for 16 functions that should be
-- authenticated/admin-only. That missed something: in Postgres,
-- `CREATE FUNCTION` ALSO grants EXECUTE to the `PUBLIC` pseudo-role by
-- default -- a separate, older mechanism from the anon/
-- authenticated-specific default-privileges rule Supabase's own project
-- bootstrap additionally sets up. Every role, including `anon`, always
-- has whatever `PUBLIC` has -- it isn't role membership, it applies
-- unconditionally. So revoking "from anon" directly (or via a
-- default-privileges rule scoped to anon/authenticated) does nothing if
-- the function was ALSO, separately, granted to PUBLIC -- which, for
-- these 16 functions (created across migrations 014-050 with no
-- explicit PUBLIC revoke), it always was.
--
-- Confirmed directly: `select has_function_privilege('anon',
-- 'public.cast_vote(uuid,text)', 'EXECUTE')` returned `true` even after
-- migration 050. Migration 050's own test suite checked
-- `information_schema.routine_privileges` filtered to
-- `grantee = 'anon'`, which is a distinct row from the `PUBLIC` row --
-- so the check passed (the anon-specific grant really was gone) while
-- actual effective access (what `has_function_privilege` measures, and
-- what Postgres actually enforces at call time) hadn't changed at all.
--
-- Compare: migration 014's original lockdown of the backend-only cron
-- functions got this right --
-- `revoke execute on function ... from public, anon, authenticated;`
-- explicitly includes `public`. Migration 050 dropped that word for its
-- own 16 functions. This migration corrects it, without touching
-- migration 050's already-applied file (migrations are append-only once
-- shipped).
--
-- IMPACT: same as the original migration 050 finding -- every one of
-- these 16 functions already validates the caller internally
-- (`is_admin_user()`, an `auth.uid() is null` check, or a query
-- condition that silently returns nothing for a null caller), so this
-- was still defense-in-depth, not a live data leak.
--
-- PART 2 — WHY `ALTER DEFAULT PRIVILEGES ... FROM PUBLIC` ISN'T THE FIX,
-- AND WHAT ACTUALLY IS: tested directly against a clean local Postgres
-- 16 instance, isolated from every other migration: even after running
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC`, a freshly created function STILL has PUBLIC
-- EXECUTE. This isn't a mistake in how the command was written -- it's
-- a long-documented Postgres limitation (see PostgreSQL bug #8685 and
-- the "Alter Default Privileges Does Not Work For Functions" pgsql-bugs
-- thread): the PUBLIC-execute grant on a new function is synthesized
-- unconditionally at creation time, not sourced from the
-- default-privileges ACL system the way the anon/authenticated grants
-- are -- so there's no default-privileges setting that prevents it. The
-- anon/authenticated part of migration 050's `ALTER DEFAULT PRIVILEGES`
-- change IS real and confirmed working (verified again below); it's
-- specifically PUBLIC that this lever can't reach, for any Postgres
-- version.
--
-- Practical upshot: every future migration that adds a client RPC not
-- meant to be public still needs its own explicit
-- `REVOKE EXECUTE ... FROM PUBLIC` line, the same discipline migration
-- 014 already used -- there's no schema-level setting that makes this
-- automatic. What CAN be made automatic is catching it if someone
-- forgets: check #2 in `run_security_checks()` (and the CI script) only
-- ever watched `grantee in ('anon', 'authenticated')` -- exactly the two
-- values a PUBLIC-only grant does NOT show up as (it shows up as its own
-- `grantee = 'PUBLIC'` row instead, confirmed directly against
-- `information_schema.routine_privileges`). That check is updated below
-- to also watch `PUBLIC`, excluding functions owned by an installed
-- extension (pgcrypto's own utility functions -- armor, crypt, digest,
-- gen_random_uuid, the pgp_* family, etc. -- all live in the `public`
-- schema and are meant to stay broadly callable; structurally excluded
-- via `pg_depend`, the same "exclude by what it structurally is, not by
-- a maintained list" principle already used for trigger functions).
-- Now the exact bug this migration fixes -- a client RPC that keeps its
-- default PUBLIC grant because someone forgot the explicit revoke --
-- gets caught automatically going forward, in both the weekly
-- production sweep and CI, instead of requiring another manual audit
-- pass to notice.
-- ============================================================


-- ============================================================
-- PART 1: revoke the leftover PUBLIC grant on the 16 functions from
-- migration 050 (authenticated keeps its own separate, unaffected
-- grant), plus the one new function from migration 051 that was created
-- before this fix landed.
-- ============================================================

revoke execute on function public.accept_comparison_token(text) from public;
revoke execute on function public.activate_sponsored_question(uuid) from public;
revoke execute on function public.admin_search_questions(text, int) from public;
revoke execute on function public.broadcast_admin_notification(text, text, text, text, text, text, int, int, boolean) from public;
revoke execute on function public.broadcast_breaking_news(uuid) from public;
revoke execute on function public.cast_vote(uuid, text) from public;
revoke execute on function public.get_candidate_questions(uuid, text, integer) from public;
revoke execute on function public.get_candidate_questions(uuid, text, integer, text) from public;
revoke execute on function public.get_comment_reply_counts(uuid[]) from public;
revoke execute on function public.get_comparison(uuid) from public;
revoke execute on function public.get_daily_activity(timestamptz) from public;
revoke execute on function public.get_top_questions_by_votes(int) from public;
revoke execute on function public.get_vote_tallies_batch(uuid[]) from public;
revoke execute on function public.increment_flag_count(uuid) from public;
revoke execute on function public.log_admin_action(text, text, uuid, jsonb) from public;
revoke execute on function public.search_questions(text, int) from public;
revoke execute on function public.get_commenter_vote_choices(uuid, uuid[]) from public;


-- ============================================================
-- PART 2: run_security_checks() -- check #2 now also watches PUBLIC,
-- excluding extension-owned functions structurally. Otherwise unchanged
-- from migration 050's version.
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

  -- 2. No function should have anon/authenticated/PUBLIC EXECUTE unless
  -- it's on the deliberate allowlist above -- EXCEPT trigger functions
  -- (Postgres refuses to invoke those outside a real trigger context no
  -- matter what's granted) and functions owned by an installed
  -- extension (pgcrypto's utility functions and similar -- third-party
  -- code this project doesn't control the grants of and has no reason
  -- to restrict). UPDATED migration 050 (2026-08-28): now also watches
  -- `PUBLIC`, not just `anon`/`authenticated` -- a function that only
  -- has the Postgres-default PUBLIC grant (e.g. because a future
  -- migration forgot the explicit `revoke ... from public` a
  -- non-public client RPC needs) is just as reachable by anon as an
  -- explicit anon grant would be, and the old version of this check
  -- could not see it.
  select array_agg(distinct rp.routine_name order by rp.routine_name) into unexpected_grants
  from information_schema.routine_privileges rp
  join information_schema.routines r
    on r.routine_schema = rp.routine_schema and r.routine_name = rp.routine_name
  where rp.routine_schema = 'public'
    and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
    and r.data_type != 'trigger'
    and rp.routine_name not in (select function_name from public.intentionally_public_functions)
    and not exists (
      select 1
      from pg_proc p
      join pg_depend d on d.objid = p.oid and d.deptype = 'e'
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = rp.routine_schema and p.proname = rp.routine_name
    );

  if unexpected_grants is not null and array_length(unexpected_grants, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s function(s) are callable by anon/authenticated/PUBLIC but are not on the intentionally_public_functions allowlist: %s', array_length(unexpected_grants, 1), array_to_string(unexpected_grants, ', ')),
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

  -- 5. Protective triggers must cover every event they're expected to.
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

  -- 6. Any view granted to anon/authenticated must either be
  -- security_invoker=true or be on the intentionally_public_views
  -- allowlist. Unchanged from migration 050.
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

-- Grants/schedule unchanged.


-- ============================================================
-- One-time verification (SQL Editor, after applying) -- uses
-- has_function_privilege, which reflects ACTUAL effective access
-- (PUBLIC-inherited or not), unlike a routine_privileges row-existence
-- check:
--
-- select has_function_privilege('anon', 'public.cast_vote(uuid,text)', 'EXECUTE'),
--        has_function_privilege('anon', 'public.admin_search_questions(text,int)', 'EXECUTE'),
--        has_function_privilege('anon', 'public.get_commenter_vote_choices(uuid,uuid[])', 'EXECUTE'),
--        has_function_privilege('authenticated', 'public.cast_vote(uuid,text)', 'EXECUTE'),
--        has_function_privilege('anon', 'public.get_vote_tally(uuid)', 'EXECUTE');
-- -> expect: false, false, false, true, true.
--
-- select public.run_security_checks();
-- select count(*) from anomaly_log where triggered_at > now() - interval '5 minutes';
-- -> expect: 0.
-- ============================================================
