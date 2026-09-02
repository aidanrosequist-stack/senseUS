-- migration: 068_calculate_resonance_scores.sql
--
-- CONTEXT (Aidan, 2026-09-02): found during a manual table review that
-- profiles.resonance_score has been stuck at its schema default of 50
-- ("Aligned") for every single user since day one -- protect_admin_columns()
-- locks it against any client write (correct, that part was intentional),
-- but nothing anywhere ever computed a real value to write either. The
-- Profile page presents it as a live measurement ("Your resonance score
-- reflects how closely your votes align with the overall verified
-- community"), so this was a real, misleading gap, not just an unused
-- column.
--
-- WHAT IT MEASURES: for each of a user's votes, whether their choice
-- landed on the side that already had the majority among everyone else's
-- votes on that question, at the exact moment they voted (or last changed
-- that vote). The raw ingredient for this already existed and needed no
-- new schema: votes.pct_yes_at_vote / pct_no_at_vote, computed
-- server-side by secure_vote_fields_trigger (migration 007) on every
-- insert AND update, explicitly excluding the voter's own row -- so it's
-- already a tamper-proof snapshot of "what did the crowd think before/
-- without me" at vote time.
--
-- DESIGN DECISIONS (discussed with Aidan before building):
--
-- 1. Majority-side match, not distance-weighted. 'yes'/'ly' count as the
--    "yes side", 'no'/'ln' as the "no side" (same collapse
--    secure_vote_fields_trigger already uses to compute pct_yes_at_vote
--    itself) -- a strong "yes" and a soft "lean yes" score identically.
--    Matches the tier language already written in Profile.jsx ("agrees
--    with the majority half the time"). 'dec' (declined) votes never
--    count either way.
--
-- 2. First-votes-on-a-question are excluded, not penalized. When nobody
--    else has voted yet, pct_yes_at_vote/pct_no_at_vote are null (see
--    migration 007) -- there's nothing to compare against, so those
--    votes are skipped entirely rather than counted as agreement or
--    disagreement. A user who often votes first on brand-new questions
--    (Aidan's own account does this constantly) will have a smaller
--    scoreable sample than someone who mostly votes on already-live
--    questions -- expected, not a bug. An exact 50/50 split at vote time
--    is treated the same way (no majority to match or defy).
--
-- 3. Reflects your CURRENT vote, not your voting history. votes is
--    upsert-only (one row per user/question -- see cast_vote(),
--    migration 055), so pct_yes_at_vote on that row reflects the crowd
--    at the time of whatever choice is on record NOW. If someone votes
--    against the grain early and later revises to match the majority
--    once it's established, that vote reads as "aligned" -- no trace of
--    the earlier contrarian stance survives in votes itself. Discussed
--    with Aidan and kept intentionally: "changes their mind to match
--    where things settled" is itself a real signal this feature is
--    meant to capture, not something to correct for.
--
-- 4. Minimum sample size (5 scoreable votes) before a real score
--    replaces the default. Below that, a profile is left untouched
--    (stays at 50/Aligned) rather than swinging wildly on 1-2 data
--    points -- relevant right now with a small, early user base.
--
-- 5. Fully recomputed each run, not upward-only. Unlike integrity_weight
--    (migration 010/025 -- a trust metric that deliberately never
--    decreases), resonance is meant to reflect current voting pattern,
--    which can genuinely drift in either direction over time.
--
-- Tier boundaries below are copied exactly from the table already shown
-- in Profile.jsx's Resonance Score modal -- not new, just finally wired
-- up to a real calculation.
--
-- ARCHITECTURE: mirrors calculate_all_integrity_weights() /
-- calculate-integrity exactly -- a SECURITY DEFINER SQL function granted
-- only to postgres/service_role, invoked daily by a thin edge function
-- (supabase/functions/calculate-resonance/index.ts, shipped alongside
-- this migration) via the same net.http_post + vault service-role-key
-- cron pattern already live for calculate-integrity-daily. Because the
-- edge function calls in as service_role, protect_admin_columns()'s
-- `auth.role() != 'service_role'` guard skips its lock entirely for this
-- write -- no bypass-flag trick needed (same reason calculate_all_
-- integrity_weights' plain UPDATE already works today).
--
-- *** DEPLOYMENT NOTE *** -- supabase db push does NOT deploy edge
-- functions (a gotcha this project has hit before). After pushing this
-- migration, also run:
--   supabase functions deploy calculate-resonance
-- Until that's deployed, the new cron job's net.http_post calls will
-- just 404 harmlessly once a day -- not silent-broken, just not live
-- yet.
--
-- LIVE DEPLOYMENT NOTE: the SQL below (function, grants, heartbeat
-- monitor update, and cron job) was already applied directly in the SQL
-- Editor on 2026-09-02 to get the feature live immediately -- this
-- migration file brings that same state into version control so it's
-- reproducible and so `supabase db push` doesn't try to re-apply
-- conflicting DDL later. cron.schedule() and the CREATE OR REPLACE
-- statements below are idempotent, so re-running this migration against
-- the live database is safe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_all_resonance_scores()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  updated_count integer;
  min_scoreable_votes constant integer := 5;
begin
  with scored_votes as (
    select
      v.user_id,
      case when v.choice in ('yes','ly') then 'yes'
           when v.choice in ('no','ln') then 'no'
           else null end as voter_side,
      case when v.pct_yes_at_vote > 50 then 'yes'
           when v.pct_yes_at_vote < 50 then 'no'
           else null end as majority_side
    from public.votes v
    where v.pct_yes_at_vote is not null
      and v.choice in ('yes','ly','ln','no')
  ),
  per_user as (
    select
      user_id,
      count(*) filter (where majority_side is not null) as scoreable_count,
      count(*) filter (where majority_side is not null and voter_side = majority_side) as matched_count
    from scored_votes
    group by user_id
  ),
  new_scores as (
    select
      user_id,
      round((matched_count::numeric / scoreable_count) * 100)::integer as calculated_score
    from per_user
    where scoreable_count >= min_scoreable_votes
  )
  update public.profiles p
  set
    resonance_score = ns.calculated_score,
    resonance_tier = case
      when ns.calculated_score <= 9 then 'Trailblazer'
      when ns.calculated_score <= 24 then 'Contrarian'
      when ns.calculated_score <= 49 then 'Independent'
      when ns.calculated_score <= 74 then 'Aligned'
      when ns.calculated_score <= 90 then 'Resonant'
      else 'Chorus'
    end
  from new_scores ns
  where p.id = ns.user_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

revoke execute on function public.calculate_all_resonance_scores() from public, anon, authenticated;
grant execute on function public.calculate_all_resonance_scores() to postgres, service_role;

-- ============================================================
-- Wire the new job into the existing heartbeat-staleness monitor —
-- same list check_function_heartbeats() (migration 034) already checks
-- calculate-integrity against. Full function body copied from 034 with
-- one line added; nothing else here changes.
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
-- Schedule: daily at 4am UTC — one hour after calculate-integrity-daily
-- (3am), just to keep the two off the same minute. Same net.http_post +
-- vault service-role-key pattern as the live calculate-integrity-daily
-- job (confirmed via `select * from cron.job` before writing this).
--
-- cron.schedule() upserts by job name, so re-running this migration
-- (e.g. on a database rebuilt from migrations) is safe and won't create
-- a duplicate job.
-- ============================================================

select cron.schedule(
  'calculate-resonance-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://gckjlshfesyxualwxurj.supabase.co/functions/v1/calculate-resonance',
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
-- edge function) -- already run once live on 2026-09-02, safe to re-run:
--
-- 1. select count(*) from cron.job where jobname = 'calculate-resonance-daily';  -- expect 1
--
-- 2. Run it by hand once rather than waiting for 4am UTC:
--    select public.calculate_all_resonance_scores();
--    -> should return the number of profiles updated (only those with
--       >= 5 scoreable votes -- as of 2026-09-02, that's Aidan's own
--       account and one other profile; everyone else stays at the
--       default 50/Aligned until they have enough votes).
--
-- 3. select id, first_name, resonance_score, resonance_tier from profiles;
--    -> Aidan's own account should now show something other than a flat
--       50, reflecting real voting pattern against the crowd-at-vote-time
--       snapshot.
--
-- 4. Confirm the heartbeat recorded after step 2 runs via the real edge
--    function (not the manual RPC call in step 2, which doesn't touch
--    function_heartbeats):
--    select * from function_heartbeats where function_name = 'calculate-resonance';
-- ============================================================
