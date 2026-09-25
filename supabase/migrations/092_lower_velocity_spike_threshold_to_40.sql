-- migration: 092_lower_velocity_spike_threshold_to_40.sql
--
-- CONTEXT (Aidan, 2026-09-25): after migration 091 raised velocity_spike's
-- threshold from 20 to 60 votes / 3 minutes, Aidan checked the actual
-- integrity_events history and found the fastest pace any real flagged
-- user had ever hit was 26 votes in a 3-minute window. 60 was set without
-- that data point in hand (091 reasoned from "how fast is too fast for a
-- human," not from observed behavior) and turned out to have more
-- headroom than the real traffic actually needed.
--
-- FIX: split the difference, but informed by the data rather than just
-- the arithmetic midpoint -- 40 votes / 3 minutes (unchanged window)
-- gives ~54% headroom above the highest real pace ever observed (26),
-- versus 60's ~131% headroom. That's a deliberate choice to stay closer
-- to observed reality while this app is still small: the 26-vote
-- ceiling is a real data point, but it's from a small, early sample, so
-- some margin above it is still warranted rather than setting the
-- threshold right at the historical edge.
--
-- Same as 091: only the velocity_threshold constant changes. Window
-- (3 minutes), lookback (48 hours), and the other three signals
-- (coordinated_voting, new_account_surge, single_question_account) are
-- untouched.
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
  velocity_threshold constant integer := 40;
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
  -- 2. coordinated_voting (unchanged from 069/091)
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
  -- 3. new_account_surge (unchanged from 069/091)
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
  -- 4. single_question_account (unchanged from 069/091)
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
-- One-time verification (SQL Editor, after applying):
--
-- 1. select count(*) from pg_proc where proname = 'detect_fraud_signals';
--    -> still exactly 1.
--
-- 2. Recheck who's now a false positive at the new 40-vote line:
--    select count(*) as total_unreviewed,
--           count(*) filter (where (details->>'peak_votes_in_window')::int < 40) as now_false_positives
--    from integrity_events
--    where event_type = 'velocity_spike' and reviewed = false;
--
-- 3. OPTIONAL, same as 091's note -- clear the now-stale ones by hand if
--    wanted, rather than this migration doing it silently:
--    update integrity_events
--    set reviewed = true
--    where event_type = 'velocity_spike'
--      and reviewed = false
--      and (details->>'peak_votes_in_window')::int < 40;
--
-- 4. select public.detect_fraud_signals(); -- still completes cleanly.
-- ============================================================
