-- senseUS: narrow public_profiles the same way migration 051 narrowed
-- public_votes.
--
-- CONTEXT (Aidan, 2026-08-29): the still-open design question from
-- senseUS-pii-inventory.md / senseUS-open-source-readiness-checklist.md
-- -- "should any signed-in user be able to read any other named user's
-- full public_profiles row, not just the fields one screen actually
-- needs" -- is decided: narrow it, same pattern already used for
-- public_votes (migration 051), get_comparison, and
-- get_comment_reply_counts.
--
-- WHAT WAS ACTUALLY GRANTED: public_profiles exposes id, first_name,
-- last_initial, display_preference, anon_name, avatar, bio,
-- resonance_tier, and badges for every user (migration 049). Every
-- current call site only ever asks for a handful of specific ids --
-- Conversation.jsx scopes to that page's commenters, Compare.jsx scopes
-- to the other person in a comparison plus your own row -- but same as
-- the public_votes case, the app's own scoping was never what actually
-- gated access. The GRANT did. Nothing stopped a signed-in user from
-- opening devtools and calling `supabase.from('public_profiles')
-- .select('*')` with no scoping at all, pulling every user's
-- name/avatar/bio/badges in one request.
--
-- FIX: get_public_profiles(p_user_ids) -- a SECURITY DEFINER RPC that
-- returns exactly the given ids' public_profiles columns, never a
-- broader read. Returns the view's full column set (not a
-- per-call-site-trimmed subset) so every existing call site can swap
-- straight from `.from('public_profiles').select(...).in('id', [...])`
-- to `.rpc('get_public_profiles', { p_user_ids: [...] })` and just keep
-- destructuring whichever fields it already used -- same shape the view
-- itself provided, just server-scoped instead of grant-scoped.
-- `authenticated` then loses its SELECT grant on `public_profiles`
-- entirely (0 grants remain on that view, matching public_votes as of
-- 051 -- kept defined rather than dropped, same "revoke rather than
-- drop" reasoning as that migration, in case a future backend-only use
-- needs it).
--
-- Practical honesty, matching migration 051's own caveat: this closes
-- the "one query, dump everyone's profile" exposure. It doesn't make
-- display names/avatars/bios secret between users -- that was never the
-- point (they're shown on-screen by design, per each user's own
-- display_preference) -- it just means getting them now requires
-- already knowing which specific user ids you're asking about, the same
-- way every legitimate feature already works.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_user_ids uuid[])
 RETURNS TABLE(
   id uuid,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   avatar text,
   bio text,
   resonance_tier text,
   badges text[]
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.first_name, p.last_initial, p.display_preference,
         p.anon_name, p.avatar, p.bio, p.resonance_tier, p.badges
  from public.profiles p
  where p.id = any(p_user_ids)
    -- Same bound as get_commenter_vote_choices (051) -- not a security
    -- boundary by itself, just keeps one call bounded to what one page
    -- load ever needs.
    and array_length(p_user_ids, 1) <= 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked explicitly here so this function
-- isn't born with that gap.
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC;

REVOKE SELECT ON public.public_profiles FROM authenticated;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_public_profiles', 'Client RPC (Conversation.jsx, Compare.jsx) -- returns only the given user ids'' public_profiles columns, replacing direct `public_profiles` SELECTs that had no scoping at the grant level. Migration 054 (2026-08-29), closing the "any authenticated user can bulk-read every profile via public_profiles" gap raised in senseUS-pii-inventory.md.')
ON CONFLICT (function_name) DO NOTHING;

COMMENT ON VIEW public.public_profiles IS 'Curated public-facing slice of profiles (no birth_year/email/region/admin internals). As of migration 054 (2026-08-29), no role has a live grant on this view -- its two remaining clients (Conversation.jsx commenter display, Compare.jsx comparison-partner display) now go through get_public_profiles() instead, which scopes results server-side to a given set of user ids instead of allowing an unscoped table read. Left defined (not dropped) in case a future backend-only use needs it; security_invoker=false is unchanged from migration 049 and would need re-review before granting it to any role again.';

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. authenticated no longer has any grant on public_profiles:
--    select grantee, privilege_type from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'public_profiles';
--    -> should return nothing for anon or authenticated.
--
-- 2. The new RPC works and is properly scoped:
--    as an authenticated test user, call
--    select * from get_public_profiles(array['<a real user id>'::uuid]);
--    -> returns that one user's public profile fields, nothing else.
--
-- 3. Load a Conversation page with existing comments, and a Compare
--    page with an accepted comparison, signed in -- both should render
--    display names/avatars/badges exactly as they did before this
--    migration.
-- ============================================================
