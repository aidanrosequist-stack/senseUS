-- migration: 096_comparing_bonus_on_send.sql
--
-- CONTEXT (Aidan, 2026-10-29): second thoughts on the "comparing" bonus
-- migration 094 added. That version only credited the bonus once a sent
-- comparison invite was actually accepted (and the counterpart had voted)
-- -- "an accepted token is a real, row-locked, two-party DB event, not a
-- client claim." Aidan's call now: reward the act of sending the invite
-- itself (clicking "Compare your vote history with a friend", which calls
-- create_comparison_token()), not whether the other person ever accepts.
-- His own words: "I don't want to not reward someone who has friends that
-- aren't interested" -- someone who genuinely reached out shouldn't go
-- unrewarded just because the friend they invited never responded.
--
-- This is a real, deliberate loosening of 094's own "every bonus proves
-- something happened" floor -- not an oversight being fixed. Sending a
-- comparison invite is now entirely within one person's own control (no
-- second real human needs to do anything), which is a lower cost floor
-- than every other bonus category in this system. Flagged here explicitly
-- rather than silently matched to the old comment's reasoning: this is
-- Aidan's own informed tradeoff, made with the gaming angle already
-- raised once (migration 094's header) and still worth having on record.
-- In practice it stays cheap to abuse but not rewarding to abuse: the
-- bonus is flat (+0.0010, same as every other category here), so sending
-- the same invite link a thousand times earns nothing beyond the first.
--
-- Kept the RPC output column name verified_comparison_count (renaming it
-- would need a DROP FUNCTION + re-grant for no functional benefit, and
-- nothing outside these two functions reads it) even though "verified" no
-- longer means two-party-verified -- just "you've sent at least one."
--
-- Scoped to calculate_all_integrity_weights()'s comparison_counts CTE and
-- get_integrity_progress()'s matching inline subquery -- full bodies
-- carried forward from migration 094 (itself verbatim from 085 plus
-- referred_by/the raised ceiling), per this codebase's own standing
-- lesson about CREATE OR REPLACE FUNCTION always needing the complete
-- current body. Nothing else in either function changes.
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
  referral_counts as (
    -- Distinct people you referred who (a) actually signed up through
    -- your link and (b) cast at least one vote, proving the referral
    -- grew real participation rather than just an inert account.
    -- Unchanged by this migration — only the comparison bonus below
    -- moved off requiring the other party to act.
    select r.referred_by as user_id, count(distinct r.id) as verified_referral_count
    from profiles r
    where r.referred_by is not null
      and exists (select 1 from votes v where v.user_id = r.id)
    group by r.referred_by
  ),
  comparison_counts as (
    -- CHANGED (096): credited the moment you send a comparison invite —
    -- any row in comparison_tokens naming you as sender_id, regardless
    -- of status. No longer requires acceptance, and no longer counts a
    -- recipient's side at all (accepting someone else's invite isn't
    -- "sending" one — see this migration's header for why that's the
    -- deliberate line being drawn). Sending the same link a thousand
    -- times earns nothing extra: this is still a flat per-person bonus,
    -- just gated on count(*) >= 1 like every other category.
    select sender_id as user_id, count(*) as verified_comparison_count
    from comparison_tokens
    group by sender_id
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
            + case when coalesce(rc.verified_referral_count, 0) >= 1 then 0.0010 else 0 end
            + case when coalesce(cp.verified_comparison_count, 0) >= 1 then 0.0010 else 0 end,
            1.0100
          )
      end as calculated_weight
    from profiles p
    left join vote_counts vc on vc.user_id = p.id
    left join comment_counts cc on cc.user_id = p.id
    left join distinct_vote_days dvd on dvd.user_id = p.id
    left join distinct_vote_months dvm on dvm.user_id = p.id
    left join referral_counts rc on rc.user_id = p.id
    left join comparison_counts cp on cp.user_id = p.id
  )
  update profiles p
  set integrity_weight = greatest(p.integrity_weight, nw.calculated_weight)
  from new_weights nw
  where p.id = nw.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_integrity_progress()
 RETURNS TABLE(
   vote_count integer,
   comment_count integer,
   distinct_vote_days integer,
   distinct_vote_months integer,
   verified_referral_count integer,
   verified_comparison_count integer
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
    coalesce((
      select count(distinct r.id) from profiles r
      where r.referred_by = auth.uid() and exists (select 1 from votes v where v.user_id = r.id)
    ), 0)::integer,
    -- CHANGED (096): same as calculate_all_integrity_weights()'s own
    -- comparison_counts CTE above — just "have you sent at least one
    -- comparison invite", no acceptance, no recipient-side credit.
    coalesce((select count(*) from comparison_tokens ct where ct.sender_id = auth.uid()), 0)::integer;
$function$;

grant execute on function public.get_integrity_progress() to authenticated;
revoke execute on function public.get_integrity_progress() from public;

insert into intentionally_public_functions (function_name, note)
values ('get_integrity_progress', 'Returns only the calling user''s own lifetime progress toward integrity-weight bonuses (auth.uid()-scoped); backs the "Reach your full weight" popup on Profile.jsx. Migration 096 (2026-10-29): the comparison count is now "invites sent" (any comparison_tokens row as sender_id), not "invites accepted".')
on conflict (function_name) do update set note = excluded.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As user A with zero votes/comments/referrals, call
--    create_comparison_token() once (as A) and leave it pending/unaccepted
--    forever. Run calculate_all_integrity_weights() -> A's integrity_weight
--    should now be at least 1.0010 above baseline (the comparison bonus
--    alone), even with the token never accepted by anyone.
--
-- 2. get_integrity_progress() as A -> verified_comparison_count = 1 (or
--    however many tokens A has sent), regardless of any of their
--    statuses.
--
-- 3. As a second user B who only ever ACCEPTED someone else's invite and
--    never sent their own -- confirm B's own verified_comparison_count is
--    0 and B gets no comparison bonus from that acceptance alone.
--
-- 4. Confirm sending the same token-creation call many times doesn't
--    change the outcome -- still just the one flat +0.0010, not scaled
--    by how many comparison_tokens rows exist for that sender.
-- ============================================================
