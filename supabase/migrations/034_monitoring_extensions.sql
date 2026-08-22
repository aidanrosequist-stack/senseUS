-- senseUS: the three remaining monitoring recommendations from the
-- 2026-08-22 hardening pass (function heartbeats — item 1 — shipped
-- separately in migration 033). See
-- senseUS-hardening-and-monitoring-notes.md for the full writeup.
--
-- 1. RLS/policy drift detection — weekly snapshot of pg_policies,
--    alert on any unexpected change since last week.
-- 2. Extend run_security_checks() to verify protective-trigger *event
--    coverage*, not just presence — the migration-029 bug class
--    (protect_admin_columns was BEFORE UPDATE only, no INSERT) was
--    invisible to the existing check, which only confirms a column is
--    mentioned in a trigger function's body, with no concept of which
--    write path that protection actually applies to.
-- 3. Alert on admin_actions volume anomalies — more than 20 admin
--    actions in an hour, the same threshold and shape already used for
--    coordinated_signup in 003_threshold_alert_triggers.sql.
--
-- Tested against a local Postgres instance the same way as 033 — see
-- "Testing methodology" note in the project doc for this pass.
-- ============================================================


-- ============================================================
-- 1. RLS/policy drift detection
-- ============================================================

create table if not exists public.policy_snapshot (
  id boolean primary key default true check (id),
  snapshot jsonb not null,
  captured_at timestamptz not null default now()
);

alter table public.policy_snapshot enable row level security;

drop policy if exists "Admins can view policy snapshot" on public.policy_snapshot;
create policy "Admins can view policy snapshot"
  on public.policy_snapshot for select
  to authenticated
  using (is_admin_user());
-- No insert/update/delete policy — written only by check_policy_drift(),
-- SECURITY DEFINER, revoked from anon/authenticated below.

create or replace function public.check_policy_drift()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_snapshot jsonb;
  previous_snapshot jsonb;
  tbl text;
  prev_tbl jsonb;
  cur_tbl jsonb;
  changed_tables text[] := array[]::text[];
  rls_disabled_flips text[] := array[]::text[];
  severity text := 'warning';
begin
  -- One row per table: whether RLS is enabled, plus the sorted list of
  -- policy names/commands/roles. Built from pg_policies (definitions)
  -- joined to pg_class (RLS on/off) rather than pg_policies alone, since
  -- a table with RLS silently disabled but old policies still defined —
  -- exactly the migration-008 failure mode — would otherwise look
  -- unchanged to a policy-only diff.
  select jsonb_object_agg(t.relname, t.info) into current_snapshot
  from (
    select
      c.relname,
      jsonb_build_object(
        'rls_enabled', c.relrowsecurity,
        'policies', coalesce((
          select jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd, 'roles', p.roles) order by p.policyname)
          from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
        ), '[]'::jsonb)
      ) as info
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
  ) t;

  select snapshot into previous_snapshot from public.policy_snapshot where id = true;

  if previous_snapshot is not null then
    for tbl in select jsonb_object_keys(current_snapshot) union select jsonb_object_keys(previous_snapshot) loop
      cur_tbl := current_snapshot -> tbl;
      prev_tbl := previous_snapshot -> tbl;

      if cur_tbl is distinct from prev_tbl then
        changed_tables := array_append(changed_tables, tbl);

        -- RLS flipping from enabled to disabled (or a table that had RLS
        -- enabled before now missing entirely — dropped table, or this
        -- check itself misconfigured) is a materially bigger deal than a
        -- policy being renamed or a column list changing, so it escalates
        -- the whole alert to critical rather than warning.
        if coalesce((prev_tbl->>'rls_enabled')::boolean, false)
           and not coalesce((cur_tbl->>'rls_enabled')::boolean, false) then
          rls_disabled_flips := array_append(rls_disabled_flips, tbl);
        end if;
      end if;
    end loop;

    if array_length(changed_tables, 1) > 0 then
      if array_length(rls_disabled_flips, 1) > 0 then
        severity := 'critical';
      end if;

      perform call_alert_function(
        'policy_drift_detected',
        severity,
        format(
          '%s table(s) have RLS/policy changes since the last weekly snapshot: %s.%s',
          array_length(changed_tables, 1),
          array_to_string(changed_tables, ', '),
          case when array_length(rls_disabled_flips, 1) > 0
            then format(' RLS was DISABLED on: %s.', array_to_string(rls_disabled_flips, ', '))
            else ''
          end
        ),
        jsonb_build_object(
          'changed_tables', changed_tables,
          'rls_disabled_flips', rls_disabled_flips,
          'previous', previous_snapshot,
          'current', current_snapshot
        )
      );
    end if;
  end if;

  -- Always move the baseline forward — this is a rolling week-over-week
  -- diff, not a comparison against one fixed original snapshot. A
  -- legitimate migration that intentionally changes policies should
  -- alert once (so a human confirms it was intentional) and then become
  -- the new normal, not alert every week forever after.
  insert into public.policy_snapshot (id, snapshot, captured_at)
  values (true, current_snapshot, now())
  on conflict (id) do update set snapshot = excluded.snapshot, captured_at = excluded.captured_at;

  perform public.record_function_heartbeat('check_policy_drift');
