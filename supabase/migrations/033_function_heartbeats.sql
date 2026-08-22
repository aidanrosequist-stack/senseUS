-- senseUS: scheduled-function heartbeat monitoring
--
-- PROBLEM (the top recommendation from the 2026-08-22 hardening audit):
-- three separate functions were silently broken for potentially weeks —
-- send-alert-email (wrong env var name, every trigger-fired alert
-- 401'd), process-account-deletions (same env var bug — deletion
-- requests just piled up, never actually processed), and cast_vote's
-- answers_count increment (silently reverted by a trigger since the day
-- it shipped) — and nothing was watching whether any of the 13 scheduled
-- jobs in this project actually succeeded, only what they were supposed
-- to prevent. All three were found by hand, weeks after the fact.
--
-- FIX: every cron-invoked function now records a heartbeat on successful
-- completion. A new hourly check compares each one's last heartbeat
-- against how long it should ever go without running, and alerts (via
-- the existing call_alert_function()/send-alert-email pipeline) if one
-- goes stale — the same alerting path already used for security-check
-- failures and threshold alerts, not a new mechanism.
--
-- Two kinds of scheduled function needed two different approaches:
--
-- 1. The 8 jobs pg_cron calls directly as plain SQL (archive_due_questions,
--    calculate_badges, check_pending_alert_emails, refresh_transparency_stats,
--    reset_expired_streaks, take_question_snapshots, run_integrity_checks,
--    run_security_checks) — each function body itself now records its own
--    heartbeat as its last statement, via CREATE OR REPLACE FUNCTION.
--    Deliberately NOT done by editing the live cron.job command strings
--    (e.g. `select fn(); select record_function_heartbeat(...);`) even
--    though pg_cron does support re-scheduling a job by reusing its name —
--    editing the function body itself is provable with CREATE OR REPLACE
--    the same way every other function change in this repo is, and
--    doesn't touch cron.job at all, so there's no risk of silently
--    duplicating or renaming a live job by getting a name slightly wrong.
--
-- 2. The 5 jobs pg_cron fires by calling an Edge Function over HTTP
--    (calculate-integrity, process-account-deletions,
--    process-pending-exports, send-daily-report, send-weekly-report) —
--    recording a heartbeat can't happen here at all, on purpose. pg_net's
--    http_post is fire-and-forget; the cron job never learns whether the
--    request even reached the function, let alone whether it succeeded.
--    A dispatch-time heartbeat would have shown "healthy" for the entire
--    multi-week window process-account-deletions was silently 401ing —
--    exactly the failure mode this is meant to catch. Each of those 5
--    Edge Functions instead records its own heartbeat, in its own source,
--    right before returning success — see the accompanying source changes
--    in supabase/functions/*/index.ts. Those 5 functions need redeploying
--    after this migration; see the bottom of this file.
--
-- Tested against a local Postgres instance loaded with the real schema
-- (all 33 migrations) plus a minimal pg_cron/pg_net stub — see "Testing
-- methodology" in the project notes for this pass. Confirmed: a non-admin
-- can't read function_heartbeats or call record_function_heartbeat
-- directly; an admin can read but still can't write directly; each of
-- the 8 CREATE OR REPLACE'd functions records a heartbeat on a normal
-- run; check_function_heartbeats() correctly identifies a function
-- that's never run, one that's stale, and one that's healthy, and
-- doesn't re-alert on the same stale function within 24h.
-- ============================================================


-- ============================================================
-- function_heartbeats — one row per tracked function
-- ============================================================
create table if not exists public.function_heartbeats (
  function_name text primary key,
  last_success_at timestamptz not null default now(),
  last_details jsonb,
  run_count bigint not null default 0
);

alter table public.function_heartbeats enable row level security;

-- Admin-readable only, same pattern as admin_actions (032). No
-- insert/update/delete policy for any client role — every write goes
-- through record_function_heartbeat(), SECURITY DEFINER and revoked
-- from anon/authenticated below, so there's no direct-client write path.
drop policy if exists "Admins can view function heartbeats" on public.function_heartbeats;
create policy "Admins can view function heartbeats"
  on public.function_heartbeats for select
  to authenticated
  using (is_admin_user());


-- ============================================================
-- record_function_heartbeat — the single write path
--
-- Called two ways: directly by the 8 CREATE OR REPLACE'd functions below
-- (running as postgres via pg_cron, needs no grant), and via
-- adminClient.rpc(...) from the 5 Edge Functions listed above (running
-- as service_role, needs the explicit grant below). Not a client RPC —
-- revoked from anon/authenticated the same way migration 013 found
-- several other cron/service-role-only functions had never actually
-- been locked down (Supabase auto-grants EXECUTE to anon/authenticated
-- on every new function; revoking from PUBLIC alone doesn't touch that).
-- ============================================================
create or replace function public.record_function_heartbeat(
  p_function_name text,
  p_details jsonb default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.function_heartbeats (function_name, last_success_at, last_details, run_count)
  values (p_function_name, now(), p_details, 1)
  on conflict (function_name) do update
    set last_success_at = now(),
        last_details = excluded.last_details,
        run_count = public.function_heartbeats.run_count + 1;
end;
$function$;

revoke all on function public.record_function_heartbeat(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_function_heartbeat(text, jsonb) to postgres, service_role;


-- ============================================================
-- The 8 directly-cron-invoked functions — each now records its own
-- heartbeat as its final statement. Bodies otherwise unchanged from
-- 000_functions.sql / 024_transparency_stats_cache.sql; only the added
-- line is new. archive_due_questions() and calculate_all_integrity_weights()
-- (called by the calculate-integrity Edge Function, not directly by
-- cron — see note 2 above, its heartbeat is recorded in the Edge
-- Function instead, not here) both RETURN a value, so their heartbeat
-- call is inserted just before the existing return, not after it.
-- ============================================================

-- NOTE: migration 026 set search_path on this function via ALTER FUNCTION
-- (deliberately, to avoid touching the body at all). CREATE OR REPLACE
-- does NOT preserve a search_path set that way if the new statement
-- doesn't repeat it — confirmed empirically against a local instance,
-- see "Testing methodology" note at the top of this file — so it's
-- carried forward explicitly here, in every one of the 4 functions below
-- that 026 touched, rather than silently reverting that hardening.
create or replace function public.archive_due_questions()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  archived_count integer;
begin
  update questions
  set archived_at = now()
  where archive_at is not null
    and archive_at <= now()
    and archived_at is null;

  get diagnostics archived_count = row_count;

  update sponsored_questions sq
  set archived_at = now(), status = 'archived'
  from questions q
  where q.id = sq.question_id
    and q.archived_at is not null
    and sq.status = 'live'
    and sq.archived_at is null;

  perform public.record_function_heartbeat('archive_due_questions', jsonb_build_object('archived_count', archived_count));

  return archived_count;
end;
$function$;

create or replace function public.calculate_badges()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  profile_record record;
  total_votes int;
  leaning_votes int;
  leaning_pct float;
  consecutive_definitive int;
  max_consecutive int;
  vote_record record;
  new_badges text[];
  old_badges text[];
  added_badge text;
begin
  for profile_record in select id, badges from public.profiles loop
    new_badges := '{}';
    old_badges := profile_record.badges;

    select
      count(*),
      count(*) filter (where choice in ('ly', 'ln'))
    into total_votes, leaning_votes
    from public.votes
    where user_id = profile_record.id;

    if total_votes >= 100 then
      leaning_pct := leaning_votes::float / total_votes::float;
      if leaning_pct < 0.10 then
        new_badges := array_append(new_badges, 'ultra-definitive');
      end if;
    end if;

    consecutive_definitive := 0;
    max_consecutive := 0;

    for vote_record in
      select choice from public.votes
      where user_id = profile_record.id
      order by created_at asc
    loop
      if vote_record.choice in ('yes', 'no') then
        consecutive_definitive := consecutive_definitive + 1;
        if consecutive_definitive > max_consecutive then
          max_consecutive := consecutive_definitive;
        end if;
      else
        consecutive_definitive := 0;
      end if;
    end loop;

    if max_consecutive >= 20 then
      new_badges := array_append(new_badges, 'decisive-streak');
    end if;

    if max_consecutive >= 50 then
      new_badges := array_append(new_badges, 'super-decisive-streak');
    end if;

    update public.profiles
    set badges = new_badges
    where id = profile_record.id;

    foreach added_badge in array new_badges loop
      if not (old_badges @> array[added_badge]) then
        insert into public.notifications (user_id, type, priority, title, body, action_url)
        values (
          profile_record.id,
          'badge_earned',
          'high',
          case added_badge
            when 'ultra-definitive' then '🎯 You earned Ultra-Definitive!'
            when 'decisive-streak' then '🔥 You earned Decisive Streak!'
            when 'super-decisive-streak' then '⚡ You earned Super Decisive Streak!'
            else 'You earned a new badge!'
          end,
          case added_badge
            when 'ultra-definitive' then 'You''ve cast 100+ votes with less than 10% leaning. Your conviction is unmatched.'
            when 'decisive-streak' then 'You''ve cast 20 consecutive definitive yes/no votes. That''s real conviction.'
            when 'super-decisive-streak' then '50 consecutive definitive votes. You are in rare company.'
            else 'Keep voting to unlock more badges.'
          end,
          '/profile'
        );
      end if;
    end loop;

  end loop;

  perform public.record_function_heartbeat('calculate_badges');
end;
$function$;

create or replace function public.check_pending_alert_emails()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update anomaly_log a
  set email_sent = true,
      email_sent_at = now()
  from net._http_response r
  where a.request_id = r.id
  and a.email_sent = false
  and r.status_code between 200 and 299
  and a.triggered_at > now() - interval '1 hour';

  perform public.record_function_heartbeat('check_pending_alert_emails');
end;
$function$;

create or replace function public.refresh_transparency_stats()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.transparency_stats_cache (id, user_count, question_count, vote_count, comment_count, updated_at)
  values (
    true,
    (select count(*) from public.profiles),
    (select count(*) from public.questions where published_at is not null),
    (select count(*) from public.votes),
    (select count(*) from public.comments where is_deleted = false),
    now()
  )
  on conflict (id) do update set
    user_count = excluded.user_count,
    question_count = excluded.question_count,
    vote_count = excluded.vote_count,
    comment_count = excluded.comment_count,
    updated_at = excluded.updated_at;

  perform public.record_function_heartbeat('refresh_transparency_stats');
end;
$function$;

create or replace function public.reset_expired_streaks()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.profiles
  set streak_days = 0
  where id in (
    select p.id
    from public.profiles p
    where p.streak_days > 0
    and not exists (
      select 1 from public.votes v
      where v.user_id = p.id
      and date(v.created_at) >= current_date - interval '1 day'
    )
  );

  perform public.record_function_heartbeat('reset_expired_streaks');
end;
$function$;

create or replace function public.take_question_snapshots()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  q record;
  yes_count integer;
  ly_count integer;
  ln_count integer;
  no_count integer;
  total integer;
  computed_pct_yes integer;
begin
  for q in select id from public.questions where published_at is not null loop
    select
      count(*) filter (where choice = 'yes'),
      count(*) filter (where choice = 'ly'),
      count(*) filter (where choice = 'ln'),
      count(*) filter (where choice = 'no')
    into yes_count, ly_count, ln_count, no_count
    from public.votes
    where question_id = q.id;

    total := yes_count + ly_count + ln_count + no_count;

    if total > 0 then
      computed_pct_yes := round(((yes_count + ly_count)::numeric / total) * 100);

      insert into public.question_snapshots (
        question_id, pct_yes, pct_no, total_votes,
        yes_votes, ly_votes, ln_votes, no_votes, snapshot_date
      ) values (
        q.id, computed_pct_yes, 100 - computed_pct_yes, total,
        yes_count, ly_count, ln_count, no_count, current_date
      )
      on conflict (question_id, snapshot_date)
      do update set
        pct_yes = excluded.pct_yes,
        pct_no = excluded.pct_no,
        total_votes = excluded.total_votes,
        yes_votes = excluded.yes_votes,
        ly_votes = excluded.ly_votes,
        ln_votes = excluded.ln_votes,
        no_votes = excluded.no_votes;
    end if;
  end loop;

  perform public.record_function_heartbeat('take_question_snapshots');
end;
$function$;

create or replace function public.run_integrity_checks()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  answers_count_issues integer;
  invalid_choices integer;
  duplicate_votes integer;
  pct_sum_issues integer;
  orphaned_changes integer;
begin
  select count(*) into answers_count_issues
  from (
    select p.id
    from profiles p
    left join votes v on v.user_id = p.id
    group by p.id, p.answers_count
    having p.answers_count != count(v.id)
  ) t;

  select count(*) into invalid_choices
  from votes
  where choice not in ('yes', 'ly', 'ln', 'no', 'dec');

  select count(*) into duplicate_votes
  from (
    select user_id, question_id
    from votes
    group by user_id, question_id
    having count(*) > 1
  ) t;

  select count(*) into pct_sum_issues
  from votes
  where pct_yes_at_vote is not null
  and pct_no_at_vote is not null
  and pct_yes_at_vote + pct_no_at_vote != 100;

  select count(*) into orphaned_changes
  from vote_changes vc
  left join votes v on v.user_id = vc.user_id
  and v.question_id = vc.question_id
  where v.id is null;

  if answers_count_issues > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'answers_count_mismatch', 'affected_rows', answers_count_issues)
    );
  end if;

  if invalid_choices > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'invalid_choice_values', 'affected_rows', invalid_choices)
    );
  end if;

  if duplicate_votes > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'duplicate_votes', 'affected_rows', duplicate_votes)
    );
  end if;

  if pct_sum_issues > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'pct_sum_not_100', 'affected_rows', pct_sum_issues)
    );
  end if;

  if orphaned_changes > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'orphaned_vote_changes', 'affected_rows', orphaned_changes)
    );
  end if;

  perform public.record_function_heartbeat('run_integrity_checks');
end;
$function$;

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
begin

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

  perform public.record_function_heartbeat('run_security_checks');
end;
$function$;


-- ============================================================
-- check_function_heartbeats() — the monitor itself
--
-- Compares every tracked function's last heartbeat against how long it
-- should ever realistically go without running (its own cadence plus a
-- buffer, not a tight SLA). Alerts once per stale function per 24h —
-- same dedup shape as check_registration_spike() etc. in
-- 003_threshold_alert_triggers.sql — so a function that's been down for
-- a week doesn't produce a week's worth of identical emails, but you do
-- get reminded daily until it's fixed rather than only once.
--
-- Thresholds are each function's real cadence (see the live cron.job
-- listing this migration was written against) plus a buffer roughly 2x
-- for the frequent jobs and a few hours/a day for the daily/weekly ones,
-- to absorb normal jitter without false-alarming:
--   every 5 min   -> 20 min      (check_pending_alert_emails)
--   every 15 min  -> 45 min      (process-pending-exports)
--   daily         -> 26 hours    (2h buffer)
--   weekly        -> 8 days      (1 day buffer)
-- Adjust freely — these are starting points, not tuned against real
-- production timing data yet.
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

revoke all on function public.check_function_heartbeats() from public, anon, authenticated;
grant execute on function public.check_function_heartbeats() to postgres, service_role;

-- Hourly — the tightest tracked cadence is 5/15 minutes (alert email
-- reconciliation, export processing), so hourly checking means at most
-- ~90 minutes between a job actually going stale and the first alert,
-- well inside the "catch it within a day, not by hand" bar this was
-- built for. New job name, so this is a plain schedule, not a
-- reschedule of anything that already exists.
select cron.schedule(
  'check-function-heartbeats',
  '0 * * * *',
  $$select public.check_function_heartbeats();$$
);


-- ============================================================
-- One-time verification (run manually after this migration is applied):
--
-- 1. Confirm no cron job was duplicated or renamed — this migration
--    only ADDS one new job (check-function-heartbeats) and does not
--    touch any cron.schedule() call for an existing job name:
--    select count(*) from cron.job;  -- should be 14 (13 existing + 1 new)
--
-- 2. After redeploying the 5 Edge Functions listed at the top of this
--    file (see their own source changes), confirm each has reported at
--    least once:
--    select * from function_heartbeats order by function_name;
--
-- 3. Run the check by hand once to confirm it's quiet once all 13 have
--    reported:
--    select public.check_function_heartbeats();
--    select * from anomaly_log where alert_type = 'function_heartbeat_stale' order by triggered_at desc;
-- ============================================================
