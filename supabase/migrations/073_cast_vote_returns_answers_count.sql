-- migration: 073_cast_vote_returns_answers_count.sql
--
-- CONTEXT (Aidan, 2026-09-05): after voting on his phone, Aidan got the
-- "🎉 Nice — that's your first vote on senseUS!" celebration (ResultsCard.jsx)
-- even though he'd already voted on desktop earlier that day. Asked
-- whether it's keyed to the account or the device.
--
-- FINDING: the device. QuestionFlow.jsx gated it purely on a localStorage
-- flag (senseus_first_vote_celebrated) — a deliberate simplification at
-- the time ("purely a delight moment, not something that needs to be
-- authoritative"), not a bug. Aidan's call: make it check the real
-- account-wide vote count instead.
--
-- FIX: profiles.answers_count is already exactly what's needed — it's
-- incremented by cast_vote() once per user, only the very first time they
-- vote on a given question (never on a change), so it's a running count
-- of "how many distinct questions this account has ever voted on"
-- (confirmed in AUDIT_NOTES.md and migration 055's own body). It hits
-- exactly 1 at the exact moment of a genuine first-ever vote and never
-- again after that, on any device. cast_vote() already computes it
-- server-side in the same transaction — this just returns it (and
-- whether this call was a brand-new vote row vs. a change to an existing
-- one) so the client can react to it, instead of adding a second round
-- trip per vote.
--
-- Two columns added to cast_vote()'s RETURNS TABLE: was_new_vote (the
-- existing v_was_insert value, now surfaced) and answers_count (the
-- account's count as of right after this call, post-increment on a
-- genuine new vote). The client's celebration condition becomes
-- `was_new_vote && answers_count === 1` — both a real INSERT (not a
-- change to an existing vote) AND the account's very first one ever.
-- The `was_new_vote` half specifically closes a gap the old client-side
-- `isChange` check already had: QuestionFlow's own `userVote` state
-- starts null on every fresh mount, so someone deep-linking in to CHANGE
-- their one-and-only existing vote (History tab's "Change my vote") was
-- never actually caught by the old isChange flag either — only the
-- localStorage flag (already tripped from the real first time) hid it
-- from ever mattering in practice. was_new_vote is the real,
-- unspoofable signal: it's only true for an actual INSERT.
--
-- DROP FUNCTION (not CREATE OR REPLACE) because the output column list
-- is changing — same reason migrations 061/072 needed a fresh CREATE.
-- ============================================================

DROP FUNCTION IF EXISTS public.cast_vote(uuid, text);

CREATE FUNCTION public.cast_vote(p_question_id uuid, p_choice text)
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

  if p_choice not in ('yes','ly','ln','no','dec') then
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
    -- Table-aliased so the right-hand-side `answers_count` unambiguously
    -- resolves to the profiles column and not to this function's new
    -- `answers_count` RETURNS TABLE out-parameter (which PL/pgSQL declares
    -- as an in-scope variable of the same name for the whole function body).
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

-- cast_vote's signature is unchanged (still (uuid, text)) but DROP
-- FUNCTION above removed its previous grants along with the old function
-- object. Re-grant exactly as migrations 017/055/071 set up.
GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cast_vote(uuid, text) FROM PUBLIC;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As a brand-new test account with zero votes, cast a vote on any
--    question:
--    select * from cast_vote('<a question id>'::uuid, 'yes');
--    -> was_new_vote = true, answers_count = 1.
--
-- 2. Cast a vote on a SECOND question with that same account:
--    -> was_new_vote = true, answers_count = 2.
--
-- 3. Change the vote on the first question (same choice or different):
--    -> was_new_vote = false, answers_count = 2 (unchanged — no new
--       question voted on, just a change to an existing one).
--
-- 4. Confirm the account's answers_count stays 1 forever after voting on
--    only ever that one question, no matter how many times its choice is
--    changed — was_new_vote is false every time after the first, so the
--    client's `was_new_vote && answers_count === 1` never re-fires.
