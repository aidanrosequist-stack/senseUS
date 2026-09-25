-- migration: 091_raise_velocity_spike_threshold.sql
--
-- CONTEXT (Aidan, 2026-09-25): the velocity_spike heuristic (migration
-- 069) was firing on close to everybody, not just genuine outliers.
-- Traced it to what votes.created_at actually measures: it's set once,
-- on a user's first-ever vote on a given question, and untouched by a
-- later vote CHANGE (cast_vote's ON CONFLICT DO UPDATE only touches
-- choice/updated_at -- see migration 073's own verification notes). So
-- this check was never about flip-flopping on old votes; it was counting
-- genuine first-time votes on distinct questions. At the old threshold
-- (20 votes / 3 minutes, ~9 sec/vote), that's not an unusual pace for
-- the app's actual core loop -- a fast single-tap swipe UI with nothing
-- forcing a pause between questions -- so anyone moving briskly through
-- even a modest backlog tripped it. 069's own comment predicted exactly
-- this risk ("a returning power user skimming a backlog... still
-- could") -- it just turned out to be the common case, not the
-- exception.
--
-- FIX: raise velocity_threshold from 20 to 60, window unchanged at 3
-- minutes. 60 votes in a 3-minute window means sustaining roughly one
-- vote every 3 seconds for 60 votes straight (180 seconds / 60) --
-- Aidan's call on where a real, attentive human reading each question
-- stops being plausible. Nothing else about the check changes: still
-- scans the last 48 hours, still just flags (action_taken = 'flagged',
-- reviewed = false) for admin review, never blocks or auto-penalizes.
--
-- NOT done here, left for Aidan to decide separately: existing
-- unreviewed velocity_spike rows logged under the old 20-vote threshold
-- (peak_votes_in_window between 20 and 59) are now false positives under
-- this new rule, but this migration doesn't touch them -- bulk-marking
-- them reviewed would misrepresent that a human actually looked at each
-- one. See the one-time verification block below for an optional query
-- to find and clear them by hand if wanted.
--
-- Only the velocity_threshold constant changes; coordinated_voting,
-- new_account_surge, and single_question_account (and their thresholds)
-- are untouched. CREATE OR REPLACE is safe here -- same signature as
-- 069, only the function body's constant differs.
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
  velocity_threshold constant integer := 60;
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
  -- 2. coordinated_voting (unchanged from 069)
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
  -- 3. new_account_surge (unchanged from 069)
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
  -- 4. single_question_account (unchanged from 069)
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
--    -> still exactly 1 (CREATE OR REPLACE, not a duplicate).
--
-- 2. How many currently-unreviewed velocity_spike flags exist, and how
--    many of those are now BELOW the new 60-vote threshold (i.e. would
--    never have fired under this migration):
--    select count(*) as total_unreviewed,
--           count(*) filter (where (details->>'peak_votes_in_window')::int < 60) as now_false_positives
--    from integrity_events
--    where event_type = 'velocity_spike' and reviewed = false;
--
-- 3. OPTIONAL, Aidan's call, not run automatically by this migration:
--    clear out exactly those now-stale flags so the admin panel reflects
--    the new rule going forward instead of carrying old false positives:
--    update integrity_events
--    set reviewed = true
--    where event_type = 'velocity_spike'
--      and reviewed = false
--      and (details->>'peak_votes_in_window')::int < 60;
--
-- 4. Run the detector by hand and confirm it still completes cleanly:
--    select public.detect_fraud_signals();
-- ============================================================
