-- migration: 078_supply_health_check.sql
--
-- Weekly check: are enough of your engaged users running out of active
-- questions to answer? Started from Aidan asking for a notification "if
-- a certain number of users has answered like 75% of questions" so he
-- can stay ahead of the question supply.
--
-- Runs entirely inside Supabase via pg_cron + pg_net, the same pattern as
-- every other scheduled check in this project (check_policy_drift,
-- run_security_checks, check_registration_spike, etc.) — deliberately
-- NOT wired through an external scheduled Claude session. Two reasons:
--   1. No new secret exposure: the service_role key it needs is already
--      sitting in Vault (vault.decrypted_secrets), read the same way
--      call_alert_function() always reads it — never touches a Claude
--      session, a Project doc, or leaves the database at all.
--   2. No dependency on any one machine being online at the exact
--      scheduled moment — pg_cron runs on Supabase's own infrastructure,
--      not on Aidan's computer or in an external cloud sandbox (which,
--      separately, turned out not to be able to reach *.supabase.co at
--      all through this project's network policy anyway).
--
-- Definitions:
--   - "Active questions": published_at is not null and <= now(), and
--     archived_at is null — the exact same filter Explore.jsx already
--     uses for its own live question feed
--     (.not('published_at','is',null).lte('published_at', now())
--     plus a client-side !archived_at check), so this matches what a
--     user actually sees as available to answer today.
--   - "Engaged users": profiles with answers_count > 0. Deliberately
--     excludes never-voted signups from the denominator — including
--     them would dilute the percentage with accounts that were never
--     going to run out of questions in the first place, making the
--     alert practically impossible to trigger and defeating the point.
--   - A user counts toward the 75% mark if the number of *active*
--     questions they've personally voted on is at least 75% of the
--     current active-question count.
--
-- Known simplification, worth knowing about: this doesn't account for
-- questions.geo_scope/country_code/region_code — a user's real eligible
-- pool (matching their own country/region) can be smaller than the
-- global active-question count used here, so this can under-count how
-- "caught up" a geo-restricted user actually is. Flagging rather than
-- solving now — happy to refine if it turns out to matter in practice.
--
-- Threshold: alerts when at least 25% of engaged users have hit the 75%
-- mark (both numbers Aidan floated as a starting point, not treated as
-- final/sacred — easy to tune, see the two constants below).
--
-- Delivery: real push notifications (FCM/APNs) aren't built yet — see
-- senseUS-notification-preferences-design.md, "Not built yet — phase 2".
-- This reuses the one delivery mechanism that already reliably reaches
-- Aidan today: call_alert_function() -> send-alert-email -> an email to
-- hello@senseus.app, the same path every other alert in this project
-- already uses. Worth revisiting once real push ships.
--
-- Verified locally against a reconstructed schema slice in Postgres 16
-- (mocked auth.uid()/auth.role(), vault.decrypted_secrets, net.http_post,
-- real pg_cron/pg_net extensions installed) — same convention as every
-- other migration in this project. Scenarios run: (a) below both
-- thresholds -> no alert, heartbeat still recorded; (b) active question
-- count is 0 -> no alert (guards the division), heartbeat still
-- recorded; (c) engaged user count is 0 -> no alert, heartbeat still
-- recorded; (d) exactly at the 25%/75% boundary -> alerts (>=, not >);
-- (e) comfortably over both thresholds -> alerts once, with the right
-- counts in anomaly_log.details and a real net.http_post call recorded
-- with the service_role_key bearer token; (f) a user who voted on
-- questions that are no longer active, or that are archived/unpublished,
-- isn't counted toward their 75% — only active-question votes count.

create or replace function public.check_supply_health()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_active_question_count int;
  v_engaged_user_count int;
  v_users_at_75pct_count int;
  v_pct_users_at_75pct numeric;
  -- Both floated by Aidan as a starting point when this was designed —
  -- adjust here if experience shows a different pair works better.
  v_user_completion_threshold numeric := 0.75;
  v_alert_pct_threshold numeric := 0.25;
begin
  select count(*) into v_active_question_count
  from public.questions
  where published_at is not null
    and published_at <= now()
    and archived_at is null;

  select count(*) into v_engaged_user_count
  from public.profiles
  where answers_count > 0;

  if v_active_question_count > 0 and v_engaged_user_count > 0 then
    select count(*) into v_users_at_75pct_count
    from public.profiles p
    where p.answers_count > 0
      and (
        select count(*)
        from public.votes v
        join public.questions q on q.id = v.question_id
        where v.user_id = p.id
          and q.published_at is not null
          and q.published_at <= now()
          and q.archived_at is null
      )::numeric >= v_user_completion_threshold * v_active_question_count;

    v_pct_users_at_75pct := v_users_at_75pct_count::numeric / v_engaged_user_count;

    if v_pct_users_at_75pct >= v_alert_pct_threshold then
      perform call_alert_function(
        'question_supply_low',
        'warning',
        format(
          '%s%% of engaged users (%s of %s) have answered at least %s%% of the %s currently active questions — worth publishing more.',
          round(v_pct_users_at_75pct * 100, 1),
          v_users_at_75pct_count,
          v_engaged_user_count,
          round(v_user_completion_threshold * 100, 1),
          v_active_question_count
        ),
        jsonb_build_object(
          'active_question_count', v_active_question_count,
          'engaged_user_count', v_engaged_user_count,
          'users_at_75pct_count', v_users_at_75pct_count,
          'pct_users_at_75pct', v_pct_users_at_75pct,
          'user_completion_threshold', v_user_completion_threshold,
          'alert_pct_threshold', v_alert_pct_threshold
        )
      );
    end if;
  else
    v_users_at_75pct_count := 0;
    v_pct_users_at_75pct := 0;
  end if;

  perform public.record_function_heartbeat(
    'check_supply_health',
    jsonb_build_object(
      'active_question_count', v_active_question_count,
      'engaged_user_count', v_engaged_user_count,
      'users_at_75pct_count', v_users_at_75pct_count,
      'pct_users_at_75pct', v_pct_users_at_75pct
    )
  );
end;
$function$;

revoke all on function public.check_supply_health() from public, anon, authenticated;
grant execute on function public.check_supply_health() to postgres, service_role;

-- Weekly, Sunday 7:00 UTC — clear of the existing 6:00/6:30/6:45 Sunday
-- cluster (weekly-integrity-check / weekly-security-check /
-- weekly-policy-drift-check) and well before send-weekly-report
-- (Monday 8:00). cron.schedule() upserts by job name, so re-running this
-- migration is safe.
select cron.schedule(
  'weekly-supply-health-check',
  '0 7 * * 0',
  $$select public.check_supply_health();$$
);

-- ============================================================
-- Wire the new job into the existing heartbeat-staleness monitor. Full
-- function body copied from migration 069 with one line added; nothing
-- else here changes (same convention 069 used copying 068's body).
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
      ('check_supply_health',             interval '8 days'),
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
-- One-time verification (run manually after this migration is applied):
--
-- 1. Confirm the new cron job exists exactly once:
--    select count(*) from cron.job where jobname = 'weekly-supply-health-check';  -- expect 1
--
-- 2. Run it by hand once to see today's real numbers and confirm it's
--    quiet or loud as expected (this WILL send a real email if you're
--    already over the threshold today):
--    select public.check_supply_health();
--    select * from function_heartbeats where function_name = 'check_supply_health';
--    select * from anomaly_log where alert_type = 'question_supply_low' order by triggered_at desc limit 5;
-- ============================================================
