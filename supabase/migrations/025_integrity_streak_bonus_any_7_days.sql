-- senseUS: Integrity weight's "streak" bonus no longer requires
-- consecutive days
--
-- REQUESTED (2026-08-21): the +0.0005 integrity-weight bonus previously
-- required a 7-day CONSECUTIVE voting streak (profiles.streak_days,
-- maintained by the update_streak() trigger — reset to 1 the moment a
-- single day is missed). The user felt that bar was too strict for what
-- it's meant to reward. This changes the bonus's eligibility to any 7
-- distinct calendar days with at least one vote, cumulative, gaps
-- allowed — a user who votes every few days now earns it just as
-- someone who votes daily without a break.
--
-- streak_days / longest_streak / update_streak() and the "Current
-- streak" stat + "consistent" badge on Profile.jsx are UNCHANGED — that
-- consecutive-streak gamification feature is a separate, deliberate
-- product surface from the integrity-weight bonus and the user didn't
-- ask to change it, only the weight calculation.
--
-- Existing weights are "upward only" (calculate_all_integrity_weights
-- takes greatest(current, newly-calculated) — see migration 010's
-- comment), so this can only raise weights for users who now qualify
-- under the looser rule, never lower anyone who already had the bonus.
-- It takes effect the next time calculate_all_integrity_weights runs
-- (via the calculate-integrity edge function), not immediately on push.
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_all_integrity_weights()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  updated_count integer;
begin
  with vote_counts as (
    select user_id, count(*) as vote_count
    from votes
    group by user_id
  ),
  distinct_vote_days as (
    -- Any 7 calendar days with at least one vote, not necessarily
    -- consecutive — replaces the old streak_days (consecutive-only)
    -- check for this specific bonus.
    select user_id, count(distinct date(created_at)) as day_count
    from votes
    group by user_id
  ),
  comment_counts as (
    select user_id, count(*) as comment_count
    from comments
    where is_deleted = false
    group by user_id
  ),
  new_weights as (
    select
      p.id,
      case
        -- Still in the VOIP probation window: hasn't yet hit BOTH
        -- 30 days since being flagged AND 20 votes. No weight growth
        -- until both are satisfied.
        when p.voip_flagged_at is not null
          and (
            now() < p.voip_flagged_at + interval '30 days'
            or coalesce(vc.vote_count, 0) < 20
          )
          then 1.0000
        else
          least(
            1.0000
            + case when coalesce(vc.vote_count, 0) >= 10 then 0.0005 else 0 end
            + case when coalesce(vc.vote_count, 0) >= 25 then 0.0010 else 0 end
            + case when coalesce(vc.vote_count, 0) >= 50 then 0.0020 else 0 end
            + case when coalesce(cc.comment_count, 0) >= 5 then 0.0005 else 0 end
            + case when coalesce(cc.comment_count, 0) >= 10 then 0.0005 else 0 end
            + case when coalesce(dvd.day_count, 0) >= 7 then 0.0005 else 0 end,
            1.0050
          )
      end as calculated_weight
    from profiles p
    left join vote_counts vc on vc.user_id = p.id
    left join comment_counts cc on cc.user_id = p.id
    left join distinct_vote_days dvd on dvd.user_id = p.id
  )
  update profiles p
  set integrity_weight = greatest(p.integrity_weight, nw.calculated_weight)
  from new_weights nw
  where p.id = nw.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;
