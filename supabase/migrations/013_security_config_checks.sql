-- migration: 013_security_config_checks.sql
--
-- Turns the "Manual RLS/Schema Audit" queries at the bottom of
-- AUDIT_NOTES.md into an automated, scheduled check instead of
-- something re-run by hand from the SQL Editor. Every prior security
-- fix in this repo (007-011) was found by a human running those
-- queries manually after the fact. This closes the loop: the same
-- kinds of drift now get caught on a schedule and emailed, not
-- rediscovered weeks later during the next manual pass.
--
-- Unlike run_integrity_checks() (which logs silently via
-- log_anomaly_only and is reviewed weekly in Admin Reports), these
-- checks call_alert_function() and send an email immediately when
-- they run and find something. Vote-math drift can wait for a human
-- to glance at a dashboard; "RLS just got disabled on a table" is
-- directly exploitable the moment it happens, so it gets the same
-- immediate-alert treatment as registration spikes and vote
-- manipulation, not the same treatment as pct-rounding bugs.
--
-- Three of the four checks below rely on allowlist tables seeded with
-- what this migration author (an AI assistant reading the repo, not
-- someone with access to the live database) could confirm from
-- migration history and code comments. Confirm each seeded list
-- against the live database once after this migration runs — see the
-- "One-time verification" block at the bottom of this file.
-- ============================================================


-- ============================================================
-- FIX 0: anomaly_log — get already-live protection into git.
--
-- Originally written as "RLS is disabled on anomaly_log" based on
-- migration history alone (008 enabled RLS on five other tables;
-- anomaly_log wasn't among them and no later migration covered it
-- either). Confirmed against the live database on 2026-08-15 that
-- this was wrong: RLS is already enabled there, with an admin-only
-- SELECT policy already matching this one almost exactly. Someone
-- fixed this by hand at some point and it was never captured in a
-- migration — exactly the "schema/RLS not fully in git" gap already
-- noted elsewhere in AUDIT_NOTES.md. Nothing was actually exposed;
-- this block's job now is just to version what's already true, plus
-- two small real tightenings found by comparing the two:
--
-- 1. The live UPDATE policy is named "Admins can update anomaly log"
--    — matched here so the drop-if-exists below actually replaces it
--    instead of leaving a duplicate second policy alongside it.
-- 2. The live policies apply `to public` (every role, including
--    anonymous requests) rather than `to authenticated`. Doesn't
--    currently matter in practice — an anonymous request has no
--    auth.uid(), so the admin check fails regardless — but scoping to
--    `authenticated` is tighter and standard practice.
-- ============================================================

alter table public.anomaly_log enable row level security;

-- drop-if-exists + create, same idempotency pattern this repo already
-- uses for triggers (e.g. migration 011's "drop trigger if exists").
-- Needed any time a migration might run against a database where the
-- object already exists by another path — plain `create policy`
-- errors on a name collision instead of replacing it.
drop policy if exists "Admins can view anomaly log" on public.anomaly_log;
create policy "Admins can view anomaly log"
on public.anomaly_log for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);

drop policy if exists "Admins can update anomaly log" on public.anomaly_log;
create policy "Admins can update anomaly log"
on public.anomaly_log for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);

-- No insert/delete policy: inserts only happen via call_alert_function
-- / log_anomaly_only, both SECURITY DEFINER and therefore unaffected
-- by RLS, matching the vote_changes pattern from migration 008.


-- ============================================================
-- Allowlist tables
--
-- All three are locked to service_role the same way authorized_admins
-- is below (RLS enabled, no policies for anon/authenticated). Editing
-- any of them should be a deliberate act — that's the point.
-- ============================================================

-- Functions that are SUPPOSED to be callable by anon/authenticated via
-- RPC. Anything with an anon/authenticated grant NOT in this list gets
-- flagged. Seeded only with the two functions confirmed by name and
-- ownership-check logic in AUDIT_NOTES.md (007/008 fixes) to be
-- deliberate client-facing RPCs. Almost certainly incomplete — e.g.
-- get_vote_tally/get_vote_tallies_batch are read from client code but
-- weren't confirmed against live grants. Run the "Function grants"
-- query from AUDIT_NOTES.md once, decide which anon/authenticated
-- grants are intentional, and insert the rest here before trusting
-- this check to be quiet-when-clean.
create table if not exists public.intentionally_public_functions (
  function_name text primary key,
  note text,
  added_at timestamptz not null default now()
);

insert into public.intentionally_public_functions (function_name, note) values
  ('increment_answers_count', 'Client RPC, has auth.uid() ownership check (007 fix)'),
  ('increment_flag_count', 'Client RPC, requires caller''s own comment_flags row (008 fix)')
on conflict (function_name) do nothing;

-- Columns on `profiles` a client is legitimately allowed to write
-- directly. Copied verbatim from the confirmed list in migration 011.
-- Everything else on `profiles` must either be in this list or be
-- actively zeroed-out in protect_admin_columns() — see check 3 below.
create table if not exists public.profiles_client_writable_columns (
  column_name text primary key
);

insert into public.profiles_client_writable_columns (column_name) values
  ('first_name'), ('last_initial'), ('anon_name'), ('birth_year'),
  ('country_code'), ('display_preference'), ('avatar'), ('bio'),
  ('recovery_email'), ('region')
on conflict (column_name) do nothing;

-- Profiles allowed to have is_admin = true. Seeded from whoever
-- currently has is_admin = true at the moment this migration runs —
-- if that's just you, this correctly captures "you" without anyone
-- needing to paste a UUID in by hand. Add future admins here
-- deliberately; anyone with is_admin = true who ISN'T in this table
-- gets flagged, both instantly (trigger, below) and on the weekly
-- sweep (backstop, in case the trigger itself was ever tampered with
-- or bypassed by a direct write that skips triggers).
create table if not exists public.authorized_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);

