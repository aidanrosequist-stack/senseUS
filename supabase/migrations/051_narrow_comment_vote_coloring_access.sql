-- senseUS: keep comment vote-coloring, close the "any authenticated user
-- can read any other user's full vote history" gap it depended on.
--
-- CONTEXT (Aidan, 2026-08-28): comment vote-coloring is a deliberate
-- design choice -- each comment is colored by how its author voted on
-- the question it's under. But the way it's currently built,
-- Conversation.jsx colors comments by querying `public_votes` directly
-- from the client:
--
--   supabase.from('public_votes').select('user_id, choice')
--     .eq('question_id', questionId).in('user_id', commenterIds)
--
-- The APP only ever asks for the handful of commenters on one question --
-- but the database GRANT behind `public_votes` (authenticated: SELECT,
-- since migration 049) doesn't know that. Nothing stops a signed-in user
-- from opening devtools and calling `supabase.from('public_votes')
-- .select('*')` directly, with no scoping at all -- the grant is what
-- actually gates access, not what the app's own UI code chooses to ask
-- for. That's the exact gap Aidan flagged: "I do want the comments to be
-- color-coded, but I don't want anybody's vote history to be
-- discoverable." Both are achievable -- they just can't both be true
-- while the client talks to `public_votes` directly.
--
-- FIX: same pattern already used elsewhere in this codebase
-- (get_comparison, get_comment_reply_counts) -- a purpose-built,
-- SECURITY DEFINER RPC that does the scoping SERVER-SIDE, so there's no
-- way to call it and get more than what one page legitimately needs.
-- get_commenter_vote_choices(p_question_id, p_user_ids) returns exactly
-- "these specific people's choice on this specific question," never a
-- user's history across questions, and never anyone's choice beyond the
-- ids the caller already has (their own page's own commenter list).
-- `authenticated` then loses direct SELECT on `public_votes` entirely --
-- with this migration, the view has zero remaining grants to anyone but
-- postgres/service_role (kept, rather than dropped, in case a future
-- backend-only use ever needs it -- the same "revoke rather than drop"
-- pattern migration 049 used for the authenticated-write grant it
-- removed).
--
-- Practical honesty, not oversold: this closes the "one query, dump
-- everything" exposure, the same way it was already closed for
-- `get_comparison` (migration 020's own comment on that function is
-- explicit that it doesn't change the trust model, just the query
-- shape). It does not make vote choices cryptographically hidden from
-- other users -- a determined authenticated user could still script
-- repeated calls (one per question, with a guessed user id) to
-- reconstruct a specific target's history over time, the same
-- already-accepted risk `get_comparison` carries for its own "theirs"
-- side. What it removes is the one-line, no-effort, whole-table read
-- that existed before.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_commenter_vote_choices(p_question_id uuid, p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, choice text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.user_id, v.choice
  from public.votes v
  where v.question_id = p_question_id
    and v.user_id = any(p_user_ids)
    -- Same 500-row shape as the comment list itself (Conversation.jsx
    -- caps commentsData at 500) -- not a security boundary by itself,
    -- just keeps one call bounded to what one page load ever needs.
    and array_length(p_user_ids, 1) <= 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_commenter_vote_choices(uuid, uuid[]) TO authenticated;

-- Postgres grants EXECUTE to the PUBLIC pseudo-role on every CREATE
-- FUNCTION by default -- a separate mechanism from the anon/authenticated
-- default-privileges rule, and one that migration 050 didn't account for
-- (see migration 052, which corrects that gap for 050's own functions).
-- Revoked here explicitly so this new function isn't born with the same
-- issue while it waits for 052 to fix the underlying default going
-- forward.
REVOKE EXECUTE ON FUNCTION public.get_commenter_vote_choices(uuid, uuid[]) FROM PUBLIC;

REVOKE SELECT ON public.public_votes FROM authenticated;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_commenter_vote_choices', 'Client RPC (Conversation.jsx) -- returns only the given user ids'' choice on the given single question, replacing a direct `public_votes` SELECT that had no scoping at the grant level. Migration 051 (2026-08-28), closing the "any authenticated user can bulk-read the whole votes table via public_votes" gap while keeping the comment vote-coloring feature.')
ON CONFLICT (function_name) DO NOTHING;

COMMENT ON VIEW public.public_votes IS 'Curated public-facing slice of votes (question_id/user_id/choice only -- no integrity weighting). As of migration 051 (2026-08-28), no role has a live grant on this view -- its one remaining client (Conversation.jsx comment vote-coloring) now goes through get_commenter_vote_choices() instead, which scopes results server-side to one question + a specific set of user ids instead of allowing an unscoped table read. Left defined (not dropped) in case a future backend-only use needs it; security_invoker=false is unchanged from migration 049 and would need re-review before granting it to any role again.';


-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. authenticated no longer has any grant on public_votes:
--    select grantee, privilege_type from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'public_votes';
--    -> should return nothing for anon or authenticated.
--
-- 2. The new RPC works and is properly scoped:
--    as an authenticated test user, call
--    select * from get_commenter_vote_choices('<a real question id>'::uuid,
--      array['<a commenter user id>'::uuid]);
--    -> returns that one user's choice on that one question, nothing else.
--
-- 3. Load a Conversation page with existing comments signed in -- vote
--    coloring should look exactly as it did before this migration.
-- ============================================================
