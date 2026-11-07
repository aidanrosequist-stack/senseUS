-- senseUS: Comment Awards -- two more award types, added after
-- 105_comment_awards.sql shipped (Aidan, same 2026-11-02 conversation,
-- as a follow-up once he saw the original 10-item catalog):
--
--   * 'taught-me-something' (positive, cost 1) -- "you learned something
--     new from this." Inserted at sort_order 9, right after Good-Faith
--     Disagreement and before the two existing negative everyday awards,
--     so the picker's "Everyday" grid keeps all six positive awards
--     grouped before the negative ones (AwardPicker.jsx's grouping is
--     cost-based, not polarity-based, but within a cost group it renders
--     in catalog/sort_order, so this keeps that visual grouping intact).
--
--   * 'spelling-grammar' (negative, cost 1) -- "riddled with typos or
--     grammar mistakes," Aidan's own suggestion, icon drawn as a literal
--     "abc" with a red squiggly underline per his own description.
--     Appended at the end (sort_order 12).
--
--   Aidan also floated a positive "good spelling" counterpart to pair
--   with this one and then explicitly decided against it ("that's fine,
--   we can skip it") after being talked through why it doesn't fit the
--   substance-based theme of the other six positive everyday awards --
--   deliberately NOT added here or anywhere.
--
-- Existing sort_order values for 'needs-a-source' (9 -> 10) and
-- 'off-topic' (10 -> 11) shift by one to make room for
-- 'taught-me-something' at 9. 'spelling-grammar' lands at 12.
--
-- No function changes needed: give_comment_award() already validates
-- any award_type generically via a join against award_types (no
-- hardcoded id list), get_conversation_comments()'s award_counts jsonb
-- aggregation is generic over whatever award_types exist,
-- get_comment_award_details() is generic too, and
-- get_top_awarded_comments()'s gold_star_count column only ever filters
-- specifically on 'gold-star' (unaffected by anything added here).
-- calculate_badges()'s award-giver/well-regarded/gold-standard counts are
-- likewise generic over comment_awards rows regardless of award_type.
-- Confirmed by re-reading all four functions before writing this
-- migration.
-- ============================================================

INSERT INTO public.award_types (id, cost, is_negative, sort_order) VALUES
  ('taught-me-something', 1, false, 9),
  ('spelling-grammar', 1, true, 12);

UPDATE public.award_types SET sort_order = 10 WHERE id = 'needs-a-source';
UPDATE public.award_types SET sort_order = 11 WHERE id = 'off-topic';

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. select id, cost, is_negative, sort_order from public.award_types
--    order by sort_order;
--    -> 12 rows, 'taught-me-something' at 9, 'needs-a-source' at 10,
--    'off-topic' at 11, 'spelling-grammar' at 12, nothing else moved.
--
-- 2. select public.give_comment_award('<someone else's comment id>',
--    'taught-me-something');
--    -> succeeds, spends 1 point, same as any other everyday award.
--
-- 3. select public.give_comment_award('<someone else's comment id>',
--    'spelling-grammar');
--    -> succeeds, spends 1 point.
--
-- 4. get_conversation_comments() on a question with one of each new
--    award given -> award_counts includes 'taught-me-something' and/or
--    'spelling-grammar' keys alongside any pre-existing ones.
-- ============================================================
