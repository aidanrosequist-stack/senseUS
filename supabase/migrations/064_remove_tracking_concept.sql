-- migration: 064_remove_tracking_concept.sql
--
-- CONTEXT (Aidan, 2026-09-02): "tracking" turned out to be three
-- unrelated things sharing one confusing name -- the 'tracking'
-- question category, the is_tracking_anchor boolean (a live
-- feed-boost: Admin's now-removed 📍 toggle bumped a question near the
-- top of every feed), and the real trend-over-time feature, which was
-- never either of those -- it's question_snapshots + the daily
-- take_question_snapshots() cron job, untouched by this migration and
-- still running. Aidan's call, once that was untangled: retire the
-- category and the anchor-boost feature entirely, everywhere.
--
-- Frontend already updated in the same change: Admin.jsx (CATEGORIES
-- list, the is_tracking_anchor form field/toggle/badge, the
-- toggleTrackingAnchor function), Explore.jsx (CATEGORIES list),
-- Vote.jsx (dropped from its select), useQuestions.js (the
-- trackingQuestions feed bucket is gone -- anchor-marked questions now
-- flow into the regular category-stratified pool like everything else).
--
-- *** BEFORE PUSHING *** -- this tightens questions_category_check, so
-- it will fail to apply if any question is still tagged 'tracking'.
-- Check first:
--
--   select id, question_number, text from questions where category = 'tracking';
--
-- If that returns any rows, recategorize them (pick whichever of fun /
-- hot take / deep / topical / sponsored / current events actually fits
-- each one) before running this migration.
--
-- question_categories is a separate, apparently-unused table (nothing
-- in the app reads from it -- it doesn't show up anywhere outside this
-- file's own CREATE TABLE) that happens to carry the same category
-- list in its own check constraint, already out of sync with
-- questions_category_check (it was never updated for migration 043's
-- 'current events' addition). Synced here too while removing
-- 'tracking', since it's the same one-line list and there's no reason
-- to leave it half-updated. Its own DELETE below is safe regardless --
-- no foreign key anywhere references question_categories.
-- ============================================================

DELETE FROM public.question_categories WHERE name = 'tracking';

ALTER TABLE public.question_categories
  DROP CONSTRAINT question_categories_name_check;
ALTER TABLE public.question_categories
  ADD CONSTRAINT question_categories_name_check
  CHECK (name = ANY (ARRAY[
    'fun'::text,
    'hot take'::text,
    'deep'::text,
    'topical'::text,
    'sponsored'::text,
    'current events'::text
  ]));

ALTER TABLE public.questions
  DROP CONSTRAINT questions_category_check;
ALTER TABLE public.questions
  ADD CONSTRAINT questions_category_check
  CHECK (category = ANY (ARRAY[
    'fun'::text,
    'hot take'::text,
    'deep'::text,
    'topical'::text,
    'sponsored'::text,
    'current events'::text
  ]));

ALTER TABLE public.questions
  DROP COLUMN is_tracking_anchor;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. No question can be tagged 'tracking' anymore:
--    insert into questions (text, category, domain, published_at)
--    values ('test', 'tracking', 'ethics & philosophy', now());
--    -> should fail with a check constraint violation. Don't forget to
--       not actually leave this test row around if it somehow succeeds.
--
-- 2. Admin's add-question form no longer offers "tracking" as a
--    category option or shows the "Tracking anchor" checkbox.
-- ============================================================
