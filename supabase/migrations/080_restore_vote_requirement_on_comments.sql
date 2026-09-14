-- migration: 080_restore_vote_requirement_on_comments.sql
--
-- Found by the round-4 pen test (PENETRATION_TEST_ROUND4_2026-09-14.md,
-- 2026-09-14): commenting without ever voting is possible again.
--
-- Migration 062 (Sept 2) added a real vote-exists check to comments'
-- INSERT policy, per Aidan's explicit requirement ("it is important to
-- me that everyone votes in order to comment... if there's a way to
-- work around not voting but still commenting, it needs to be
-- hardened"). Migration 071 (Sept 4), while adding the correct
-- pulled-question check (a real, separate, and still-needed
-- protection), did its own `DROP POLICY` + `CREATE POLICY` on the exact
-- same policy instead of building on 062's version -- writing a fresh
-- WITH CHECK that dropped the votes EXISTS clause entirely:
--
--   -- 062 (Sept 2) -- correct
--   WITH CHECK (
--     (SELECT auth.uid()) = user_id
--     AND EXISTS (SELECT 1 FROM votes WHERE votes.user_id = comments.user_id
--                 AND votes.question_id = comments.question_id)
--   )
--
--   -- 071 (Sept 4) -- replaced it outright, votes check gone
--   WITH CHECK (
--     (SELECT auth.uid()) = user_id
--     AND EXISTS (SELECT 1 FROM questions q WHERE q.id = comments.question_id
--                 AND q.pulled_at IS NULL)
--   )
--
-- Confirmed live (via pg_get_expr on the real policy object, not just
-- the migration file) and reproduced end to end: a brand-new test
-- account with zero votes anywhere on the platform could insert a real
-- comment via a direct `.from('comments').insert(...)` call. Applies to
-- replies as well as top-level comments -- there is only the one INSERT
-- policy on `comments`, so this was a total, not partial, reopening of
-- the gap 062 closed.
--
-- FIX: recreate the policy with BOTH conditions present at once. Neither
-- 062 nor 071 was wrong in isolation -- the bug was 071 replacing rather
-- than extending 062's WITH CHECK. Combining them here, in the one
-- migration that's now the current source of truth for this policy,
-- closes this same regression class going forward too: anyone who next
-- has a real reason to touch this policy sees the full, current set of
-- conditions in git, not two conditions added three-and-a-half weeks
-- apart in different files with no cross-reference between them.
--
-- Also narrowed `TO public` -> `TO authenticated`, matching the
-- "don't rely on incidental protection" principle from migration 079
-- (comparison_tokens) earlier the same day -- not a new vulnerability
-- here (comments.user_id is NOT NULL, so `auth.uid() = user_id` already
-- can't be satisfied by anon, whose auth.uid() is always null), just
-- removing a role scope wider than intended while this exact policy is
-- already being touched for a real reason.
-- ============================================================

DROP POLICY IF EXISTS "Users can insert own comments" ON public.comments;
CREATE POLICY "Users can insert own comments"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.votes
      WHERE votes.user_id = comments.user_id
        AND votes.question_id = comments.question_id
    )
    AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = comments.question_id AND q.pulled_at IS NULL
    )
  );

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As an authenticated test user who has NOT voted on some question Q
--    (and Q is not pulled), try to insert a comment on Q directly:
--    insert into comments (question_id, user_id, body)
--    values ('<question Q id>', auth.uid(), 'test');
--    -> should fail with a row-level security policy violation (this is
--    the exact case the round-4 pen test found succeeding).
--
-- 2. Vote on Q as that same user, then repeat the same insert.
--    -> should succeed (062's original behavior, restored).
--
-- 3. As a user who HAS voted on a question that is currently pulled,
--    try to insert a comment on it.
--    -> should still fail (071's protection, unaffected by this fix).
--
-- 4. Confirm ordinary commenting/replying through the app still works
--    normally for an already-voted, non-pulled question -- no
--    user-facing change is expected for the legitimate path.
-- ============================================================
