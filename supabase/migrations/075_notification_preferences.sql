-- migration: 075_notification_preferences.sql
--
-- CONTEXT (Aidan, 2026-09-08): planning ahead for real push notifications
-- once senseUS is an actual installed app, not just a website — two
-- pieces needed: (1) which events are even worth pushing, and (2) a way
-- for someone to turn each of those on/off. This migration is just the
-- data model for #2 (plus a Settings page shipped alongside it) — it
-- does NOT send any real push notification yet. Nothing in this codebase
-- currently talks to FCM/APNs at all; "notification" today only ever
-- means a row in public.notifications delivered over a live Realtime
-- subscription while the app happens to be open (see the
-- generate_short_token / cast_vote conversation history for how that
-- works today). Building this preferences table now, ahead of the real
-- push wiring, means someone's stated intent is already captured and
-- respected the moment push delivery actually exists — nothing about
-- this table needs to change when that follow-up piece is built, only
-- something new needs to start reading it.
--
-- CATEGORIES AND DEFAULTS (see the design conversation for the reasoning
-- behind each):
--   push_replies              on   -- someone replied to your comment
--   push_comparison_accepted  on   -- someone accepted your comparison invite
--   push_comment_milestone    on   -- your comment hit a reply/resonance milestone
--   push_badge_earned         on   -- you earned a badge
--   push_streak_ending        on   -- your voting streak lapses soon
--   push_tier_milestone       on   -- resonance tier / integrity weight milestone
--   push_breaking_news        on   -- admin "push as breaking news"
--   push_sponsored_question   on   -- a sponsored question (peer or business-sourced,
--                                     not purely ad-like -- Aidan's call, on by default)
--   push_matching_question   off   -- new question matching your usual categories --
--                                     the one candidate for constant/spammy, so this
--                                     is the one category that starts opted OUT
--   push_moderation_action     on   -- your content was flagged/removed
--
-- Deliberately NOT a column here: security alerts (new device sign-in,
-- password/email changed, account deletion requested). Those aren't
-- meant to be optional -- same reasoning as why a bank doesn't let you
-- turn off "your password was changed" emails -- so there's nothing to
-- store a preference for; a future push-sending step should just always
-- send those regardless of this table's contents.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_replies boolean NOT NULL DEFAULT true,
  push_comparison_accepted boolean NOT NULL DEFAULT true,
  push_comment_milestone boolean NOT NULL DEFAULT true,
  push_badge_earned boolean NOT NULL DEFAULT true,
  push_streak_ending boolean NOT NULL DEFAULT true,
  push_tier_milestone boolean NOT NULL DEFAULT true,
  push_breaking_news boolean NOT NULL DEFAULT true,
  push_sponsored_question boolean NOT NULL DEFAULT true,
  push_matching_question boolean NOT NULL DEFAULT false,
  push_moderation_action boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Same auth.uid()-wrapped-in-a-subquery style as every other per-user RLS
-- policy in this schema (profiles, comparison_tokens) -- lets the planner
-- evaluate it once per query instead of once per row.
CREATE POLICY "Users can view own notification preferences"
  ON public.notification_preferences FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own notification preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- No DELETE policy: a row goes away only via the ON DELETE CASCADE from
-- profiles, never directly -- there's no product reason for someone to
-- delete their own preferences row (the worst case if they somehow did
-- is just falling back to column defaults on next insert).

GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;

-- ---------- keep updated_at honest without trusting the client for it ----------
CREATE OR REPLACE FUNCTION public.touch_notification_preferences_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS touch_notification_preferences_updated_at_trigger ON public.notification_preferences;
CREATE TRIGGER touch_notification_preferences_updated_at_trigger
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_preferences_updated_at();

-- ---------- auto-create a default row for every profile ----------
--
-- Profile creation happens client-side today (useRegistration.js's
-- completeRegistration upserts into public.profiles directly -- there's
-- no AFTER INSERT ON auth.users trigger in this schema at all). Rather
-- than adding a second client-side insert that every current AND future
-- signup path would have to remember to also call, this hangs a trigger
-- directly off profiles' own INSERT -- so a default preferences row
-- (all column defaults from above) exists the moment a profile does, no
-- matter what code path created it. SECURITY DEFINER since profiles'
-- INSERT happens as `authenticated` (the signing-up user themselves),
-- who needs to be able to write a notification_preferences row for
-- their own brand-new id regardless of this table's own RLS specifics.
CREATE OR REPLACE FUNCTION public.create_default_notification_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS create_default_notification_preferences_trigger ON public.profiles;
CREATE TRIGGER create_default_notification_preferences_trigger
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_notification_preferences();

-- Backfill: every profile that already exists today predates this
-- trigger and would otherwise have no preferences row (and therefore no
-- way to ever change these defaults) until NotificationSettings.jsx's
-- own lazy-create-on-visit fallback kicked in for them specifically.
-- Give everyone a row up front instead.
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked here explicitly, same as every other
-- function this project has added since that finding. Neither of these
-- two functions is a client RPC -- both only ever run as trigger bodies
-- -- so authenticated doesn't need an explicit grant either, unlike
-- generate_short_token (074), which had to be directly callable as part
-- of evaluating a column DEFAULT.
REVOKE EXECUTE ON FUNCTION public.touch_notification_preferences_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_notification_preferences_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_notification_preferences() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_notification_preferences() FROM anon, authenticated;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Every existing profile now has a preferences row:
--    select count(*) from public.profiles;
--    select count(*) from public.notification_preferences;
--    -> should match.
--
-- 2. A brand new signup gets one automatically (no client-side insert
--    needed): register a fresh test account, then
--    select * from public.notification_preferences where user_id = '<new id>';
--    -> one row, every push_* column at its documented default.
--
-- 3. RLS: as a non-admin authenticated user, confirm you can select and
--    update your own row but get zero rows back querying anyone else's
--    user_id.
--
-- 4. updated_at actually changes: update one of your own push_* columns
--    and re-select -- updated_at should have moved to "now", even though
--    the client never set it.
-- ============================================================
