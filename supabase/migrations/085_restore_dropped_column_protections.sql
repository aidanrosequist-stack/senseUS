-- senseUS: restore welcome_sms_sent_at / checked_line_type_at protection,
-- silently dropped by migration 074.
--
-- CONTEXT (Aidan, 2026-09-18, investigating a 2026-09-13
-- security_check_failed/unprotected_profile_columns anomaly flagging
-- welcome_sms_sent_at and checked_line_type_at):
--
-- Migration 074 (2026-09-05) added last_comparison_attempt_at
-- protection to protect_admin_columns() via CREATE OR REPLACE FUNCTION,
-- but its copy of the function body was taken from a version that
-- predates 057 (2026-08-29, welcome_sms_sent_at) and 058 (same day,
-- checked_line_type_at) -- so the REPLACE silently reverted both of
-- those, three weeks after they were added. Confirmed by diffing 058's
-- function body against 074's: 074 is missing both
--   new.welcome_sms_sent_at := null;           / new.checked_line_type_at := null;
-- from the INSERT branch, and both
--   if coalesce(current_setting('senseus.bypass_..._protection', true), '') <> 'true' then
--     new...  := old...;
--   end if;
-- guarded restores from the UPDATE branch. No migration since 074 has
-- touched protect_admin_columns(), so this has been live since
-- 2026-09-05: any signed-in user could
--   supabase.from('profiles').update({ welcome_sms_sent_at: null })
-- or the same for checked_line_type_at, silently succeed, and re-claim
-- claim_welcome_sms_send() / claim_line_type_check() -- exactly the
-- repeated-billing / VOIP-probation-window-extension bug 057 and 058
-- were written to close. run_security_checks() (weekly, Sundays 6:30am
-- UTC) should have caught this the very next morning; whether it did
-- and the anomaly was marked resolved before recurring, or the first
-- catch really was 2026-09-13, doesn't change the fix -- the regression
-- is real and, as of this migration, still live.
--
-- FIX: re-apply 074's version verbatim, with 057/058's two blocks
-- merged back in. No column or RPC changes needed -- both columns and
-- both claim_*() functions are untouched and already correct; only the
-- trigger function's protection coverage regressed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Must stay `!=`, not a `= 'service_role'` early-return — see the long
  -- comment on this exact point in migration 029. NULL auth.role()
  -- (pg_cron, a direct superuser session, a migration run — anything
  -- with no PostgREST request context) needs to fall through this whole
  -- block untouched, the same as migration 011's original behavior.
  if auth.role() != 'service_role' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.integrity_weight := 1.0000;
      new.answers_count := 0;
      new.resonance_score := 50;
      new.resonance_tier := 'Independent';
      new.streak_days := 0;
      new.longest_streak := 0;
      new.replies_count := 0;
      new.likes_received := 0;
      new.tier := 'newcomer';
      new.badges := '{}';
      new.voip_flagged_at := null;
      new.country_changed_at := null;
      new.created_at := now();
      new.last_vote_at := null;
      new.welcome_sms_sent_at := null;
      new.checked_line_type_at := null;
      new.last_comparison_attempt_at := null;
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      if coalesce(current_setting('senseus.bypass_last_vote_at_protection', true), '') <> 'true' then
        new.last_vote_at := old.last_vote_at;
      end if;
      if coalesce(current_setting('senseus.bypass_welcome_sms_sent_at_protection', true), '') <> 'true' then
        new.welcome_sms_sent_at := old.welcome_sms_sent_at;
      end if;
      if coalesce(current_setting('senseus.bypass_checked_line_type_at_protection', true), '') <> 'true' then
        new.checked_line_type_at := old.checked_line_type_at;
      end if;
      if coalesce(current_setting('senseus.bypass_comparison_attempt_protection', true), '') <> 'true' then
        new.last_comparison_attempt_at := old.last_comparison_attempt_at;
      end if;
      new.is_admin := old.is_admin;
      new.integrity_weight := old.integrity_weight;
      new.resonance_score := old.resonance_score;
      new.resonance_tier := old.resonance_tier;
      new.streak_days := old.streak_days;
      new.longest_streak := old.longest_streak;
      new.replies_count := old.replies_count;
      new.likes_received := old.likes_received;
      new.tier := old.tier;
      new.badges := old.badges;
      new.voip_flagged_at := old.voip_flagged_at;
      new.country_changed_at := old.country_changed_at;
      new.created_at := old.created_at;
      new.id := old.id;
    end if;
  end if;

  return new;
end;
$function$;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm all five bypass-guarded columns are present in the live
--    function body (should return 5 rows: answers_count, last_vote_at,
--    welcome_sms_sent_at, checked_line_type_at,
--    last_comparison_attempt_at):
--    select unnest(regexp_matches(
--      pg_get_functiondef('public.protect_admin_columns()'::regprocedure),
--      'new\.(welcome_sms_sent_at|checked_line_type_at|answers_count|last_vote_at|last_comparison_attempt_at)\s*:=',
--      'g'
--    ));
--
-- 2. As a non-admin, confirm neither column can be reset directly:
--    update profiles set welcome_sms_sent_at = null, checked_line_type_at = null
--    where id = auth.uid();
--    -- both columns should still hold their prior value afterward.
--
-- 3. Run the weekly check by hand and confirm it's quiet:
--    select public.run_security_checks();
--    -- then check anomaly_log for a NEW unprotected_profile_columns row
--    -- (there shouldn't be one).
--
-- 4. Resolve the 2026-09-13 anomaly_log row for this in the admin
--    Reports tab now that the underlying issue is fixed, if it's still
--    showing as unresolved.
-- ============================================================
