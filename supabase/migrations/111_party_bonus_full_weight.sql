-- senseUS: ?Party bonus, bringing the integrity-weight maximum to 1.0100
--
-- Aidan's decision (2026-11-08): with the sharing bonus gone (migration
-- 110), the bonuses only added up to 1.0090. This adds one new +0.0010
-- bonus for using ?Party, so the maximum reachable weight is exactly the
-- existing 1.0100 cap. No other bonus amounts change.
--
-- ?Party bonus: earned by having at least one question in one of your
-- ?Party lists, or by ever having hosted a ?Party. Like the comparing
-- bonus (migration 096), it uses data the feature already stores for its
-- own purposes; nothing new is recorded.
--
--   1. calculate_all_integrity_weights(): 110's body plus the new
--      party_planners CTE and bonus line. Keeps SET search_path (see
--      migration 109). Weights still only ratchet up.
--   2. get_integrity_progress(): adds party_activity (1/0) for the
--      "Reach your full weight" popup. Return type changes, so it is
--      dropped and re-created with its grants restored.
--   3. get_report_integrity_distribution(): bucket labels were written
--      for the old 1.0050 maximum. Now 1.0000 / 1.0001-1.0050 /
--      1.0051-1.0100. send-weekly-report's bucket template is updated in
--      the same commit and must be redeployed alongside this migration.
--
-- Full bonus list after this migration (total +0.0100):
--   10 / 25 / 50+ lifetime votes ........ +0.0005 / +0.0010 / +0.0020
--   5 / 10+ lifetime comments ........... +0.0005 / +0.0010
--   voted on 7+ distinct days ........... +0.0010
--   voted in 3+ distinct months ......... +0.0020
--   sent a comparison invite ............ +0.0010
--   ?Party (list question or hosted) .... +0.0010

-- ---- 1. Weight calculation: ?Party bonus added ----
CREATE OR REPLACE FUNCTION public.calculate_all_integrity_weights()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    select user_id, count(distinct date(created_at)) as day_count
    from votes
    group by user_id
  ),
  distinct_vote_months as (
    -- 3+ distinct calendar months with at least one vote, lifetime,
    -- gaps allowed — a materially higher bar than the 7-distinct-days
    -- bonus since it requires sticking around across real wall-clock
    -- time, not just a single busy week.
    select user_id, count(distinct date_trunc('month', created_at)) as month_count
    from votes
    group by user_id
  ),
  comment_counts as (
    select user_id, count(*) as comment_count
    from comments
    where is_deleted = false
    group by user_id
  ),
  comparison_counts as (
    -- See migration 096: credited the
    -- moment you send a comparison invite, any status, no acceptance
    -- required.
    select sender_id as user_id, count(*) as verified_comparison_count
    from comparison_tokens
    group by sender_id
  ),
  party_planners as (
    -- NEW (111): anyone with at least one question in one of their ?Party
    -- lists, or who has ever hosted a ?Party (hosting needs a list with at
    -- least one question, and party rows outlive later list edits, so the
    -- bonus doesn't flicker if someone empties a list after using it).
    select pl.user_id
    from party_lists pl
    join party_list_questions plq on plq.list_id = pl.id
    union
    select host_id from question_parties
  ),
  new_weights as (
    select
      p.id,
      case
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
            + case when coalesce(cc.comment_count, 0) >= 10 then 0.0010 else 0 end
            + case when coalesce(dvd.day_count, 0) >= 7 then 0.0010 else 0 end
            + case when coalesce(dvm.month_count, 0) >= 3 then 0.0020 else 0 end
            + case when coalesce(cp.verified_comparison_count, 0) >= 1 then 0.0010 else 0 end
            + case when pp.user_id is not null then 0.0010 else 0 end,
            1.0100
          )
      end as calculated_weight
    from profiles p
    left join vote_counts vc on vc.user_id = p.id
    left join comment_counts cc on cc.user_id = p.id
    left join distinct_vote_days dvd on dvd.user_id = p.id
    left join distinct_vote_months dvm on dvm.user_id = p.id
    left join comparison_counts cp on cp.user_id = p.id
    left join party_planners pp on pp.user_id = p.id
  )
  update profiles p
  set integrity_weight = greatest(p.integrity_weight, nw.calculated_weight)
  from new_weights nw
  where p.id = nw.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

-- ---- 2. Integrity popup: party_activity added ----
DROP FUNCTION IF EXISTS public.get_integrity_progress();

CREATE FUNCTION public.get_integrity_progress()
 RETURNS TABLE(
   vote_count integer,
   comment_count integer,
   distinct_vote_days integer,
   distinct_vote_months integer,
   verified_comparison_count integer,
   party_activity integer
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((select count(*) from votes v where v.user_id = auth.uid()), 0)::integer,
    coalesce((select count(*) from comments c where c.user_id = auth.uid() and c.is_deleted = false), 0)::integer,
    coalesce((select count(distinct date(v.created_at)) from votes v where v.user_id = auth.uid()), 0)::integer,
    coalesce((select count(distinct date_trunc('month', v.created_at)) from votes v where v.user_id = auth.uid()), 0)::integer,
    coalesce((select count(*) from comparison_tokens ct where ct.sender_id = auth.uid()), 0)::integer,
    -- NEW (111): 1 once the ?Party bonus is earned, else 0. Same rule as
    -- calculate_all_integrity_weights()'s party_planners CTE.
    (case when exists (
       select 1 from party_lists pl
       join party_list_questions plq on plq.list_id = pl.id
       where pl.user_id = auth.uid()
     ) or exists (
       select 1 from question_parties qp where qp.host_id = auth.uid()
     ) then 1 else 0 end)::integer;
$function$;

grant execute on function public.get_integrity_progress() to authenticated;
revoke execute on function public.get_integrity_progress() from public;
revoke execute on function public.get_integrity_progress() from anon;

insert into intentionally_public_functions (function_name, note)
values ('get_integrity_progress', 'Returns only the calling user''s own lifetime progress toward integrity-weight bonuses (auth.uid()-scoped); backs the "Reach your full weight" popup on Profile.jsx. Migration 096 (2026-10-29): the comparison count became "invites sent", not "invites accepted". Migration 110 (2026-11-08): the sharing bonus and its verified_referral_count column were removed. Migration 111 (2026-11-08): added party_activity for the ?Party bonus.')
on conflict (function_name) do update set note = excluded.note;

-- ---- 3. Admin report buckets relabeled for the 1.0100 range ----
CREATE OR REPLACE FUNCTION public.get_report_integrity_distribution()
 RETURNS TABLE(bucket text, count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    case
      when integrity_weight = 1.0 then '1.0000'
      when integrity_weight <= 1.005 then '1.0001–1.0050'
      else '1.0051–1.0100'
    end as bucket,
    count(*) as count
  from public.profiles
  group by 1;
$function$;
