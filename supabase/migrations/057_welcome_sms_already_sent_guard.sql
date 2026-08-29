-- senseUS: prevent send-welcome-sms from re-sending (and re-billing) the
-- welcome text for an account that's already gotten one.
--
-- CONTEXT (Aidan, 2026-08-29): send-welcome-sms/index.ts verifies the
-- caller owns the phone number, then sends via Twilio with no check at
-- all for whether this account has already received a welcome SMS.
-- useRegistration.js's completeRegistration() fires it fire-and-forget
-- (only a .catch(), no retry logic today) right after the profile
-- upsert succeeds -- but a retried/duplicated client call (a flaky
-- connection causing a second registration attempt, a user double
-- tapping, a future retry-on-failure change) would trigger a second
-- billed Twilio send with nothing in the way. Decision: add an
-- "already sent" guard.
--
-- FIX: profiles.welcome_sms_sent_at (nullable timestamptz, null until a
-- welcome SMS has actually been claimed) plus
-- claim_welcome_sms_send() -- a SECURITY DEFINER RPC the edge function
-- calls (as the caller, via the same userClient it already builds from
-- the request's own Authorization header) immediately before hitting
-- Twilio. The claim is a single atomic
-- `UPDATE ... WHERE welcome_sms_sent_at IS NULL RETURNING true`: two
-- concurrent calls for the same user serialize on that row (the second
-- blocks until the first's UPDATE commits, then sees a non-null
-- welcome_sms_sent_at and matches zero rows), so this is safe against a
-- genuine race, not just a happens-to-usually-work check-then-act.
-- Returns false (never sent, no exception) when a send was already
-- claimed, true when this call just claimed it -- the edge function
-- fails closed on either an RPC error or a false result: no claim, no
-- Twilio call.
--
-- welcome_sms_sent_at is a protected/computed column, same category as
-- answers_count and last_vote_at -- otherwise a client could
-- `supabase.from('profiles').update({ welcome_sms_sent_at: null })` and
-- defeat the guard entirely. Reuses the same transaction-local
-- bypass-flag pattern from migrations 031/055 so claim_welcome_sms_send
-- itself can still write it.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcome_sms_sent_at timestamptz;

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

CREATE OR REPLACE FUNCTION public.claim_welcome_sms_send()
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
  perform set_config('senseus.bypass_welcome_sms_sent_at_protection', 'true', true);

  update public.profiles
  set welcome_sms_sent_at = now()
  where id = v_user_id
    and welcome_sms_sent_at is null
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_welcome_sms_send() TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked explicitly here so this function
-- isn't born with that gap.
REVOKE EXECUTE ON FUNCTION public.claim_welcome_sms_send() FROM PUBLIC;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('claim_welcome_sms_send', 'Client RPC (supabase/functions/send-welcome-sms/index.ts, called via the caller''s own userClient) -- atomically claims the one-time welcome SMS send for the calling account, returning false with no side effect if already claimed. Migration 057 (2026-08-29), preventing a retried/duplicated registration flow from triggering a second billed Twilio send.')
ON CONFLICT (function_name) DO NOTHING;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. First claim for a fresh account succeeds:
--    select public.claim_welcome_sms_send(); -- as that user -> true
--
-- 2. Immediate second claim for the same account fails, no side effect:
--    select public.claim_welcome_sms_send(); -- as that user -> false
--
-- 3. A direct client write attempt --
--    `supabase.from('profiles').update({ welcome_sms_sent_at: null })`
--    as a normal signed-in user -- should be silently reverted by
--    protect_admin_columns(), same as answers_count/last_vote_at
--    already are.
-- ============================================================
