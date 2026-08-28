-- senseUS: public_votes and public_profiles were set up by hand at some
-- point (never captured in any migration -- confirmed via a repo-wide
-- grep) and, per the live grants Aidan pulled from Supabase Studio on
-- 2026-08-28, both had two real problems:
--
-- 1. GRANT ... TO anon -- meaning a completely unauthenticated request
--    (no login, no account) could read every user's name/avatar/bio and
--    every vote ever cast (question_id/user_id/choice), tied together by
--    user_id. security_invoker=false on both views is what makes this
--    possible: the view runs as its owner, bypassing RLS on the
--    underlying profiles/votes tables entirely, for ANY role it's
--    granted to. Confirmed via a repo-wide route check that no
--    logged-out-reachable page (the public /q/:number preview) actually
--    needs this -- the two features that use this data (comment
--    vote-coloring, compare-with-friend) both live behind routes that
--    already require login.
--
-- 2. GRANT ALL (not just SELECT) TO anon AND authenticated -- these are
--    read-only public-facing views; there's no legitimate reason for
--    INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES to be grantable on
--    them at all. The real write paths are cast_vote() (votes) and a
--    direct profiles UPDATE (both already properly validated/RLS-gated)
--    -- a view has no business offering a second, unvalidated write path
--    alongside those.
--
-- FIX: recreate both views explicitly (matching the exact live
-- definitions Aidan pulled from pg_views on 2026-08-28, byte for byte)
-- so they stop being invisible to any future migration-file-based
-- review -- this is now the first time either view exists anywhere in
-- version control, closing that specific instance of the broader
-- "set up by hand, never captured" gap this project keeps running into.
-- Then revoke everything from anon, and leave authenticated with SELECT
-- only, preserving the current (probably intentional) "any logged-in
-- user can see this curated slice" behavior the two features above
-- depend on, while closing the actual bugs -- no-login access, and
-- spurious write grants on a read-only view.
--
-- The column selection itself was never the problem -- both views
-- already deliberately excluded sensitive columns (profiles: no
-- birth_year, recovery_email, region, admin/score internals; votes: no
-- integrity weighting) before this migration touched them.
-- ============================================================

CREATE OR REPLACE VIEW public.public_profiles AS
 SELECT id,
    first_name,
    last_initial,
    display_preference,
    anon_name,
    avatar,
    bio,
    resonance_tier,
    badges
   FROM public.profiles;

CREATE OR REPLACE VIEW public.public_votes AS
 SELECT question_id,
    user_id,
    choice
   FROM public.votes;

COMMENT ON VIEW public.public_profiles IS 'Curated public-facing slice of profiles (name/avatar/bio/badges/tier only -- no birth_year/email/region/admin/score internals). security_invoker=false (the default) is intentional: this view exists specifically to let any authenticated user see this slice regardless of the base table''s own RLS. Locked to authenticated-only, SELECT-only as of migration 049 (2026-08-28) -- previously also granted to anon and granted ALL, not just SELECT.';
COMMENT ON VIEW public.public_votes IS 'Curated public-facing slice of votes (question_id/user_id/choice only -- no integrity weighting). security_invoker=false (the default) is intentional, see public_profiles. Locked to authenticated-only, SELECT-only as of migration 049 (2026-08-28) -- previously also granted to anon and granted ALL, not just SELECT.';

REVOKE ALL ON public.public_profiles FROM anon, authenticated;
REVOKE ALL ON public.public_votes FROM anon, authenticated;

GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_votes TO authenticated;
