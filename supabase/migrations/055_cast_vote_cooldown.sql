-- senseUS: minimum 1-second gap between votes, regardless of question
--
-- CONTEXT (Aidan, 2026-08-29): cast_vote() has no rate limiting at all
-- today beyond "must be signed in." Registration is gated by real phone
-- OTP verification, and VOIP-registered numbers already get their votes
-- down-weighted (migration 010) -- so bulk fake-account creation isn't
-- the easy attack here. The actual soft spot: once ONE account is
-- genuinely verified, nothing stops a script holding that session from
-- calling cast_vote() at machine speed across every open question in a
-- fraction of a second -- something no human tapping through the real
-- app UI could physically do.
--
-- The existing fraud-detection system doesn't cover this either --
-- check_vote_manipulation() (migration 003) watches for >50 vote
-- CHANGES piling up on a SINGLE question within an hour (a coordinated
-- attack on one question's outcome). That's a completely different
-- signature from one account voting fast across many DIFFERENT
-- questions, so this migration doesn't duplicate or replace it.
--
-- FIX: track the timestamp of each user's most recent vote
-- (profiles.last_vote_at, checked and updated by cast_vote() itself) and
-- reject a vote that comes in under 1 second after the previous one --
-- not "once per question" (that's already true, via the votes table's
-- own unique constraint), but "not again this fast, regardless of which
-- question." A 1-second minimum caps a script at 60 votes/minute
-- instead of effectively unlimited, while being fast enough that a real
-- person rapid-tapping through questions they've already skimmed should
-- never notice it.
--
-- last_vote_at is a protected/computed column, same category as
-- answers_count -- a client could otherwise reset their own
-- last_vote_at directly via `supabase.from('profiles').update(...)` and
-- defeat the cooldown entirely, the same way a direct answers_count
-- write would have defeated migration 031's fix without
-- protect_admin_columns() guarding it. Uses the exact same
-- transaction-local bypass-flag pattern migration 031 established for
-- answers_count, so cast_vote's own trusted write goes through while a
-- direct client write still gets reverted.
--
-- DURABLE LOGGING, AND WHY THIS ISN'T A PLAIN RAISE EXCEPTION (Aidan,
-- 2026-08-29): "would we be able to pull a report down the road, and see
-- if there are attempts at firing cast_vote calls at machine speed?" --
-- yes, via anomaly_log, but only if the log write actually survives.
-- Postgres rolls back an ENTIRE transaction -- including any earlier
-- writes in the same function call -- the moment an unhandled RAISE
-- EXCEPTION propagates out of it. A first draft of this migration logged
-- the blocked attempt via log_anomaly_only() and then raised, which
-- would have silently discarded that very log entry every time the
-- cooldown actually fired -- defeating the whole point of asking for a
-- queryable trail. dblink-based autonomous transactions and pg_net were
-- both considered and rejected: dblink adds credential/connection
-- management with unverified reliability through Supabase's pooled
-- connection layer (Supavisor), and pg_net's own queue insert is itself
-- transactional, so it doesn't dodge the problem either. A nested
-- BEGIN/EXCEPTION block doesn't help either -- its implicit savepoint
-- only protects statements *inside* that block from an error raised
-- *inside* that block, not an earlier statement from a *later* raise.
--
-- So instead: a cooldown hit returns NORMALLY, carrying a
-- `rejected_reason` column the caller checks, instead of raising. The
-- whole transaction -- including the anomaly_log insert -- commits
-- every time. The two guards that were already there ("Unauthorized",
-- "Invalid vote choice") are left as plain RAISE EXCEPTION, since
-- neither needs a durable trail -- an unauthenticated call or a garbage
-- choice value isn't the "bot voting at machine speed" signal this is
-- for.
--
-- Every blocked attempt is logged to anomaly_log (silently, no email --
-- log_anomaly_only(), the same low-signal path run_integrity_checks()
-- and the other cron functions already use for "record this, don't page
-- anyone over one instance") so a single instance doesn't email anyone,
-- but the history is queryable later -- e.g. `select user_id, count(*)
-- from anomaly_log where alert_type = 'vote_cooldown_blocked' and
-- triggered_at > now() - interval '7 days' group by user_id order by 2
-- desc` surfaces exactly which accounts are actually tripping this
-- repeatedly, which is what a real bot looks like (a genuine misclick
-- trips this once in a blue moon; a script trips it over and over).
-- cast_vote can call log_anomaly_only() despite it only being granted to
-- postgres/service_role because SECURITY DEFINER runs with the
-- *function owner's* privileges, not the caller's -- the same reason
-- every other SECURITY DEFINER function in this codebase can write to
-- tables/functions the calling role has no direct grant on.
--
-- FRONTEND NOTE: src/pages/Vote.jsx's handleVote() previously discarded
-- the real Postgres error text on any RPC failure and always threw the
-- same generic "check your connection" string -- so even a
-- RAISE EXCEPTION with a specific cooldown message would never have
-- reached the user anyway. This migration ships alongside a matching
-- Vote.jsx change that checks the new `rejected_reason` field and shows
-- a specific "voting too fast" message instead.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_vote_at timestamptz;

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
      new.last_vote_at := null;
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      if coalesce(current_setting('senseus.bypass_last_vote_at_protection', true), '') <> 'true' then
        new.last_vote_at := old.last_vote_at;
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

-- CREATE OR REPLACE FUNCTION can't change an existing function's return
-- type (adding rejected_reason to the RETURNS TABLE), so the old
-- 5-column signature has to be dropped first.
DROP FUNCTION IF EXISTS public.cast_vote(uuid, text);

CREATE FUNCTION public.cast_vote(p_question_id uuid, p_choice text)
 RETURNS TABLE(yes bigint, ly bigint, ln bigint, no bigint, total bigint, rejected_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_was_insert boolean;
  v_last_vote_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
  end if;

  if p_choice not in ('yes','ly','ln','no','dec') then
    raise exception 'Invalid vote choice.';
  end if;

  select p.last_vote_at into v_last_vote_at from public.profiles p where p.id = v_user_id;

  if v_last_vote_at is not null and now() - v_last_vote_at < interval '1 second' then
    -- Logged, then return NORMALLY (not raise) so this insert actually
    -- commits — see the long comment above on why a raise here would
    -- have rolled the log write right back. Tallies returned below are
    -- the real, unchanged current tallies for the question (nothing was
    -- recorded), just tagged with rejected_reason so the caller knows
    -- not to treat this as a successful vote.
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

    return query
    select
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
      count(*) as total,
      'cooldown'::text as rejected_reason
    from public.votes v
    where v.question_id = p_question_id;
    return;
  end if;

  insert into public.votes (user_id, question_id, choice, updated_at)
  values (v_user_id, p_question_id, p_choice, now())
  on conflict (user_id, question_id)
  do update set choice = excluded.choice, updated_at = now()
  returning (xmax = 0) into v_was_insert;

  -- Transaction-local — automatically clears at end of this call, so it
  -- can never leak into a later, unrelated statement.
  perform set_config('senseus.bypass_last_vote_at_protection', 'true', true);
  update public.profiles set last_vote_at = now() where id = v_user_id;

  if v_was_insert then
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
    count(*) as total,
    null::text as rejected_reason
  from public.votes v
  where v.question_id = p_question_id;
end;
$function$;

-- cast_vote's signature is unchanged (still (uuid, text)) but its
-- previous grants were on the old function object, which DROP FUNCTION
-- above removed along with them. Re-grant exactly as migration 017 set
-- up originally.
GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cast_vote(uuid, text) FROM PUBLIC;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Two cast_vote calls from the same authenticated session under 1
--    second apart -- the second should return normally with
--    rejected_reason = 'cooldown' (not raise, not error) and the vote
--    should NOT be recorded/changed (check public.votes for that
--    question/user afterward -- still whatever it was before the second
--    call).
--
-- 2. The same two calls, spaced more than 1 second apart -- both should
--    succeed with rejected_reason null, and the second call's choice
--    should be the one on record.
--
-- 3. After test 1, confirm the block was actually logged:
--    select * from anomaly_log where alert_type = 'vote_cooldown_blocked'
--    order by triggered_at desc limit 5;
--    -> should show the blocked attempt, proving the log survives even
--    though the vote itself was rejected in the same call.
--
-- 4. A direct client write attempt --
--    `supabase.from('profiles').update({ last_vote_at: null })` as a
--    normal signed-in user -- should be silently reverted by
--    protect_admin_columns(), same as an answers_count write attempt
--    already is.
-- ============================================================
