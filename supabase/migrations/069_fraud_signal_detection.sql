-- migration: 069_fraud_signal_detection.sql
--
-- CONTEXT (Aidan, 2026-09-02): the manual table review that found
-- resonance_score dead (migration 068) also found integrity_events'
-- event_type check constraint declaring seven fraud-signal categories
-- while only one (voip_detected, migration 010) was ever actually
-- wired up. Aidan asked to build out the rest to demonstrate the
-- product takes platform integrity seriously.
--
-- SCOPE, DECIDED WITH AIDAN BEFORE BUILDING:
--
-- 1. Of the six remaining categories, geo_mismatch and device_cluster
--    are NOT built here. Neither IP address nor any device-fingerprint
--    signal is captured anywhere in this codebase today (checked every
--    table and every edge function) -- there is nothing to compare
--    against for either check. Building them for real means adding new
--    PII collection (IP capture is itself a privacy-sensitive decision
--    around retention/disclosure) and/or a client-side fingerprinting
--    library -- both explicitly deferred as separate, bigger projects
--    rather than building something hollow just to fill in the
--    constraint. Those two values stay in the check constraint,
--    undetected, same as before this migration.
--
-- 2. The four built here (velocity_spike, coordinated_voting,
--    new_account_surge, single_question_account) use only data already
--    captured: votes.created_at, profiles.created_at, and
--    profiles.answers_count (kept in sync with real vote count -- see
--    run_integrity_checks()'s answers_count_mismatch check, migration
--    006). All four are pure historical-pattern detectors: they scan
--    for behavior that already happened, they never block or alter a
--    live action the way secure_vote_fields_trigger or the
--    cast_vote() cooldown do.
--
-- 3. Detect-and-surface only, no automatic consequence. Unlike
--    voip_detected (a reliable telecom classification that directly
--    sets voip_flagged_at and withholds integrity_weight growth), all
--    four of these are heuristics with real false-positive risk,
--    especially at this app's current small scale where "several
--    people vote the same way within a minute of a push notification"
--    is completely normal engagement, not coordination. Every match
--    just inserts an integrity_events row (action_taken = 'flagged',
--    reviewed = false) for a human admin to look at -- nothing here
--    suspends, bans, or docks anyone automatically. Migration 070+ can
--    revisit that once there's enough real traffic to know these
--    thresholds are sound.
--
-- 4. Admin visibility: AdminReports.jsx (shipped alongside this
--    migration) gets a new Integrity Events panel -- the existing
--    voip_detected events, live since migration 010, had literally no
--    admin UI before this; AdminReports only ever read/resolved
--    anomaly_log. Same list-and-mark-reviewed pattern as the existing
--    Anomaly Log panel.
--
-- THRESHOLDS (each a named constant in detect_fraud_signals() below,
-- tunable later -- picked conservatively to avoid false-flagging real
-- users, not derived from real traffic since there isn't much yet):
--
-- - velocity_spike: >= 20 votes by one user within any 3-minute
--   window, scanning the last 48 hours of votes each run. 9
--   seconds/vote sustained for 20 votes straight is fast enough that a
--   human reading and deciding on each question is unlikely to hit
--   it, but a returning power user skimming a backlog of familiar
--   topics still could -- hence "flagged for review", not "blocked".
--
-- - coordinated_voting: >= 5 distinct users casting the identical
--   choice on the same question within a 2-minute window, scanning
--   the last 48 hours. 'dec' (declined) is excluded -- declining
--   isn't a "side" to coordinate on. Every user in a matching cluster
--   gets their own integrity_events row, cross-referencing the others
--   via details->cluster_size; deduped per (user_id, question_id) so
--   the same historical cluster is never re-logged once seen.
--
-- - new_account_surge: >= 10 accounts created within any 1-hour
--   window, scanning the last 48 hours of profiles.created_at. Every
--   account in a matching cluster gets flagged; deduped per user_id
--   (an account is only ever created once, so this is a one-time
--   historical fact, not something to re-check).
--
-- - single_question_account: exactly 1 lifetime vote
--   (profiles.answers_count = 1), account at least 14 days old (long
--   enough to have had a real chance to vote more if it were an
--   engaged real user), excluding admins. Deduped per user_id.
--
-- DEDUP RULE, by design (see comments above for why it differs by
-- check): velocity_spike re-flags a user once their prior unreviewed
-- flag has been cleared (reviewed = true) -- an ongoing pattern
-- deserves fresh visibility, not endless silence after one review.
-- coordinated_voting / new_account_surge / single_question_account
-- describe a specific historical fact (this question's cluster, this
-- signup's cluster, this account's vote count) that doesn't need
-- re-detecting once logged, reviewed or not.
--
-- ARCHITECTURE: mirrors calculate_all_integrity_weights() /
-- calculate_all_resonance_scores() exactly -- one SECURITY DEFINER
-- function granted only to postgres/service_role, invoked daily by a
-- thin edge function (supabase/functions/detect-fraud-signals/
-- index.ts, shipped alongside this migration) via the same
-- net.http_post + vault service-role-key cron pattern already live
-- for calculate-integrity-daily and calculate-resonance-daily. Wired
-- into check_function_heartbeats() the same way.
--
-- *** DEPLOYMENT NOTE *** -- supabase db push does NOT deploy edge
-- functions. After pushing this migration, also run:
--   supabase functions deploy detect-fraud-signals
--
-- LIVE DEPLOYMENT NOTE: like migration 068, this SQL was already
-- applied directly in the SQL Editor on 2026-09-02 to get the feature
-- live immediately. All statements below are idempotent (CREATE OR
-- REPLACE, cron.schedule upserts by name), so re-running this
-- migration against the already-modified production database is
-- safe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.detect_fraud_signals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  total_logged integer := 0;
  v_count integer;
  velocity_threshold constant integer := 20;
  velocity_window constant interval := interval '3 minutes';
  velocity_lookback constant interval := interval '48 hours';
  coordination_threshold constant integer := 5;
  coordination_window constant interval := interval '2 minutes';
  coordination_lookback constant interval := interval '48 hours';
  surge_threshold constant integer := 10;
  surge_window constant interval := interval '1 hour';
  surge_lookback constant interval := interval '48 hours';
  single_question_min_age constant interval := interval '14 days';
begin

  -- ----------------------------------------------------------------
  -- 1. velocity_spike
  -- ----------------------------------------------------------------
  with recent_votes as (
    select user_id, created_at
    from public.votes
    where created_at >= now() - velocity_lookback
  ),
  windowed as (
    select user_id, created_at,
      count(*) over (
        partition by user_id
        order by created_at
        range between velocity_window preceding and current row
      ) as votes_in_window
    from recent_votes
  ),
  flagged_users as (
    select user_id, max(votes_in_window) as peak_count
    from windowed
    group by user_id
    having max(votes_in_window) >= velocity_threshold
  )
  insert into public.integrity_events (user_id, event_type, details, action_taken)
  select f.user_id, 'velocity_spike',
    jsonb_build_object(
      'peak_votes_in_window', f.peak_count,
      'window', velocity_window::text,
      'scanned', velocity_lookback::text
    ),
    'flagged'
  from flagged_users f
  where not exists (
    select 1 from public.integrity_events ie
    where ie.user_id = f.user_id
      and ie.event_type = 'velocity_spike'
      and ie.reviewed = false
  );
  get diagnostics v_count = row_count;
  total_logged := total_logged + v_count;

  -- ----------------------------------------------------------------
  -- 2. coordinated_voting
  -- ----------------------------------------------------------------
  with recent_votes as (
    select user_id, question_id, choice, created_at
    from public.votes
    where created_at >= now() - coordination_lookback
      and choice in ('yes','ly','ln','no')
  ),
  clusters as (
    select v1.question_id, v1.choice,
      array_agg(distinct v2.user_id) as cluster_users,
      count(distinct v2.user_id) as cluster_size
    from recent_votes v1
    join recent_votes v2
      on v2.question_id = v1.question_id
     and v2.choice = v1.choice
     and v2.created_at between v1.created_at and v1.created_at + coordination_window
    group by v1.question_id, v1.choice, v1.created_at
    having count(distinct v2.user_id) >= coordination_threshold
  ),
  flagged as (
    select distinct question_id, cluster_size, unnest(cluster_users) as user_id
    from clusters
  )
  insert into public.integrity_events (user_id, event_type, details, action_taken)
  select f.user_id, 'coordinated_voting',
    jsonb_build_object('question_id', f.question_id, 'cluster_size', f.cluster_size),
    'flagged'
  from flagged f
  where not exists (
    select 1 from public.integrity_events ie
    where ie.user_id = f.user_id
      and ie.event_type = 'coordinated_voting'
      and ie.details->>'question_id' = f.question_id::text
  );
  get diagnostics v_count = row_count;
  total_logged := total_logged + v_count;

  -- ----------------------------------------------------------------
  -- 3. new_account_surge
  -- ----------------------------------------------------------------
  with recent_profiles as (
    select id, created_at
    from public.profiles
    where created_at >= now() - surge_lookback
  ),
  clusters as (
    select p1.id as anchor_id,
      array_agg(distinct p2.id) as cluster_users,
      count(distinct p2.id) as cluster_size
    from recent_profiles p1
    join recent_profiles p2
      on p2.created_at between p1.created_at and p1.created_at + surge_window
    group by p1.id, p1.created_at
    having count(distinct p2.id) >= surge_threshold
  ),
  flagged as (
    select distinct cluster_size, unnest(cluster_users) as user_id
    from clusters
  )
  insert into public.integrity_events (user_id, event_type, details, action_taken)
  select f.user_id, 'new_account_surge',
    jsonb_build_object('cluster_size', f.cluster_size, 'window', surge_window::text),
    'flagged'
  from flagged f
  where not exists (
    select 1 from public.integrity_events ie
    where ie.user_id = f.user_id
      and ie.event_type = 'new_account_surge'
  );
  get diagnostics v_count = row_count;
  total_logged := total_logged + v_count;

  -- ----------------------------------------------------------------
  -- 4. single_question_account
  -- ----------------------------------------------------------------
  with candidates as (
    select p.id, p.created_at
    from public.profiles p
    where p.answers_count = 1
      and p.created_at <= now() - single_question_min_age
      and p.is_admin = false
  )
  insert into public.integrity_events (user_id, event_type, details, action_taken)
  select c.id, 'single_question_account',
    jsonb_build_object('account_age_days', extract(day from now() - c.created_at)::int),
    'flagged'
  from candidates c
  where not exists (
    select 1 from public.integrity_events ie
    where ie.user_id = c.id
      and ie.event_type = 'single_question_account'
  );
  get diagnostics v_count = row_count;
  total_logged := total_logged + v_count;

  return total_logged;
end;
$function$;

revoke execute on function public.detect_fraud_signals() from public, anon, authenticated;
grant execute on function public.detect_fraud_signals() to postgres, service_role;

-- ============================================================
-- Wire the new job into the existing heartbeat-staleness monitor.
-- Full function body copied from migration 068 with one line added;
-- nothing else here changes.
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
      ('calculate-resonance',             interval '26 hours'),
      ('check_pending_alert_emails',      interval '20 minutes'),
      ('check_policy_drift',              interval '8 days'),
      ('detect-fraud-signals',            interval '26 hours'),
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

-- ============================================================
-- Schedule: daily at 5am UTC -- after calculate-integrity-daily (3am)
-- and calculate-resonance-daily (4am), so the three don't overlap.
-- ============================================================

select cron.schedule(
  'detect-fraud-signals-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://gckjlshfesyxualwxurj.supabase.co/functions/v1/detect-fraud-signals',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- One-time verification (SQL Editor, after applying AND deploying the
-- edge function):
--
-- 1. select count(*) from cron.job where jobname = 'detect-fraud-signals-daily';  -- expect 1
--
-- 2. Run it by hand once rather than waiting for 5am UTC:
--    select public.detect_fraud_signals();
--    -> at this app's current scale, likely returns 0 -- none of the
--       four thresholds are expected to trigger on a handful of real
--       users behaving normally. That's expected, not a bug.
--
-- 3. select event_type, count(*) from integrity_events group by event_type;
--    -> confirms the function ran and (if anything matched) wrote
--       real rows, not just returned without error.
--
-- 4. Confirm the heartbeat recorded after step 2 runs via the real
--    edge function (not the manual RPC call in step 2, which doesn't
--    touch function_heartbeats):
--    select * from function_heartbeats where function_name = 'detect-fraud-signals';
-- ============================================================
