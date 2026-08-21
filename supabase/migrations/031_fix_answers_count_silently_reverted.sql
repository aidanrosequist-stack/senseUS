-- senseUS: cast_vote's answers_count increment was being silently
-- cancelled by protect_admin_columns
--
-- PROBLEM (found while writing migration 029/030, from a direct read of
-- both function bodies):
-- protect_admin_columns() (011) reverts profiles.answers_count on every
-- UPDATE to its OLD value, for any caller that isn't service_role — by
-- design, since 011's whole point was stopping a client from calling
-- supabase.from('profiles').update({ answers_count: 99999 }) directly.
--
-- cast_vote() (017, added earlier this week) increments answers_count
-- with a plain `update public.profiles set answers_count =
-- answers_count + 1 where id = v_user_id`, run under the voting user's
-- own authenticated session (SECURITY DEFINER changes execution
-- privilege, not auth.role(), which reflects the original caller's JWT
-- for the whole request/transaction regardless of which function is
-- executing). So protect_admin_columns' BEFORE UPDATE trigger fires on
-- that same statement and immediately reverts the increment back to
-- old.answers_count, in the same atomic statement — cast_vote's
-- increment has very likely been a complete, silent no-op since the
-- moment migration 017 shipped. (increment_answers_count, the older RPC
-- this replaced, would have hit the exact same wall, but it's never
-- actually called from the frontend, so this only became a live,
-- currently-active bug once cast_vote started calling the same pattern
-- for real.)
--
-- FIX: a transaction-local bypass flag. cast_vote sets it immediately
-- before its own trusted, already-ownership-checked update; protect_
-- admin_columns checks for it and, only for answers_count specifically,
-- lets the value through instead of reverting it. Everything else
-- protect_admin_columns guards is untouched — a direct client update to
-- answers_count still gets reverted exactly as before, since only
-- cast_vote's own internal call sets the flag, and it's transaction-
-- local (set_config's third argument = true), so it can't leak into or
-- affect any other request.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Must stay `!=`, not a `= 'service_role'` early-return — see the long
  -- comment on this exact point in migration 029. NULL auth.role()
  -- (pg_cron, a direct superuser session, a migration run — anything
  -- with no PostgREST request context) needs to fall through this whole
  -- block untouched, the same as migration 011's original behavior.
  if auth.role() != 'service_role' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.integrity_weight := 1.0000;
      new.answers_count := 0;
      new.resonance_score := 50;
      new.resonance_tier := 'Independent';
      new.streak_days := 0;
      new.longest_streak := 0;
      new.replies_count := 0;
      new.likes_received := 0;
      new.tier := 'newcomer';
      new.badges := '{}';
      new.voip_flagged_at := null;
      new.country_changed_at := null;
      new.created_at := now();
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      new.is_admin := old.is_admin;
      new.integrity_weight := old.integrity_weight;
      new.resonance_score := old.resonance_score;
      new.resonance_tier := old.resonance_tier;
      new.streak_days := old.streak_days;
      new.longest_streak := old.longest_streak;
      new.replies_count := old.replies_count;
      new.likes_received := old.likes_received;
      new.tier := old.tier;
      new.badges := old.badges;
      new.voip_flagged_at := old.voip_flagged_at;
      new.country_changed_at := old.country_changed_at;
      new.created_at := old.created_at;
      new.id := old.id;
    end if;
  end if;

  return new;
end;
$function$;

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
    -- Transaction-local — automatically clears at end of this call, so
    -- it can never leak into a later, unrelated statement.
    perform set_config('senseus.bypass_answers_count_protection', 'true', true);
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

-- One-time backfill: bring existing profiles.answers_count up to each
-- user's real vote count, for everyone this silent-no-op bug already
-- affected. Safe to run more than once (idempotent — it's a direct
-- count, not an increment), and only ever raises the value to match
-- reality, never lowers it below a legitimately-higher number (there
-- isn't one, since nothing else writes this column).
update public.profiles p
set answers_count = v.real_count
from (
  select user_id, count(*) as real_count
  from public.votes
  group by user_id
) v
where v.user_id = p.id
  and p.answers_count <> v.real_count;