insert into public.authorized_admins (user_id, note)
select id, 'seeded from is_admin = true at migration 013 time'
from public.profiles
where is_admin = true
on conflict (user_id) do nothing;

alter table public.intentionally_public_functions enable row level security;
alter table public.profiles_client_writable_columns enable row level security;
alter table public.authorized_admins enable row level security;
-- No policies added on purpose, same pattern as vote_changes (008):
-- RLS enabled + zero policies = anon/authenticated get nothing by
-- default. Only service_role (cron jobs, this migration, Edge
-- Functions using the service key) and SECURITY DEFINER functions
-- owned by postgres can touch these.


-- ============================================================
-- run_security_checks() — the weekly sweep
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
  -- on the deliberate allowlist above. Catches the migration-008
  -- failure mode: every function defaults to PUBLIC-executable unless
  -- someone remembers to revoke it.
  select array_agg(distinct routine_name order by routine_name) into unexpected_grants
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and routine_name not in (select function_name from public.intentionally_public_functions);

  if unexpected_grants is not null and array_length(unexpected_grants, 1) > 0 then
    perform call_alert_function(
      'security_check_failed',
      'critical',
      format('%s function(s) are callable by anon/authenticated but are not on the intentionally_public_functions allowlist: %s', array_length(unexpected_grants, 1), array_to_string(unexpected_grants, ', ')),
      jsonb_build_object('check', 'unexpected_function_grants', 'functions', unexpected_grants)
    );
  end if;

  -- 3. Every profiles column must be either client-writable (allowlist
  -- above) or actively locked in protect_admin_columns(). Heuristic:
  -- pull the function's own source and check it assigns
  -- new.<column> := old.<column> for every non-allowlisted column.
  -- This is exactly the migration-011 bug: a new computed column gets
  -- added and nobody remembers to also add it to the lock-down
  -- function, leaving it directly writable by any authenticated user.
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

  -- 4. Admin allowlist backstop (real-time trigger below is the
  -- primary defense; this re-checks the full table state weekly in
  -- case a row was ever written in a way that skipped the trigger).
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

revoke execute on function public.run_security_checks() from public;
grant execute on function public.run_security_checks() to postgres, service_role;

-- Schedule: every Sunday at 6:30am UTC — 30 minutes after the
-- existing weekly-integrity-check, same day, so both land in your
-- inbox around the same time without racing each other.
select cron.schedule(
  'weekly-security-check',
  '30 6 * * 0',
  $$select public.run_security_checks();$$
);


-- ============================================================
-- Real-time admin-escalation alert
--
-- This is the sole-administrator check you asked about. It fires
-- immediately (not on the weekly schedule) any time a profile's
-- is_admin transitions to true and that profile isn't on the
-- authorized_admins allowlist.
--
-- Note on what this actually catches: protect_admin_columns() (011)
-- already silently blocks any non-service_role write to is_admin, and
-- it's a BEFORE UPDATE trigger, so it runs before this one (AFTER
-- UPDATE) sees the row. That means a regular authenticated user
-- calling supabase.from('profiles').update({is_admin: true}) never
-- reaches this trigger with is_admin actually true — it's already
-- reverted upstream. What THIS catches is the realistic threat for a
-- solo-admin app: is_admin flipped directly via the service-role key
-- or the Supabase SQL Editor/dashboard — i.e. a leaked service key, a
-- compromised dashboard session, or a second person with project
-- access doing something you didn't authorize. Add a real second
-- admin to authorized_admins the moment you actually add one, or
-- you'll immediately alert yourself.
-- ============================================================
create or replace function public.check_unauthorized_admin_grant()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_admin = true
       and not exists (select 1 from public.authorized_admins where user_id = new.id) then
      perform call_alert_function(
        'unauthorized_admin_grant',
        'critical',
        format('Profile %s was inserted with is_admin = true and is not in authorized_admins.', new.id),
        jsonb_build_object('profileId', new.id, 'anonName', new.anon_name)
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_admin = true
       and old.is_admin is distinct from true
       and not exists (select 1 from public.authorized_admins where user_id = new.id) then
      perform call_alert_function(
        'unauthorized_admin_grant',
        'critical',
        format('Profile %s was just granted is_admin = true and is not in authorized_admins.', new.id),
        jsonb_build_object('profileId', new.id, 'anonName', new.anon_name)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_admin_grant_check on public.profiles;
create trigger on_admin_grant_check
  after insert or update on public.profiles
  for each row
  execute function public.check_unauthorized_admin_grant();


-- ============================================================
-- One-time verification (run manually in the SQL Editor after this
-- migration is applied — not automated, since it requires a judgment
-- call about what "should" be true, not just a state check):
--
-- 1. Confirm the function allowlist is complete:
--    select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and grantee in ('anon','authenticated')
--    order by routine_name;
--    -> for every result NOT already in intentionally_public_functions,
--       decide: is this meant to be public? If yes, insert it into the
--       allowlist. If no, revoke it (same pattern as migration 008).
--
-- 2. Confirm authorized_admins has exactly the admin(s) it should:
--    select p.id, p.anon_name, aa.added_at, aa.note
--    from public.authorized_admins aa join public.profiles p on p.id = aa.user_id;
--
-- 3. Run run_security_checks() once by hand to confirm it's quiet:
--    select public.run_security_checks();
--    then check: select * from anomaly_log order by triggered_at desc limit 10;
-- ============================================================
