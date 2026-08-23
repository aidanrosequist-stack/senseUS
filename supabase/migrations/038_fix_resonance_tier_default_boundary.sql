-- senseUS: fix resonance_tier's default so it's consistent with
-- resonance_score's default, per the app's own tier table.
--
-- BACKGROUND: profiles.resonance_score defaults to 50, and the Resonance
-- Score info modal (src/pages/Profile.jsx) tells users exactly what that
-- means: "A score of 50 means you're perfectly in the middle," and its
-- own reference table defines the six tiers as Trailblazer (0-9),
-- Contrarian (10-24), Independent (25-49), Aligned (50-74), Resonant
-- (75-90), Chorus (91-100) — a score of 50 falls in Aligned by that
-- table. But profiles.resonance_tier defaults to 'Independent', not
-- 'Aligned'. Nothing in this codebase ever recalculates either column
-- (confirmed by searching every migration for a setter beyond the
-- column defaults and the "carry the old value forward" guards in the
-- profile-update triggers) — so every account's score and tier just sit
-- at these two mutually-inconsistent defaults forever, and everyone sees
-- "Independent" next to a score that the modal's own table calls
-- "Aligned."
--
-- FIX: change resonance_tier's default to 'Aligned' to match
-- resonance_score's default of 50, and backfill existing rows that are
-- still sitting at the original stale default pair (score = 50 and
-- tier = 'Independent' — which, since nothing has ever changed either
-- column, is realistically every row today). Rows that somehow already
-- have a different tier are left untouched.
--
-- NOTE for Aidan: this fixes the inconsistency between the two defaults;
-- it does not add the (much bigger) feature of actually computing a
-- real resonance score from voting alignment — that doesn't exist
-- anywhere in this codebase yet, scored or scheduled. If real scoring is
-- wanted, that's a separate feature to design and build, not a bug fix.
-- ============================================================

alter table public.profiles
  alter column resonance_tier set default 'Aligned';

update public.profiles
set resonance_tier = 'Aligned'
where resonance_score = 50
  and resonance_tier = 'Independent';
