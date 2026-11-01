-- migration: 100_retract_vote_respects_archived_pulled.sql
--
-- Found during a post-ship security review of the ?Party revamp
-- (099_retract_vote.sql): retract_vote() deletes the caller's own votes
-- row for ANY question_id, with no check at all against the question's
-- pulled_at/archived_at status -- unlike cast_vote(), which explicitly
-- blocks new votes/changes on both (the pulled_at check added in
-- migration 071, the archived_at check enforced by the long-standing
-- block_archived_votes trigger). That trigger only fires on
-- BEFORE INSERT OR UPDATE, never DELETE, so retract_vote()'s DELETE
-- sailed straight through it.
--
-- This isn't a cross-user access bug (retract_vote was already correctly
-- scoped to auth.uid()'s own vote, same as before) -- it's a contradiction
-- of two decisions this codebase already made deliberately:
--
--   1. Migration 071's own stated design, in its own words: "Existing
--      votes/comments on a pulled question are left in place (not
--      deleted) -- this hides the question from view rather than erasing
--      the record." A pulled question's votes are exactly the kind of
--      record a moderator reviewing why it was pulled would want intact.
--      retract_vote() let any user who still had the question_id (e.g.
--      from their own Activity history, from before it was pulled) quietly
--      erase their own row from that record on demand.
--   2. block_archived_question_votes' whole purpose: "Voting is closed for
--      this question -- it has been archived." Once archived, cast_vote()
--      has never allowed a NEW vote or a CHANGED vote -- the tally shown
--      everywhere (get_vote_tally/get_vote_tallies_batch, both plain live
--      queries against votes, confirmed via migration 000's definitions --
--      there's no frozen snapshot backing the actual displayed tally,
--      question_snapshots is a separate daily trend-history table, not
--      what ResultsCard/Activity's History tab/Conversation actually read)
--      was meant to be frozen the moment a question archives.
--      retract_vote() was the one remaining lever that could still move
--      it, by deleting instead of changing.
--
-- Fix: give retract_vote() the same two guards cast_vote() already has,
-- adapted to raise rather than return a reason -- retract_vote() has no
-- rejected_reason column to extend (unlike cast_vote's RETURNS TABLE), and
-- an attempt to retract on a pulled/archived question should be rare
-- enough in practice (neither is normally still showing live vote
-- buttons) that a clean error is the right failure mode, matching
-- hide_party()/submit_party_answers()'s own "raise on an invalid state"
-- pattern elsewhere in this exact feature.
--
-- Full retract_vote() body carried forward from migration 099 verbatim,
-- plus the two new guards -- this codebase's own standing rule about
-- never replacing a function from a stale copy.

CREATE OR REPLACE FUNCTION public.retract_vote(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer;
  v_pulled_at timestamptz;
  v_archived_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
  end if;

  select q.pulled_at, q.archived_at into v_pulled_at, v_archived_at
  from public.questions q where q.id = p_question_id;

  if v_pulled_at is not null then
    raise exception 'This question has been pulled and its votes can no longer be changed.';
  end if;

  if v_archived_at is not null then
    raise exception 'Voting is closed for this question — it has been archived.';
  end if;

  delete from public.votes
  where user_id = v_user_id and question_id = p_question_id;

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    perform set_config('senseus.bypass_answers_count_protection', 'true', true);
    update public.profiles p
    set answers_count = greatest(p.answers_count - 1, 0)
    where p.id = v_user_id;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.retract_vote(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.retract_vote(uuid) FROM PUBLIC, anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('retract_vote', 'Client RPC (VoteCard, the ?Party mini-card page) -- tapping an already-selected stance again un-casts it: deletes the caller''s own votes row for that question and decrements their answers_count to match. As of migration 100 (2026-11-01), rejects any question that has been pulled or archived -- matching cast_vote''s own long-standing block on new/changed votes for both, which the original migration 099 version did not carry over for the DELETE path. Migration 099 (2026-11-01) created it; migration 100 (2026-11-01) closed this gap.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Normal case unchanged: vote on a live (not pulled, not archived)
--    question, then retract_vote() on it -> still succeeds exactly as
--    before (row deleted, answers_count decremented).
--
-- 2. Pulled: as an admin, set pulled_at on a question a test user has
--    already voted on. That user's retract_vote(that question) ->
--    raises "This question has been pulled...", and a direct select
--    confirms their votes row is still there, untouched.
--
-- 3. Archived: set archived_at on a question a test user has already
--    voted on (and confirm it's NOT also pulled). retract_vote() on it ->
--    raises "Voting is closed...", votes row still there.
--
-- 4. retract_vote() on a question_id that doesn't exist at all in
--    `questions` -> v_pulled_at/v_archived_at both come back null (no
--    matching row), so neither guard fires, and the function proceeds to
--    the delete (which matches 0 rows and no-ops) -- same harmless
--    behavior as migration 099's own test #4, not a new way to error.
-- ============================================================
