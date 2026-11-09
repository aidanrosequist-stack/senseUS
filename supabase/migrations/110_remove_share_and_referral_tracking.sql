-- senseUS: remove share and referral tracking, and the sharing bonus
--
-- Aidan's decision (2026-11-08): the app no longer records anything when
-- someone taps a Share or Invite button, and no longer attributes signups
-- to whoever shared the link. This migration removes the database side;
-- the same commit removes every claim_share() call (9 Share/Invite
-- handlers), the ?ref= handling in QuestionPreview.jsx/useRegistration.js,
-- and the "Share senseUS" row from Profile.jsx's integrity popup.
--
--   1. calculate_all_integrity_weights(): the +0.0010 "sharing" bonus is
--      removed. Everything else is 108's body unchanged. The 1.0100 cap
--      stays, so the highest weight a new account can now reach is 1.0090.
--      Weights only ever ratchet up (greatest()), so anyone who already
--      earned the sharing bonus keeps their current weight.
--      Header now restates SET search_path (see migration 109, finding 3):
--      any future CREATE OR REPLACE of this function must do the same.
--   2. get_integrity_progress(): verified_referral_count (which since 108
--      meant "has ever tapped Share") is removed from its result. That
--      changes the return type, so it is dropped and re-created, with its
--      grants and allowlist note restored.
--   3. protect_admin_columns(): 108's body minus the referred_by and
--      has_shared_at guards. Must be replaced before those columns are
--      dropped, or every profile insert/update would fail.
--   4. claim_share() and claim_referral() are dropped, along with their
--      intentionally_public_functions entries.
--   5. profiles.has_shared_at and profiles.referred_by are dropped, with
--      their data. Irreversible by design: Aidan chose a full drop over
--      leaving the columns unused. Dropping referred_by also drops its
--      foreign key, the profiles_referred_by_not_self check and
--      idx_profiles_referred_by (all migration 094).
--
-- The "comparing" bonus (comparison invites, migration 096) is unchanged:
-- it is computed from comparison_tokens, which the Compare feature needs
-- anyway, so it adds no separate tracking.

-- ---- 1. Weight calculation: sharing bonus removed ----
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

-- ---- 2. Integrity popup: sharing row removed ----
DROP FUNCTION IF EXISTS public.get_integrity_progress();

CREATE FUNCTION public.get_integrity_progress()
 RETURNS TABLE(
   vote_count integer,
   comment_count integer,
   distinct_vote_days integer,
   distinct_vote_months integer,
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
    coalesce((select count(*) from comparison_tokens ct where ct.sender_id = auth.uid()), 0)::integer;
$function$;

grant execute on function public.get_integrity_progress() to authenticated;
revoke execute on function public.get_integrity_progress() from public;
revoke execute on function public.get_integrity_progress() from anon;

insert into intentionally_public_functions (function_name, note)
values ('get_integrity_progress', 'Returns only the calling user''s own lifetime progress toward integrity-weight bonuses (auth.uid()-scoped); backs the "Reach your full weight" popup on Profile.jsx. Migration 096 (2026-10-29): the comparison count became "invites sent", not "invites accepted". Migration 110 (2026-11-08): the sharing bonus and its verified_referral_count column were removed.')
on conflict (function_name) do update set note = excluded.note;

-- ---- 3. Column guard: referred_by / has_shared_at guards removed ----
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
      new.award_points_remaining := 5;
      new.award_points_reset_month := date_trunc('month', now())::date;
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
      if coalesce(current_setting('senseus.bypass_award_points_protection', true), '') <> 'true' then
        new.award_points_remaining := old.award_points_remaining;
        new.award_points_reset_month := old.award_points_reset_month;
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

-- ---- 4. Drop the tracking RPCs ----
DROP FUNCTION IF EXISTS public.claim_share();
DROP FUNCTION IF EXISTS public.claim_referral(uuid);

delete from intentionally_public_functions
where function_name in ('claim_share', 'claim_referral');

-- ---- 5. Drop the tracking columns and their data ----
alter table public.profiles drop column if exists has_shared_at;
alter table public.profiles drop column if exists referred_by;
