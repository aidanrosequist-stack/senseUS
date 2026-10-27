-- senseUS: Integrity weight v2 — raise the max to 1.0100 and add
-- sharing + comparing as new, provable bonus categories
--
-- REQUESTED (2026-10-27): the user wants the integrity-weight ceiling
-- raised from 1.0050 to 1.0100 (worth an extra 1/100 of a human instead
-- of 1/200), and specifically wants sharing and comparing-with-a-friend
-- to count toward it. He supplied the exact point allocation below,
-- which sums to exactly +0.0100:
--
--   10+ lifetime votes                    +0.0005
--   25+ lifetime votes                    +0.0010
--   50+ lifetime votes                    +0.0020
--   5+ lifetime comments                  +0.0005
--   10+ lifetime comments                 +0.0010  (was +0.0005)
--   any 7 distinct days with a vote       +0.0010  (was +0.0005)
--   3+ distinct calendar months with a vote +0.0020  (new)
--   sharing (see below)                   +0.0010  (new)
--   comparing (see below)                 +0.0010  (new)
--   ------------------------------------------------
--   max                                   1.0100
--
-- WHY "SHARING" AND "COMPARING" ARE DEFINED THE WAY THEY ARE BELOW:
-- Every existing bonus in this system rewards something Postgres can
-- prove happened (a row in votes/comments) — nothing is rewarded on the
-- strength of an unverifiable client-reported action. A naive "clicked
-- the share button" flag would break that invariant: it's free, has no
-- cost to repeat, and proves nothing about whether anyone on the other
-- end ever saw or acted on it. So:
--
--   * "Sharing" is credited only when a share you sent actually grew
--     the community: someone else signed up through your tagged link
--     (profiles.referred_by, added below) AND cast at least one vote.
--     Signing up at all already required passing phone-OTP verification
--     (see completeRegistration() in useRegistration.js — a profiles
--     row only ever gets created after that), so the floor here is "a
--     second real phone-verified human did something," not "a button
--     was clicked." That's the same cost floor the rest of this system
--     already relies on (see migration 010's VOIP-withholding comment).
--
--   * "Comparing" is credited only when comparison_tokens has a row
--     with status = 'accepted' naming you as either sender_id or
--     recipient_id (recipient_id is populated at accept time — see
--     accept_comparison_token(), migration 028), where the OTHER party
--     has also cast at least one vote. Same reasoning: an accepted
--     token is a real, row-locked, two-party DB event, not a client
--     claim; requiring the counterpart to have voted rules out crediting
--     a comparison with a brand-new, otherwise-inert shell account.
--
-- Both of these still cost "a second real phone number" to fake, same as
-- every anti-sockpuppet measure already in this codebase (see VOIP
-- detection, migration 010) — this migration doesn't lower that floor,
-- it just adds two new ways to earn weight sitting on top of it.
--
-- Weights remain upward-only (greatest(current, newly-calculated)), so
-- this can only raise people, never lower anyone already at 1.0050 —
-- they'll simply sit below the new 1.0100 ceiling until they qualify for
-- the new categories too. Existing votes already cast keep whatever
-- integrity_weight_at_vote they were stamped with; only the CHECK
-- constraint's upper bound changes, so future votes can be stamped up to
-- 1.0100.
--
-- Also fixes a drift bug reported by the user: Profile.jsx's "Reach your
-- full weight" popup computed its checklist from its own hand-rolled
-- queries (a rolling 30-day vote/comment count, and profiles.streak_days
-- for "consistent") instead of mirroring calculate_all_integrity_weights()'s
-- actual lifetime, all-time-count logic. Migration 025 already deliberately
-- decoupled the weight's consistency bonus from streak_days (see that
-- migration's comment) but never updated this popup, so it drifted into
-- permanently showing nothing earned for anyone whose daily streak had
-- ever reset — even for a user already sitting at the max, which is only
-- possible if every bonus was genuinely earned at some point in the past
-- (the ratchet never un-earns anything). get_integrity_progress() below
-- is the fix: one function, called by both the nightly job's logic and
-- the popup, so they can't drift apart again.
-- ============================================================

-- IMPORTANT, learned from this exact codebase's own history (see
-- migration 085's post-mortem on 074's regression): protect_admin_columns()
-- must always be replaced from its full, CURRENT body, never a stale
-- copy, or columns protected by a version in between silently lose that
-- protection. This migration's copy below is 085's body verbatim, plus
-- referred_by.
--
-- ---- 1. New column: who referred this profile, if anyone ----
alter table public.profiles
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_referred_by_not_self;

alter table public.profiles
  add constraint profiles_referred_by_not_self check (referred_by is distinct from id);

create index if not exists idx_profiles_referred_by on public.profiles(referred_by);

-- protect_admin_columns() (migration 029, most recently replaced by 085)
-- must now also guard referred_by, the same way it already guards every
-- other column nobody should be able to set via a plain client
-- insert/update: forced to null on INSERT (so the registration upsert in
-- useRegistration.js can never set it directly, even if a field sneaks
-- into that payload), and reverted to its prior value on UPDATE unless
-- claim_referral() below has flipped the transaction-local bypass flag.
-- Without this, "Users can update own profile" (migration 041) has no
-- column-level restriction at all -- any signed-in user could call
-- profiles.update({ referred_by: <anyone> }) directly and retroactively
-- credit any account with "referring" them, with no real share link
-- ever involved.
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
      new.referred_by := null;
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
      if coalesce(current_setting('senseus.bypass_referred_by_protection', true), '') <> 'true' then
        new.referred_by := old.referred_by;
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

