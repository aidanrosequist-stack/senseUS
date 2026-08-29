-- senseUS: prevent check-line-type from re-running (and re-billing) the
-- Twilio line-type lookup for an account that's already been checked.
--
-- CONTEXT (Aidan, 2026-08-29, open-source-readiness edge function audit):
-- check-line-type/index.ts verifies the caller owns the phone number,
-- then always calls Twilio Lookup and (if VOIP) writes
-- integrity_events + profiles.voip_flagged_at -- with no check for
-- whether this account has already been checked. useRegistration.js's
-- checkCode() is meant to call it exactly once, right after phone
-- verification -- but nothing stops a direct call to the function from
-- running it again for the same account. Each repeat call is a second
-- billed Twilio Lookup, a duplicate integrity_events row, and --
-- unlike a harmless no-op -- re-sets voip_flagged_at to now() each
-- time, which *extends* the 30-day weight-withholding probation window
-- (migration 010) rather than leaving it alone. Same shape of issue
-- claim_welcome_sms_send (migration 057) closed for send-welcome-sms.
-- Decision: add a matching "already checked" guard.
--
-- FIX: profiles.checked_line_type_at (nullable timestamptz, set the
-- first time this account's line type is checked, regardless of the
-- outcome -- distinct from voip_flagged_at, which is only set when the
-- result actually was VOIP) plus claim_line_type_check() -- a SECURITY
-- DEFINER RPC the edge function calls (as the caller, via the same
-- callerClient it already builds from the request's own Authorization
-- header) immediately before hitting Twilio. Same atomic
-- `UPDATE ... WHERE checked_line_type_at IS NULL RETURNING true`
-- pattern as claim_welcome_sms_send: two concurrent calls for the same
-- user serialize on that row, so this is safe against a genuine race,
-- not just a happens-to-usually-work check-then-act. Returns false
-- (no exception) when already claimed, true when this call just
-- claimed it.
--
-- Unlike send-welcome-sms (which fails closed with a 409 on an
-- already-claimed send, since the caller needs to know), check-line-type
-- must keep its existing "never block registration" contract -- an
-- already-checked account should come back exactly like the function's
-- other skip paths (Twilio Lookup failure, unexpected error):
-- {success: true, flagged: false, skipped: true}, 200 OK. See the
-- updated edge function.
--
-- checked_line_type_at is a protected/computed column, same category as
-- answers_count/last_vote_at/welcome_sms_sent_at -- otherwise a client
-- could `supabase.from('profiles').update({ checked_line_type_at: null
-- })` and defeat the guard entirely. Reuses the same transaction-local
-- bypass-flag pattern from migrations 031/055/057 so
-- claim_line_type_check itself can still write it.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS checked_line_type_at timestamptz;

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

CREATE OR REPLACE FUNCTION public.claim_line_type_check()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_claimed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in.';
  end if;

  -- Transaction-local — automatically clears at end of this call, so it
  -- can never leak into a later, unrelated statement.
  perform set_config('senseus.bypass_checked_line_type_at_protection', 'true', true);

  update public.profiles
  set checked_line_type_at = now()
  where id = v_user_id
    and checked_line_type_at is null
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_line_type_check() TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked explicitly here so this function
-- isn't born with that gap.
REVOKE EXECUTE ON FUNCTION public.claim_line_type_check() FROM PUBLIC;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('claim_line_type_check', 'Client RPC (supabase/functions/check-line-type/index.ts, called via the caller''s own callerClient) -- atomically claims the one-time line-type check for the calling account, returning false with no side effect if already claimed. Migration 058 (2026-08-29), preventing a repeated direct call from re-billing a Twilio Lookup and re-extending the VOIP probation window.')
ON CONFLICT (function_name) DO NOTHING;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. First claim for a fresh account succeeds:
--    select public.claim_line_type_check(); -- as that user -> true
--
-- 2. Immediate second claim for the same account fails, no side effect:
--    select public.claim_line_type_check(); -- as that user -> false
--
-- 3. A direct client write attempt --
--    `supabase.from('profiles').update({ checked_line_type_at: null })`
--    as a normal signed-in user -- should be silently reverted by
--    protect_admin_columns(), same as welcome_sms_sent_at/last_vote_at
--    already are.
-- ============================================================
