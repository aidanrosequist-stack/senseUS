-- migration: 099_retract_vote.sql
--
-- CONTEXT (Aidan, 2026-11-01): while designing the ?Party mini-card page,
-- Aidan asked for tapping an already-selected stance button again to
-- un-cast that vote, back to "no opinion" (and wants the same behavior
-- added to the regular VoteCard too -- "I'd much rather the user pick a
-- stance, [but] they should be able to remain neutral"). Checked first
-- whether the existing 'dec' (declined) choice value was meant for this:
-- it isn't actually reachable from anywhere in the current frontend (the
-- /vote skip gesture and the separate "hide this question" action both
-- bypass votes entirely), so it's dead/reserved, not a live mechanism --
-- confirmed with Aidan, who doesn't want it reused here. "No opinion"
-- for a vote the user has already cast should instead mean no votes row
-- at all, i.e. a real DELETE, same state as never having voted.
--
-- checked for side effects on profiles' derived columns before writing
-- this, since nothing in this codebase has ever deleted a votes row
-- before:
--   - resonance_score (068) and integrity_weight (025, "upward only" by
--     design) are both fully recomputed from a live read of votes on
--     every scheduled run -- a retracted vote just naturally drops out
--     of the next run, no extra bookkeeping, and integrity_weight can
--     only ever stay the same or rise regardless.
--   - answers_count is the one real exception: it's explicitly documented
--     (migration 031's backfill, migration 069's answers_count_mismatch
--     fraud check) to be kept in exact sync with the caller's real row
--     count in votes -- so retract_vote() must decrement it on an actual
--     delete, mirroring cast_vote()'s own increment-on-insert exactly
--     (same senseus.bypass_answers_count_protection transaction-local
--     flag), floored at 0 defensively.
--
-- Also, per Aidan: since 'dec' is confirmed dead and is being superseded
-- by "no row = no opinion" everywhere, cast_vote() no longer accepts it
-- as a valid choice -- closing the gap rather than leaving two different
-- representations of "no opinion" around. This only changes cast_vote()'s
-- own internal validation (`p_choice not in (...)`), not a table-level
-- CHECK constraint, so it has zero effect on any existing 'dec' rows that
-- might already be sitting in the real table -- it only stops NEW ones
-- from being cast going forward. The dead `dec` display plumbing in
-- ResultsCard.jsx (VOTE_PILL_STYLES/VOTE_LABELS/VOTE_WASH) and the stale
-- comment in Conversation.jsx are cleaned up in the same frontend pass
-- that wires up the new retract button (not in this migration).
-- ============================================================

-- cast_vote()'s RETURNS TABLE columns are unchanged -- CREATE OR REPLACE
-- is safe. Full body carried forward from migration 073 (this codebase's
-- own standing rule: never replace a function from a stale copy), with
-- only 'dec' removed from the two `p_choice not in (...)` checks.

