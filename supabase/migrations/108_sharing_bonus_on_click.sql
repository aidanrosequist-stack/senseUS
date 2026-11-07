-- migration: 108_sharing_bonus_on_click.sql
--
-- CONTEXT (Aidan, 2026-11-07): same kind of second thoughts migration 096
-- already applied to the "comparing" bonus, now applied to "sharing".
-- Migration 094's version only credited this once someone signed up
-- through your tagged ?ref= link (profiles.referred_by) AND cast at
-- least one vote -- "a share you sent actually grew the community."
-- Aidan's call now: reward the act of sharing itself (hitting the Share
-- button anywhere in the app), not whether a signup or a vote ever
-- followed. His own words: "it doesn't really matter to me if the user
-- actually goes through with it, or the person they sent it to actually
-- goes through with it."
--
-- This is the same deliberate loosening 096 already made, for the same
-- reason, with the same honest tradeoff: sharing is now entirely within
-- one person's own control (no second real human needs to do anything),
-- a lower cost floor than most of this system's other bonus categories.
-- Flagged explicitly rather than silently matched to 094's old reasoning
-- -- see that migration's header for the original "every bonus proves
-- something happened" principle this is now a second, intentional
-- exception to (096 being the first). In practice it stays cheap to
-- trigger but not rewarding to abuse: the bonus is flat (+0.0010, same
-- as every other category here) and write-once per account via
-- claim_share() below -- clicking Share a thousand times earns nothing
-- past the first.
--
-- This also finally answers an earlier, separate question: now that the
-- bonus no longer depends on attributing a signup back to the sharer,
-- every question/comment/party share link in the app can drop its
-- ?ref=<your id> query param entirely -- shorter links, nothing lost.
-- claim_share() (new, below) replaces claim_referral() as the write path
-- those share handlers call. profiles.referred_by and claim_referral()
-- itself are NOT dropped here -- nothing else currently reads
-- referred_by, so they're simply unused going forward rather than
-- actively harmful, and dropping a column/function isn't needed to get
-- what was actually asked for. Worth a separate cleanup migration later
-- if that dead weight ever bothers anyone.
--
-- Kept the RPC output column name verified_referral_count in
-- get_integrity_progress() (same reasoning 096 used for
-- verified_comparison_count) -- renaming it would need a DROP FUNCTION +
-- re-grant for no functional benefit, and the only reader, Profile.jsx's
-- openIntegrityInfo(), just checks `>= 1`, so a 0/1 integer under the old
-- name works unchanged.
--
-- Full bodies of protect_admin_columns() (carried forward from migration
-- 105, its most recent definition), calculate_all_integrity_weights(),
-- and get_integrity_progress() (both carried forward from migration 096,
-- their most recent definitions) -- per this codebase's own standing
-- lesson about CREATE OR REPLACE FUNCTION always needing the complete
-- current body, never a stale copy.
-- ============================================================

-- ---- 1. New column: has this account ever hit a Share button ----
alter table public.profiles
  add column if not exists has_shared_at timestamptz;

-- ---- 2. protect_admin_columns() -- add has_shared_at to the guard ----
CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
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
      new.welcome_sms_sent_at := null;
      new.checked_line_type_at := null;
      new.last_comparison_attempt_at := null;
      new.last_party_attempt_at := null;
      new.referred_by := null;
      new.award_points_remaining := 5;
      new.award_points_reset_month := date_trunc('month', now())::date;
      new.has_shared_at := null;
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      if coalesce(current_setting('senseus.bypass_last_vote_at_protection', true), '') <> 'true' then
        new.last_vote_at := old.last_vote_at;
      end if;
      if coalesce(current_setting('senseus.bypass_welcome_sms_sent_at_protection', true), '') <> 'true' then
        new.welcome_sms_sent_at := old.welcome_sms_sent_at;
      end if;
      if coalesce(current_setting('senseus.bypass_checked_line_type_at_protection', true), '') <> 'true' then
        new.checked_line_type_at := old.checked_line_type_at;
      end if;
      if coalesce(current_setting('senseus.bypass_comparison_attempt_protection', true), '') <> 'true' then
        new.last_comparison_attempt_at := old.last_comparison_attempt_at;
      end if;
      if coalesce(current_setting('senseus.bypass_party_attempt_protection', true), '') <> 'true' then
        new.last_party_attempt_at := old.last_party_attempt_at;
      end if;
      if coalesce(current_setting('senseus.bypass_referred_by_protection', true), '') <> 'true' then
        new.referred_by := old.referred_by;
      end if;
      if coalesce(current_setting('senseus.bypass_award_points_protection', true), '') <> 'true' then
        new.award_points_remaining := old.award_points_remaining;
        new.award_points_reset_month := old.award_points_reset_month;
      end if;
      if coalesce(current_setting('senseus.bypass_has_shared_at_protection', true), '') <> 'true' then
        new.has_shared_at := old.has_shared_at;
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

