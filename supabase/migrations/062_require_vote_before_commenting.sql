-- migration: 062_require_vote_before_commenting.sql
--
-- CONTEXT (Aidan, 2026-09-02): while spot-checking the new
-- get_conversation_comments() output (migration 061), a real comment
-- turned up with no matching row in votes at all (vote_choice came back
-- null). Conversation.jsx only *looks* like it requires a vote before
-- commenting -- canParticipate = !!userVote gates the textarea, the
-- reply button, and the "vote to speak your mind" placeholder -- but
-- that's client-side UX only. The actual INSERT policy on comments
-- (migration 041) never checked for a vote:
--
--   CREATE POLICY "Users can insert own comments"
--     ON public.comments FOR INSERT
--     WITH CHECK ((SELECT auth.uid()) = user_id);
--
-- Nothing stopped a signed-in user from calling
-- `supabase.from('comments').insert(...)` directly (devtools, a script,
-- or simply a client bug) for a question they'd never voted on. Aidan's
-- call: "it is important to me that everyone votes in order to
-- comment... if there's a way to work around not voting but still
-- commenting, it needs to be hardened."
--
-- FIX: same pattern already used for comment_resonances' own INSERT
-- policy (migration 041 -- WITH CHECK ... AND EXISTS (SELECT 1 FROM
-- comments WHERE comments.id = comment_resonances.comment_id AND
-- comments.user_id <> auth.uid())) -- add a correlated EXISTS check to
-- comments' own INSERT policy requiring a real votes row for that exact
-- (user_id, question_id) pair before the insert is allowed. This
-- applies to replies too, not just top-level comments -- a reply's
-- question_id is the same question as its parent's, and the app's own
-- canParticipate gate already covered both (see the `depth <
-- MAX_REPLY_DEPTH && canParticipate` check in CommentCard) -- so this
-- closes the gap exactly where the app's own UI already intended the
-- line to be, just enforced where it actually matters.
--
-- This only gates new inserts going forward, same as any RLS policy --
-- it can't retroactively touch a comment that already exists without a
-- matching vote (like the one that surfaced this gap). That row is left
-- as-is; nothing in this migration deletes or modifies existing data.
-- ============================================================

DROP POLICY IF EXISTS "Users can insert own comments" ON public.comments;
CREATE POLICY "Users can insert own comments"
  ON public.comments FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.votes
      WHERE votes.user_id = comments.user_id
        AND votes.question_id = comments.question_id
    )
  );

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As an authenticated test user who has NOT voted on some question Q,
--    try to insert a comment on Q directly:
--    insert into comments (question_id, user_id, body)
--    values ('<question Q id>', auth.uid(), 'test');
--    -> should fail with a row-level security policy violation.
--
-- 2. Vote on Q as that same user, then repeat the same insert.
--    -> should succeed.
--
-- 3. Confirm ordinary commenting/replying through the app still works
--    normally for an already-voted question -- no user-facing change
--    is expected here at all.
