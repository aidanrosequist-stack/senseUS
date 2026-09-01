-- migration: 061_get_conversation_comments.sql
--
-- CONTEXT (Aidan, 2026-09-01): the vote-history-reconstruction finding
-- from the round-3 pen test rested on a premise Aidan questioned --
-- "in order to get someone's uid, they would have to share it, wouldn't
-- they?" -- that turned out not to hold. Conversation.jsx's comments
-- query already selects every commenter's raw user_id directly:
--
--   supabase.from('comments').select('id, body, ..., user_id, ...')
--
-- and profiles.display_preference defaults to 'full' (real first name +
-- last initial, migration 000), so an ordinary comment already pairs a
-- real name with a raw user_id in the same network response, with zero
-- cooperation needed from the person being identified beyond posting one
-- public comment. Aidan's call: "I don't like that users broadcast that
-- information every time they comment... is there a way to hide that
-- info?"
--
-- FIX: stop sending other users' raw user_id to the client at all. This
-- replaces Conversation.jsx's three-call pattern --
--   1. comments select (included raw user_id)
--   2. get_public_profiles(commenterIds)      (migration 054)
--   3. get_commenter_vote_choices(...)         (migration 051)
-- -- with one SECURITY DEFINER RPC that joins comments + profiles +
-- votes server-side for a single question, and returns a
-- server-computed is_own boolean plus the already-joined display/vote
-- fields the page actually renders. get_public_profiles and
-- get_commenter_vote_choices are both left exactly as they are --
-- Compare.jsx still calls get_public_profiles directly for its own,
-- differently-shaped need (a comparison partner's profile, not a
-- question's whole comment list), and get_commenter_vote_choices has no
-- other remaining caller once this ships, so it's left in place rather
-- than dropped (same "revoke rather than drop" precedent as migrations
-- 051/054 took with the views they narrowed).
--
-- SCALE NOTE: bounded the same way the comments query itself already
-- was -- one question, ordered by resonance_count, capped at 500 rows.
-- The join keys (comments.question_id, votes.question_id, profiles.id)
-- are all already indexed (idx_comments_question_id, idx_votes_question_id,
-- profiles' primary key), so cost scales with activity on one question,
-- not with total platform user count.
--
-- Left/right joins throughout: a comment's author always has a live
-- profiles row (profiles.id -> comments.user_id is enforced by
-- comments_user_id_fkey ON DELETE CASCADE, so a deleted account's
-- comments are gone too, not orphaned) and may or may not have voted on
-- this specific question -- LEFT JOIN votes so a comment from someone
-- who hasn't voted here still comes back with vote_choice null rather
-- than being dropped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_conversation_comments(p_question_id uuid)
 RETURNS TABLE(
   id uuid,
   body text,
   resonance_count integer,
   created_at timestamp with time zone,
   parent_id uuid,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
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
    c.id,
    c.body,
    c.resonance_count,
    c.created_at,
    c.parent_id,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name,
    v.choice as vote_choice
  from public.comments c
  left join public.profiles p on p.id = c.user_id
  left join public.votes v on v.user_id = c.user_id and v.question_id = p_question_id
  where c.question_id = p_question_id
    and c.is_deleted = false
  order by c.resonance_count desc
  limit 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_conversation_comments(uuid) TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked here explicitly so this function
-- isn't born with that gap.
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM PUBLIC;

-- Matches "Authenticated users can view comments" (migration 041, TO
-- authenticated only) -- logged-out visitors never had comment read
-- access in the first place, so this doesn't change who can see
-- anything, only what shape the data over-the-wire takes for people who
-- already could.
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_conversation_comments', 'Client RPC (Conversation.jsx) -- single call replacing the comments select + get_public_profiles + get_commenter_vote_choices pattern, so another user''s raw user_id is never sent to the client at all. Computes is_own server-side via auth.uid() and returns pre-joined display name / vote fields instead. Migration 061 (2026-09-01), closing the vote-history/identity-deanonymization gap raised in the round-3 pen test.')
ON CONFLICT (function_name) DO NOTHING;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As an authenticated test user, call it against a real question id
--    with existing comments:
--    select * from get_conversation_comments('<a real question id>'::uuid);
--    -> returns that question's comments (max 500, ordered by
--       resonance_count desc), each row's is_own true only for your own
--       comments, and no user_id column at all.
--
-- 2. Confirm anon truly cannot call it:
--    select has_function_privilege('anon', 'public.get_conversation_comments(uuid)', 'EXECUTE');
--    -> should return false.
