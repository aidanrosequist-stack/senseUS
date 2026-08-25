-- senseUS: guarantee sponsored questions land in the candidate pool
--
-- CONTEXT: part of the vote-feed rebalance discussed 2026-08-25.
--
-- PROBLEM: get_candidate_questions pulls its result by ordering ALL
-- eligible questions (geo-tier, then random()) and taking the top
-- p_limit (75). Sponsored questions were never treated specially there
-- -- they competed in that same random draw like anything else. With
-- typically only a handful of sponsored questions live against a much
-- larger pool of regular ones, the odds of any given sponsored question
-- actually landing in a user's 75-question batch on a given feed load
-- were low, and often zero. Once frontend logic (useQuestions.js) groups
-- the batch into per-category buckets and round-robins them, a sponsored
-- question that never made the batch obviously can never be chosen --
-- so sponsored exposure was, in practice, unreliable rather than
-- "roughly 1-in-N like every other category" as intended.
--
-- Also, per Aidan (2026-08-25): sponsored questions should ignore
-- geo_scope/country matching entirely -- they should be eligible for
-- every user regardless of country, not just users in a matching geo
-- scope like regular questions.
--
-- FIX: split eligibility into two pools. Every eligible sponsored
-- question is pulled in unconditionally (geo-blind, capped defensively
-- at p_limit so a future surge of concurrent sponsorships still can't
-- return more than the caller asked for), and the remaining slots are
-- filled exactly as before -- geo-tier priority, then random -- from the
-- non-sponsored pool. Once both are merged, nothing downstream changes:
-- useQuestions.js still buckets by category and round-robins, so a
-- sponsored question now competes for its "turn" on equal footing with
-- every other category, same as before -- it just can no longer be
-- silently excluded from the batch before that even happens.
--
-- No RLS/grant changes -- this function was already SECURITY DEFINER
-- and already only returns rows for auth.uid() = p_user_id (unchanged).
--
-- NOTE: migration 026 (search_path_hardening) pinned this function's
-- search_path via a separate ALTER FUNCTION ... SET, rather than as part
-- of the function's own CREATE statement. That setting is NOT carried
-- forward automatically by CREATE OR REPLACE FUNCTION -- confirmed by
-- testing this migration locally, where proconfig came back empty after
-- the replace. So SET search_path is included directly below, or this
-- migration would have silently undone 026's hardening for this one
-- function the moment it runs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_candidate_questions(p_user_id uuid, p_country_code text, p_limit integer DEFAULT 75)
 RETURNS SETOF questions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with eligible as (
    select q.*
    from questions q
    where p_user_id = auth.uid()
      and q.published_at is not null
      and q.published_at <= now()
      and q.archived_at is null
      and not exists (select 1 from votes v where v.user_id = p_user_id and v.question_id = q.id)
      and not exists (select 1 from question_skips s where s.user_id = p_user_id and s.question_id = q.id)
  ),
  sponsored as (
    -- Guaranteed in, regardless of geo_scope/country -- capped at
    -- p_limit purely as a safety net, not an expected case.
    select *
    from eligible
    where is_sponsored
    order by random()
    limit p_limit
  ),
  non_sponsored as (
    -- Same geo-tier-then-random logic as before, just now filling
    -- whatever room is left after the sponsored questions above.
    select *
    from eligible
    where not is_sponsored
    order by
      case
        when geo_scope in ('global', 'country_own') then 0
        when geo_scope in ('country', 'regional') and country_code = p_country_code then 0
        else 1
      end,
      random()
    limit greatest(p_limit - (select count(*) from sponsored), 0)
  )
  select * from sponsored
  union all
  select * from non_sponsored;
$function$;
