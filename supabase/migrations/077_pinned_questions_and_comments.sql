-- migration: 077_pinned_questions_and_comments.sql
--
-- CONTEXT (Aidan, 2026-09-08): a "pin" feature so people can keep track of
-- specific questions and comments they want to come back to, separate
-- from resonating (which is a public "I agree with this" signal that
-- feeds resonance_count/scoring). Pinning is purely personal bookmarking
-- -- private to the pinner, no effect on the pinned item itself, no
-- visibility to anyone else. Surfaced in a new "Pinned" tab on /activity
-- with a Questions/Comments toggle.
--
-- Two new tables, following the same shape as comment_resonances
-- (surrogate uuid PK, a real unique constraint, cascade-delete FKs both
-- ways so a pin quietly disappears if the pinned item or the pinning
-- user's profile is ever deleted):
--   pinned_questions (user_id, question_id)
--   pinned_comments  (user_id, comment_id)
--
-- UNLIKE comment_resonances (publicly viewable -- resonance counts are
-- public), these are private: RLS only lets a user see/insert/delete
-- their OWN pins. No restriction on pinning your own question/comment
-- (unlike comment_resonances' insert policy, which blocks self-
-- resonance) -- tracking your own post is a completely reasonable thing
-- to want.
--
-- get_pinned_comments(): a SECURITY DEFINER RPC, same reasoning as
-- get_conversation_comments() (migration 061/072) -- a pinned comment can
-- belong to another user, and this app never sends another user's raw
-- user_id to the client. Resolves display name + the frozen vote_choice
-- snapshot server-side, joined with the question it belongs to (needed
-- for the "Pinned" tab's card, which shows the question as context above
-- the comment). Filtered to non-hard-deleted comments (is_deleted =
-- false, matching get_conversation_comments' own filter) -- a comment
-- that's merely self-deleted (is_removed = true) still shows up pinned,
-- rendered as "[deleted by user]" by the same frontend logic Conversation
-- already uses, since that's a real, meaningful state to see; a comment
-- that's been hard-deleted is caught by the FK's ON DELETE CASCADE
-- anyway and its pin row is simply gone.
--
-- pinned_questions needs no equivalent RPC: questions carries no other
-- user's identity, and Explore.jsx already reads the questions table
-- directly under RLS -- the Pinned tab's "Questions" list does the same
-- (a plain nested select through pinned_questions), consistent with how
-- Explore already fetches questions today.
-- ============================================================

CREATE TABLE public.pinned_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pinned_questions_user_id_question_id_key UNIQUE (user_id, question_id)
);

CREATE TABLE public.pinned_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pinned_comments_user_id_comment_id_key UNIQUE (user_id, comment_id)
);

CREATE INDEX idx_pinned_questions_user_id ON public.pinned_questions (user_id);
CREATE INDEX idx_pinned_comments_user_id ON public.pinned_comments (user_id);

ALTER TABLE public.pinned_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinned_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pinned questions"
  ON public.pinned_questions FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can pin questions"
  ON public.pinned_questions FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can unpin questions"
  ON public.pinned_questions FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can view own pinned comments"
  ON public.pinned_comments FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can pin comments"
  ON public.pinned_comments FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can unpin comments"
  ON public.pinned_comments FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, DELETE ON public.pinned_questions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.pinned_comments TO authenticated;

-- ============================================================
-- get_pinned_comments(): the current user's pinned comments, newest pin
-- first, joined with the comment's question (for the card's bold
-- "question" header) and the frozen vote-choice/display-name fields
-- get_conversation_comments() already resolves the same way.
-- ============================================================

CREATE FUNCTION public.get_pinned_comments()
 RETURNS TABLE(
   comment_id uuid,
   pinned_at timestamp with time zone,
   body text,
   created_at timestamp with time zone,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
   question_id uuid,
   question_text text,
   question_number integer,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   vote_choice text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id as comment_id,
    pc.created_at as pinned_at,
    c.body,
    c.created_at,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    q.id as question_id,
    q.text as question_text,
    q.question_number,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name,
    c.vote_choice_at_comment as vote_choice
  from public.pinned_comments pc
  join public.comments c on c.id = pc.comment_id
  join public.questions q on q.id = c.question_id
  left join public.profiles p on p.id = c.user_id
  where pc.user_id = auth.uid()
    and c.is_deleted = false
  order by pc.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pinned_comments() TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked here explicitly, same as every other
-- client RPC in this codebase.
REVOKE EXECUTE ON FUNCTION public.get_pinned_comments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pinned_comments() FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_pinned_comments', 'Client RPC (Activity.jsx''s Pinned tab) -- the current user''s pinned comments joined with their question and frozen display-name/vote-choice fields, same reasoning as get_conversation_comments(): another user''s raw user_id is never sent to the client. is_own computed server-side via auth.uid(). Migration 077 (2026-09-08).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Pin a question and a comment (including one authored by someone
--    else) as user A. Confirm user B cannot see either pin (SELECT
--    against pinned_questions/pinned_comments while impersonating B
--    returns zero rows for A's pins).
--
-- 2. get_pinned_comments() as user A returns the pinned comment with the
--    right question_text, and is_own is only true for the comment A
--    actually authored.
--
-- 3. Unpin (DELETE own row) succeeds; attempting to delete another
--    user's pin (impersonating a different uid) affects zero rows.
--
-- 4. Delete the underlying comment (as its author, or hard-delete) --
--    its pinned_comments row disappears via cascade. Same for a
--    question and pinned_questions.
--
-- 5. Delete a profile -- every pinned_questions/pinned_comments row with
--    that user_id disappears via cascade.
