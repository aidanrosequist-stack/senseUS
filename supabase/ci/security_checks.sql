-- supabase/ci/security_checks.sql
--
-- CI counterpart to run_security_checks() (migration 013). Run against
-- a fresh local Supabase instance (all migrations applied, no manual
-- fixes) via:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/ci/security_checks.sql
--
-- Deliberately NOT the same function as run_security_checks(): that
-- one emails via call_alert_function(), which needs a Vault secret and
-- network egress to the deployed Edge Function — neither exists in a
-- throwaway CI database. This script re-implements the same three
-- schema/grant checks as plain assertions that RAISE EXCEPTION (and
-- therefore make psql exit non-zero) on failure, so a bad migration
-- fails the CI job instead of reaching production. It intentionally
-- does NOT include the admin-allowlist check from run_security_checks
-- — that check is about real data (who actually has is_admin = true
-- right now), which is meaningless against a fresh, unseeded CI
-- database.
--
-- If you change one of the three checks in run_security_checks(),
-- change it here too. Not auto-synced — that's a known trade-off for
-- keeping this script dependency-free.

-- 1. RLS must be enabled on every public table.
do $$
declare
  unprotected_tables text[];
begin
  select array_agg(relname order by relname) into unprotected_tables
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relkind = 'r'
    and relrowsecurity = false;

  if unprotected_tables is not null and array_length(unprotected_tables, 1) > 0 then
    raise exception 'RLS is disabled on: %', array_to_string(unprotected_tables, ', ');
  end if;
end $$;

-- 2. No non-trigger function may have anon/authenticated EXECUTE
-- unless it's on the intentionally_public_functions allowlist.
-- Trigger functions (data_type = 'trigger') are excluded structurally
-- — Postgres refuses to invoke them outside a real trigger context no
-- matter what's granted, so a grant on one is never itself a problem
-- (migration 014).
do $$
declare
  unexpected_grants text[];
begin
  select array_agg(distinct rp.routine_name order by rp.routine_name) into unexpected_grants
  from information_schema.routine_privileges rp
  join information_schema.routines r
    on r.routine_schema = rp.routine_schema and r.routine_name = rp.routine_name
  where rp.routine_schema = 'public'
    and rp.grantee in ('anon', 'authenticated')
    and r.data_type != 'trigger'
    and rp.routine_name not in (select function_name from public.intentionally_public_functions);

  if unexpected_grants is not null and array_length(unexpected_grants, 1) > 0 then
    raise exception 'Functions callable by anon/authenticated but not on the allowlist (add to intentionally_public_functions in a migration if intentional): %', array_to_string(unexpected_grants, ', ');
  end if;
end $$;

-- 3. Every profiles column must be client-writable (allowlist) or
-- locked in protect_admin_columns().
do $$
declare
  protect_fn_body text;
  unprotected_columns text[] := array[]::text[];
  col record;
begin
  select pg_get_functiondef('public.protect_admin_columns()'::regprocedure) into protect_fn_body;

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
    raise exception 'profiles column(s) neither client-writable nor locked by protect_admin_columns(): %', array_to_string(unprotected_columns, ', ');
  end if;
end $$;

\echo 'security_checks.sql: all checks passed'