end;
$function$;

revoke all on function public.check_policy_drift() from public, anon, authenticated;
grant execute on function public.check_policy_drift() to postgres, service_role;

-- Weekly, staggered 15 minutes after weekly-security-check so the two
-- don't run concurrently.
select cron.schedule(
  'weekly-policy-drift-check',
  '45 6 * * 0',
  $$select public.check_policy_drift();$$
);

-- Seed the baseline immediately so the first real diff is against
-- today's actual state, not empty — the seeding run above already
-- skips alerting when previous_snapshot is null, so this is silent.
select public.check_policy_drift();


-- ============================================================
-- 2. run_security_checks() — add protective-trigger event-coverage check
--
-- protected_trigger_coverage is a deliberate, manually-maintained
-- allowlist (same shape as intentionally_public_functions in 013): each
-- row names a trigger that's supposed to protect something on every
-- write path that matters, and which of INSERT/UPDATE it must cover.
-- Seeded with the three protective triggers that exist today; add a row
-- here any time a new one is created — this check only guards trigger
-- coverage for what's actually listed, on purpose (same tradeoff
-- 013 made for its own allowlists), rather than trying to guess which
-- triggers are "supposed to" be protective from naming conventions.
-- ============================================================

create table if not exists public.protected_trigger_coverage (
  trigger_name text primary key,
  table_name text not null,
  expect_insert boolean not null default true,
  expect_update boolean not null default true,
  note text
);

insert into public.protected_trigger_coverage (trigger_name, table_name, note) values
  ('protect_admin_columns_insert_update', 'profiles', 'Migration 029 — an INSERT-only gap here was the critical self-admin-escalation bug found 2026-08-21; must cover both INSERT and UPDATE.'),
  ('protect_comment_computed_columns_trigger', 'comments', 'Migration 030 — protects is_removed/flag_count from client tampering on both insert and update.'),
  ('secure_vote_fields_trigger', 'votes', 'Migration 007 — overwrites integrity_weight_at_vote/pct snapshots server-side on both insert and update.')
on conflict (trigger_name) do nothing;

alter table public.protected_trigger_coverage enable row level security;
-- No policies — same "service_role/postgres only, RLS enabled with zero
-- policies" pattern as intentionally_public_functions and the other
-- allowlist tables in 013. Not admin-readable via the app; edited only
-- through migrations, same as those.

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

  -- 5. NEW: protective triggers must cover every event they're expected
  -- to, not just exist. Catches exactly the migration-029 bug class — a
  -- trigger that exists, is wired to the right table, and whose function
  -- body genuinely does protect the right column, but is only actually
  -- invoked on some of the write paths that need it.
  --
  -- Checked via pg_trigger.tgtype's bitmask (TRIGGER_TYPE_INSERT = 4,
  -- TRIGGER_TYPE_UPDATE = 16 — confirmed empirically against known
  -- triggers, not just taken from memory of the Postgres source), NOT
  -- by pattern-matching pg_get_triggerdef()'s rendered text the way
  -- check 3 above does for protect_admin_columns' column coverage. A
  -- first draft of this check used the same text-matching approach and
  -- had a real false negative caught in local testing before shipping:
  -- protect_admin_columns_insert_update's own NAME contains the
  -- substring "insert", so a regex for INSERT against the rendered
  -- `CREATE TRIGGER protect_admin_columns_insert_update BEFORE UPDATE
  -- ON ...` text matched the trigger's name and silently reported
  -- INSERT as covered even when the trigger was UPDATE-only — the
  -- exact bug this check exists to catch, invisible to the check
  -- itself. The bitmask has no such ambiguity.
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