-- Write-once claim, mirroring claim_welcome_sms_send()/claim_line_type_check()'s
-- established shape exactly: SECURITY DEFINER, flips its own bypass flag
-- (transaction-local, clears automatically), and the `where ... is null`
-- guard makes the claim atomic and one-time -- a referral can be set
-- once per account, never reassigned later. Returns false (never raises)
-- for a missing/self/already-set/nonexistent referrer so a bad or
-- missing ?ref= param can never block or surface an error during
-- registration -- see useRegistration.js's call site.
CREATE OR REPLACE FUNCTION public.claim_referral(p_referrer_id uuid)
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

  if p_referrer_id is null or p_referrer_id = v_user_id then
    return false;
  end if;

  perform set_config('senseus.bypass_referred_by_protection', 'true', true);

  update public.profiles
  set referred_by = p_referrer_id
  where id = v_user_id
    and referred_by is null
    and exists (select 1 from public.profiles r where r.id = p_referrer_id)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$function$;

grant execute on function public.claim_referral(uuid) to authenticated;
revoke execute on function public.claim_referral(uuid) from public;

insert into intentionally_public_functions (function_name, reason)
values ('claim_referral', 'Lets a newly-registered user record who referred them (write-once, SECURITY DEFINER-guarded); backs the sharing bonus in migration 094.')
on conflict (function_name) do update set reason = excluded.reason;

-- ---- 2. Raise the per-vote weight ceiling ----
alter table public.votes
  drop constraint if exists votes_integrity_weight_at_vote_check;

alter table public.votes
  add constraint votes_integrity_weight_at_vote_check
  check (integrity_weight_at_vote >= 1.0000 and integrity_weight_at_vote <= 1.0100);

-- ---- 3. The actual weight calculation ----
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
    select r.referred_by as user_id, count(distinct r.id) as verified_referral_count
    from profiles r
    where r.referred_by is not null
      and exists (select 1 from votes v where v.user_id = r.id)
    group by r.referred_by
  ),
  comparison_counts as (
    -- Distinct accepted comparisons where BOTH parties have voted at
    -- least once, counting you as either the sender or the eventual
    -- accepter. Requiring both sides to have real voting activity (not
    -- just the counterpart) matters: checking only the counterpart
    -- would let a brand-new, zero-vote shell account earn this bonus
    -- for free by accepting a comparison request from any unrelated
    -- active user — no collusion needed, not even an account the
    -- "attacker" controls on the other end. Both-sides keeps the cost
    -- at "a second real phone-verified identity that actually voted",
    -- matching every other anti-gaming floor in this system.
    select party as user_id, count(distinct counterpart) as verified_comparison_count
    from (
      select ct.sender_id as party, ct.recipient_id as counterpart
      from comparison_tokens ct
      where ct.status = 'accepted' and ct.recipient_id is not null
        and exists (select 1 from votes v where v.user_id = ct.sender_id)
        and exists (select 1 from votes v where v.user_id = ct.recipient_id)
      union all
      select ct.recipient_id as party, ct.sender_id as counterpart
      from comparison_tokens ct
      where ct.status = 'accepted' and ct.recipient_id is not null
        and exists (select 1 from votes v where v.user_id = ct.sender_id)
        and exists (select 1 from votes v where v.user_id = ct.recipient_id)
    ) pairs
    group by party
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

-- ---- 4. Single source of truth for the "Reach your full weight" popup ----
-- Mirrors calculate_all_integrity_weights()'s lifetime logic exactly, so
-- the popup and the nightly job can't drift apart again. SECURITY
-- DEFINER + auth.uid() rather than a parameter: a user can only ever
-- see their own progress.
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
    coalesce((
      select count(distinct counterpart) from (
        select ct.recipient_id as counterpart from comparison_tokens ct
        where ct.status = 'accepted' and ct.sender_id = auth.uid() and ct.recipient_id is not null
          and exists (select 1 from votes v where v.user_id = auth.uid())
          and exists (select 1 from votes v where v.user_id = ct.recipient_id)
        union all
        select ct.sender_id as counterpart from comparison_tokens ct
        where ct.status = 'accepted' and ct.recipient_id = auth.uid()
          and exists (select 1 from votes v where v.user_id = auth.uid())
          and exists (select 1 from votes v where v.user_id = ct.sender_id)
      ) pairs
    ), 0)::integer;
$function$;

grant execute on function public.get_integrity_progress() to authenticated;
revoke execute on function public.get_integrity_progress() from public;

-- Track as an intentionally-public, authenticated-facing RPC (house
-- convention — see migration 000 and every RPC migration since).
insert into intentionally_public_functions (function_name, reason)
values ('get_integrity_progress', 'Returns only the calling user''s own lifetime progress toward integrity-weight bonuses (auth.uid()-scoped); backs the "Reach your full weight" popup on Profile.jsx.')
on conflict (function_name) do update set reason = excluded.reason;

-- ---- One-time verification ----
do $$
begin
  if (select count(*) from pg_constraint where conname = 'votes_integrity_weight_at_vote_check') != 1 then
    raise exception 'votes CHECK constraint not applied as expected';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'referred_by') then
    raise exception 'profiles.referred_by missing';
  end if;
end $$;