CREATE OR REPLACE FUNCTION public.cast_vote(p_question_id uuid, p_choice text)
 RETURNS TABLE(yes bigint, ly bigint, ln bigint, no bigint, total bigint, rejected_reason text, was_new_vote boolean, answers_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_was_insert boolean;
  v_last_vote_at timestamptz;
  v_pulled_at timestamptz;
  v_answers_count integer;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
  end if;

  if p_choice not in ('yes','ly','ln','no') then
    raise exception 'Invalid vote choice.';
  end if;

  select q.pulled_at into v_pulled_at from public.questions q where q.id = p_question_id;

  if v_pulled_at is not null then
    perform public.log_anomaly_only(
      'vote_on_pulled_question_blocked',
      'low',
      jsonb_build_object('user_id', v_user_id, 'question_id', p_question_id, 'attempted_choice', p_choice),
      p_question_id
    );

    select p.answers_count into v_answers_count from public.profiles p where p.id = v_user_id;

    return query
    select
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
      count(*) as total,
      'question_pulled'::text as rejected_reason,
      false as was_new_vote,
      v_answers_count as answers_count
    from public.votes v
    where v.question_id = p_question_id;
    return;
  end if;

  select p.last_vote_at into v_last_vote_at from public.profiles p where p.id = v_user_id;

  if v_last_vote_at is not null and now() - v_last_vote_at < interval '1 second' then
    perform public.log_anomaly_only(
      'vote_cooldown_blocked',
      'low',
      jsonb_build_object(
        'user_id', v_user_id,
        'question_id', p_question_id,
        'attempted_choice', p_choice,
        'seconds_since_last_vote', extract(epoch from (now() - v_last_vote_at))
      ),
      p_question_id
    );

    select p.answers_count into v_answers_count from public.profiles p where p.id = v_user_id;

    return query
    select
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
      count(*) as total,
      'cooldown'::text as rejected_reason,
      false as was_new_vote,
      v_answers_count as answers_count
    from public.votes v
    where v.question_id = p_question_id;
    return;
  end if;

  insert into public.votes (user_id, question_id, choice, updated_at)
  values (v_user_id, p_question_id, p_choice, now())
  on conflict (user_id, question_id)
  do update set choice = excluded.choice, updated_at = now()
  returning (xmax = 0) into v_was_insert;

  perform set_config('senseus.bypass_last_vote_at_protection', 'true', true);
  update public.profiles set last_vote_at = now() where id = v_user_id;

  if v_was_insert then
    perform set_config('senseus.bypass_answers_count_protection', 'true', true);
    update public.profiles p
    set answers_count = p.answers_count + 1
    where p.id = v_user_id;
  end if;

  select p.answers_count into v_answers_count from public.profiles p where p.id = v_user_id;

  return query
  select
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
    count(*) as total,
    null::text as rejected_reason,
    v_was_insert as was_new_vote,
    v_answers_count as answers_count
  from public.votes v
  where v.question_id = p_question_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cast_vote(uuid, text) FROM PUBLIC;

-- ---------- retract_vote(): tap-the-same-stance-again, back to "no opinion" ----------
-- Mirrors cast_vote()'s own answers_count bookkeeping exactly, in reverse:
-- decrements only on a real delete, using the same transaction-local
-- bypass flag, floored at 0 defensively (there's no legitimate way to go
-- negative, but a floor costs nothing and guarantees it can't happen even
-- under some future bug elsewhere).

CREATE FUNCTION public.retract_vote(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
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
  ('cast_vote', 'Client RPC (VoteCard/QuestionFlow, the ?Party mini-card page) -- casts or changes the caller''s own vote on a question. No longer accepts ''dec'' as of migration 099 -- confirmed dead (unreachable from any current UI path) and superseded by retract_vote()''s "no row = no opinion" model. Migration 099 (2026-11-01); originally 017, cooldown added 055, returns was_new_vote/answers_count added 073.'),
  ('retract_vote', 'Client RPC (VoteCard, the ?Party mini-card page) -- tapping an already-selected stance again un-casts it: deletes the caller''s own votes row for that question and decrements their answers_count to match (mirroring cast_vote''s own increment, in reverse). Resonance score and integrity weight need no corresponding adjustment -- both fully recompute from a live read of votes on every scheduled run. Migration 099 (2026-11-01).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. cast_vote(question_id, 'dec') now raises "Invalid vote choice."
--    instead of succeeding.
--
-- 2. As a fresh test account, cast_vote on a question -> answers_count
--    goes from 0 to 1 as before (073's behavior unchanged). Then
--    retract_vote() on that same question -> the votes row is gone
--    (confirm with a direct select), answers_count back to 0.
--
-- 3. Vote on TWO questions (answers_count = 2), retract only one ->
--    answers_count = 1, the other question's vote untouched.
--
-- 4. retract_vote() on a question the caller never voted on -> no error,
--    no-op, answers_count unchanged (confirms the v_deleted > 0 guard).
--
-- 5. After retracting the only vote an account ever cast (answers_count
--    back to 0), cast_vote() on a NEW question -> was_new_vote = true,
--    answers_count = 1 again, exactly like a genuine first vote (the
--    first-vote celebration firing a second time here is expected and
--    harmless, not a regression -- see migration 073's own was_new_vote
--    design).
--
-- 6. Confirm retracting a vote never touches integrity_weight or
--    resonance_score directly (they're untouched until their own
--    scheduled recompute runs); the NEXT calculate_all_integrity_weights()/
--    calculate_all_resonance_scores() run reflects the smaller vote count
--    correctly (integrity_weight can only stay the same or rise; a
--    resonance_score already below the 5-vote minimum sample reverts
--    toward the 50/Aligned default if retracting drops the count below
--    5, which is correct, not a bug).
-- ============================================================