-- Grants/schedule unchanged from 013/033 — CREATE OR REPLACE above only
-- changes the function body, not its ownership or ACLs, and this
-- function's cron.schedule() job name/cadence isn't touched here.


-- ============================================================
-- 3. Alert on admin_actions volume anomalies
--
-- Same shape and threshold (>20 in 1h) as check_coordinated_signup() in
-- 003_threshold_alert_triggers.sql, applied to admin_actions instead of
-- profiles — the kind of volume a compromised admin session would
-- produce, not what a human doing normal moderation would.
-- ============================================================

create or replace function public.check_admin_action_volume()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recent_count int;
  already_alerted boolean;
begin
  select count(*) into recent_count
  from public.admin_actions
  where created_at > now() - interval '1 hour';

  select exists(
    select 1 from public.anomaly_log
    where alert_type = 'admin_action_volume_spike'
    and triggered_at > now() - interval '1 hour'
  ) into already_alerted;

  if recent_count > 20 and not already_alerted then
    perform call_alert_function(
      'admin_action_volume_spike',
      'critical',
      format('More than 20 admin actions in the last hour (%s total) — worth reviewing admin_actions for anything unexpected.', recent_count),
      jsonb_build_object('count', recent_count, 'window', '1h')
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists on_admin_action_volume_check on public.admin_actions;
create trigger on_admin_action_volume_check
  after insert on public.admin_actions
  for each row
  execute function public.check_admin_action_volume();


-- ============================================================
-- check_function_heartbeats() — add the new weekly policy-drift job to
-- what's tracked, same as every other scheduled function.
-- ============================================================
create or replace function public.check_function_heartbeats()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  expected record;
  last_success timestamptz;
  hours_since numeric;
  already_alerted boolean;
begin
  for expected in
    select * from (values
      ('archive_due_questions',           interval '26 hours'),
      ('calculate_badges',                interval '26 hours'),
      ('calculate-integrity',             interval '26 hours'),
      ('check_pending_alert_emails',      interval '20 minutes'),
      ('check_policy_drift',              interval '8 days'),
      ('process-account-deletions',       interval '26 hours'),
      ('process-pending-exports',         interval '45 minutes'),
      ('refresh_transparency_stats',      interval '26 hours'),
      ('reset_expired_streaks',           interval '26 hours'),
      ('send-daily-report',               interval '26 hours'),
      ('send-weekly-report',              interval '8 days'),
      ('take_question_snapshots',         interval '26 hours'),
      ('run_integrity_checks',            interval '8 days'),
      ('run_security_checks',             interval '8 days')
    ) as t(function_name, max_staleness)
  loop
    select h.last_success_at into last_success
    from public.function_heartbeats h
    where h.function_name = expected.function_name;

    if last_success is null or last_success < now() - expected.max_staleness then
      hours_since := case when last_success is null then null
                          else round(extract(epoch from (now() - last_success)) / 3600, 1) end;

      select exists(
        select 1 from public.anomaly_log
        where alert_type = 'function_heartbeat_stale'
        and details->>'function' = expected.function_name
        and triggered_at > now() - interval '24 hours'
      ) into already_alerted;

      if not already_alerted then
        perform call_alert_function(
          'function_heartbeat_stale',
          'critical',
          case when last_success is null
            then format('%s has never reported a successful run.', expected.function_name)
            else format('%s has not reported a successful run in %s hours (expected at least every %s).', expected.function_name, hours_since, expected.max_staleness)
          end,
          jsonb_build_object(
            'function', expected.function_name,
            'last_success_at', last_success,
            'hours_since_last_success', hours_since,
            'expected_within', expected.max_staleness::text
          )
        );
      end if;
    end if;

    last_success := null;
  end loop;
end;
$function$;

-- Grants/schedule unchanged from 033 — CREATE OR REPLACE above only
-- changes the function body.


-- ============================================================
-- One-time verification (run manually after this migration is applied):
--
-- 1. Confirm the drift baseline seeded cleanly and stayed quiet on its
--    first run (it should — nothing to compare against yet):
--    select * from policy_snapshot;
--    select * from anomaly_log where alert_type = 'policy_drift_detected' order by triggered_at desc limit 5;
--
-- 2. Confirm the new cron job exists exactly once:
--    select count(*) from cron.job where jobname = 'weekly-policy-drift-check';  -- expect 1
--
-- 3. Run the extended security check by hand once to confirm it's quiet:
--    select public.run_security_checks();
--    select * from anomaly_log where details->>'check' = 'protective_trigger_coverage';  -- expect none
-- ============================================================
