-- senseUS: add "current events" as its own question category
--
-- CONTEXT: part of the vote-feed rebalance discussed 2026-08-25. Today's
-- categories are fun / hot take / deep / topical / tracking / sponsored,
-- enforced by questions_category_check. "topical" was the closest
-- existing value to "current events" but isn't the same thing to Aidan,
-- so this adds a genuine 7th category rather than reusing topical.
--
-- No other change is needed to make it show up correctly: the vote-feed
-- round-robin in src/hooks/useQuestions.js groups regular questions by
-- whatever distinct values are present in `category` (Object.keys on a
-- dynamically-built map, not a hardcoded list), so a new category value
-- is picked up automatically once questions use it. The only other place
-- category values are enumerated is the CATEGORIES array in Admin.jsx
-- (the two "add/edit question" dropdowns), updated alongside this.
-- ============================================================

ALTER TABLE public.questions
  DROP CONSTRAINT questions_category_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_category_check
  CHECK (category = ANY (ARRAY[
    'fun'::text,
    'hot take'::text,
    'deep'::text,
    'topical'::text,
    'tracking'::text,
    'sponsored'::text,
    'current events'::text
  ]));
