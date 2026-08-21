-- senseUS: Collapse vote casting into a single round trip
--
-- PROBLEM (found in scaling audit, 2026-08-21):
-- Vote.jsx's handleVote() did up to four sequential, fully-awaited
-- round trips for a single vote: a SELECT to check for an existing
-- vote (just to know whether to increment answers_count), the upsert
-- itself, a conditional increment_answers_count RPC, then a separate
-- get_vote_tally RPC to refresh the tally for the results screen. This
-- is the single most-repeated write in the app, so every extra round
-- trip multiplies real load and adds real latency to the one action
-- that matters most for how responsive the app feels.
--
-- FIX:
-- One SECURITY DEFINER function that upserts the vote, derives "was
-- this a new vote" from the upsert itself (via the xmax = 0 trick —
-- no separate SELECT needed), conditionally increments answers_count
-- in the same call, and returns the fresh tally — one round trip
-- instead of up to four. It also closes a small read-then-write race
-- that existed between the old existing-vote SELECT and the upsert
-- (another client could vote in between).
--
-- The existing secure_vote_fields_trigger (007) and any other
-- BEFORE/AFTER triggers on votes still fire normally for this insert —
-- this function only consolidates what the client used to do in
-- separate calls, it doesn't bypass any of the integrity/validation
-- triggers already in place.
--
-- user_id is taken from auth.uid() internally, never from a client
-- parameter, so — unlike the original increment_answers_count(user_id),
-- which took a user_id param and checked it against auth.uid() — there
-- is no parameter to spoof in the first place.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cast_vote(p_question_id uuid, p_choice text)
 RETURNS TABLE(yes bigint, ly bigint, ln bigint, no bigint, total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_was_insert boolean;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
  end if;

  if p_choice not in ('yes','ly','ln','no','dec') then
    raise exception 'Invalid vote choice.';
  end if;

  insert into public.votes (user_id, question_id, choice, updated_at)
  values (v_user_id, p_question_id, p_choice, now())
  on conflict (user_id, question_id)
  do update set choice = excluded.choice, updated_at = now()
  returning (xmax = 0) into v_was_insert;

  if v_was_insert then
    update public.profiles
    set answers_count = answers_count + 1
    where id = v_user_id;
  end if;

  return query
  select
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
    count(*) as total
  from public.votes v
  where v.question_id = p_question_id;
end;
$function$;

grant execute on function public.cast_vote(uuid, text) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this
-- function now has an authenticated EXECUTE grant that isn't yet on
-- the allowlist it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('cast_vote', 'Client RPC (Vote.jsx) — derives user from auth.uid() internally, no client-supplied user id to spoof; replaces the old upsert+increment_answers_count+get_vote_tally sequence with one call')
on conflict (function_name) do nothing;
