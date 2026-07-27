-- senseUS: Enable RLS on unprotected tables, lock down function grants
--
-- PROBLEM (found via manual RLS audit, 2026-07-27, since the CLI's
-- Docker-based schema dump isn't available in this environment):
--
-- 1. Five tables had RLS policies DEFINED but RLS itself was never
--    turned on for the table: comments, comment_resonances, exports,
--    transparency_events, vote_changes. Policies on a table with
--    row-level security disabled are completely inert — anyone with
--    the anon key could read/write any row in these tables directly,
--    bypassing every ownership check. vote_changes is the most
--    serious: it's the audit trail check_vote_manipulation() relies
--    on, so this let an attacker both manipulate votes AND erase or
--    fabricate the evidence trail meant to catch it.
--
-- 2. Every function in the database had EXECUTE granted to `anon` and
--    `authenticated` via the PUBLIC pseudo-role, including several
--    meant to be cron/service-role-only: call_alert_function (fires a
--    real alert email with fully attacker-controlled content),
--    log_anomaly_only (lets anyone insert fabricated anomaly_log
--    rows), calculate_all_integrity_weights, calculate_badges,
--    reset_expired_streaks, run_integrity_checks. increment_flag_count
--    also had no ownership check.
-- ============================================================

-- ============================================================
-- FIX 1: Enable RLS on the five unprotected tables
-- ============================================================

alter table public.comments enable row level security;
alter table public.comment_resonances enable row level security;
alter table public.exports enable row level security;
alter table public.transparency_events enable row level security;
alter table public.vote_changes enable row level security;

-- vote_changes has a SELECT policy (own changes) but no INSERT policy,
-- because it's meant to be populated only by the log_vote_change()
-- trigger (which runs as the trigger's definer, not as the calling
-- role, so it's unaffected by this). With RLS now enabled and no
-- INSERT/UPDATE/DELETE policy present, direct client writes to this
-- table are now correctly denied by default.

-- ============================================================
-- FIX 2: Lock down function grants to what's actually needed
--
-- REVOKE FROM PUBLIC removes the blanket grant every role inherits;
-- we then explicitly re-grant only to the roles that legitimately
-- need each function. postgres and service_role always keep access
-- (cron jobs and Edge Functions using the service-role key still work
-- exactly as before).
-- ============================================================

-- Internal/admin-only — should never be callable by end users at all
revoke execute on function public.call_alert_function(text, text, text, jsonb) from public;
grant execute on function public.call_alert_function(text, text, text, jsonb) to postgres, service_role;

revoke execute on function public.log_anomaly_only(text, text, jsonb, uuid, text) from public;
grant execute on function public.log_anomaly_only(text, text, jsonb, uuid, text) to postgres, service_role;

revoke execute on function public.calculate_all_integrity_weights() from public;
grant execute on function public.calculate_all_integrity_weights() to postgres, service_role;

revoke execute on function public.calculate_badges() from public;
grant execute on function public.calculate_badges() to postgres, service_role;

revoke execute on function public.reset_expired_streaks() from public;
grant execute on function public.reset_expired_streaks() to postgres, service_role;

revoke execute on function public.run_integrity_checks() from public;
grant execute on function public.run_integrity_checks() to postgres, service_role;

revoke execute on function public.check_pending_alert_emails() from public;
grant execute on function public.check_pending_alert_emails() to postgres, service_role;

-- Trigger functions (moderate_comment, protect_admin_columns, etc.) are
-- left alone — Postgres refuses to execute a trigger function outside
-- an actual trigger context ("trigger functions can only be called as
-- triggers"), so the broad EXECUTE grant on those is not exploitable
-- via RPC even though it looks loose. Not worth the churn of revoking.

-- ============================================================
-- FIX 3: increment_flag_count needs an ownership check
--
-- Previously callable by any authenticated user on any comment_id,
-- with no requirement that they'd actually filed a flag. Now requires
-- a real comment_flags row from the caller for that comment to exist
-- first.
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_flag_count(comment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  if not exists (
    select 1 from public.comment_flags cf
    where cf.comment_id = increment_flag_count.comment_id
      and cf.user_id = auth.uid()
  ) then
    raise exception 'You must flag this comment before its count can be incremented.';
  end if;

  update public.comments c
  set flag_count = c.flag_count + 1,
      is_flagged = true
  where c.id = increment_flag_count.comment_id;
end;
$function$;