-- ---- 3. Write-once claim, mirroring claim_referral()'s established shape ----
-- No parameter at all, unlike claim_referral() -- there's nothing left to
-- verify (no referrer id, no self-check), just "has this account ever
-- claimed this." SECURITY DEFINER + auth.uid(), `where has_shared_at is
-- null` makes the claim atomic and one-time. Never raises for an
-- already-claimed account (just returns false), so it's always safe to
-- call fire-and-forget from every Share button's click handler.
CREATE OR REPLACE FUNCTION public.claim_share()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_claimed boolean := false;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in.';
  end if;

  perform set_config('senseus.bypass_has_shared_at_protection', 'true', true);

  update public.profiles
  set has_shared_at = now()
  where id = v_user_id
    and has_shared_at is null
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$function$;

grant execute on function public.claim_share() to authenticated;
revoke execute on function public.claim_share() from public;

insert into intentionally_public_functions (function_name, note)
values ('claim_share', 'Write-once claim (SECURITY DEFINER) backing the sharing integrity-weight bonus as of migration 108 -- called the moment any Share button''s click handler fires anywhere in the app (VoteCard, ResultsCard, Explore, Conversation, Activity, Party, InviteFriendCard), with no proof the share was ever completed, sent, or acted on by anyone. Aidan''s explicit call (2026-11-07), matching the same tradeoff already made for the comparing bonus in migration 096.')
on conflict (function_name) do update set note = excluded.note;

-- ---- 4. The actual weight calculation -- sharing criterion swapped ----
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
  comparison_counts as (
    -- Unchanged by this migration (see migration 096): credited the
    -- moment you send a comparison invite, any status, no acceptance
    -- required.
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
            -- CHANGED (108): "sharing" no longer requires a referred
            -- signup + vote (dropped the referral_counts CTE entirely) —
            -- just "has this account ever claimed a share", via the new
            -- has_shared_at column / claim_share() RPC above.
            + case when p.has_shared_at is not null then 0.0010 else 0 end
            + case when coalesce(cp.verified_comparison_count, 0) >= 1 then 0.0010 else 0 end,
            1.0100
          )
      end as calculated_weight
    from profiles p
    left join vote_counts vc on vc.user_id = p.id
    left join comment_counts cc on cc.user_id = p.id
    left join distinct_vote_days dvd on dvd.user_id = p.id
    left join distinct_vote_months dvm on dvm.user_id = p.id
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

-- ---- 5. "Reach your full weight" popup -- same swap ----
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
    -- CHANGED (108): column name kept as verified_referral_count (see
    -- this migration's header for why), but it's now just "have you ever
    -- claimed a share" -- 1 or 0, not a real referral count anymore.
    coalesce((select case when has_shared_at is not null then 1 else 0 end from profiles where id = auth.uid()), 0)::integer,
    coalesce((select count(*) from comparison_tokens ct where ct.sender_id = auth.uid()), 0)::integer;
$function$;

grant execute on function public.get_integrity_progress() to authenticated;
revoke execute on function public.get_integrity_progress() from public;

insert into intentionally_public_functions (function_name, note)
values ('get_integrity_progress', 'Returns only the calling user''s own lifetime progress toward integrity-weight bonuses (auth.uid()-scoped); backs the "Reach your full weight" popup on Profile.jsx. Migration 096 (2026-10-29): the comparison count became "invites sent", not "invites accepted". Migration 108 (2026-11-07): the (still-named) verified_referral_count became "has this account ever claimed a share" (1/0), not a real referral count.')
on conflict (function_name) do update set note = excluded.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As a test user with zero votes/comments/shares, call claim_share()
--    once -> returns true, has_shared_at is now set. Run
--    calculate_all_integrity_weights() -> that user's integrity_weight is
--    now at least 1.0010 above baseline, with no signup or vote by
--    anyone else ever having happened.
--
-- 2. Call claim_share() a second time on the same account -> returns
--    false, has_shared_at unchanged (still the first timestamp) -- write
--    once, confirmed.
--
-- 3. get_integrity_progress() as that user -> verified_referral_count = 1.
--
-- 4. Direct client call: `update profiles set has_shared_at = now() where
--    id = auth.uid()` as a non-service-role user -> no-ops (reverted by
--    protect_admin_columns, same as every other guarded column) --
--    confirms has_shared_at can only be set via claim_share().
-- ============================================================
