-- senseUS: VOIP-detected weight withholding
--
-- Non-fixed VOIP numbers (Google Voice, TextNow, etc.) are the primary
-- tool phone farms use, but they're also used by plenty of legitimate
-- privacy-conscious users. Rather than blocking registration (which
-- punishes real users and doesn't actually stop a determined farm
-- operator), flagged accounts simply don't earn integrity weight
-- increases for a probation window. They vote and participate exactly
-- normally — their voice just carries baseline weight for longer,
-- consistent with the existing "upward only, never penalizes" design:
-- nobody's weight ever goes below 1.0000, this just delays how fast it
-- can climb above it for accounts with this specific risk signal.
--
-- Graduation requires BOTH the time window to elapse AND real
-- engagement (vote count) — either alone is gameable: a farm account
-- could just wait out a pure time window with zero activity, or rack
-- up votes quickly to beat a pure vote-count window.
-- ============================================================

alter table public.profiles
  add column if not exists voip_flagged_at timestamptz;

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
            + case when coalesce(p.streak_days, 0) >= 7 then 0.0005 else 0 end,
            1.0050
          )
      end as calculated_weight
    from profiles p
    left join vote_counts vc on vc.user_id = p.id
    left join comment_counts cc on cc.user_id = p.id
  )
  update profiles p
  set integrity_weight = greatest(p.integrity_weight, nw.calculated_weight)
  from new_weights nw
  where p.id = nw.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$function$;

-- integrity_events had RLS enabled but zero policies defined, meaning
-- nobody (not even admins through the app) could actually read it.
-- Only inserts from the service role (used by the new edge function
-- below) worked. Add the missing admin view policy.
drop policy if exists "Admins can view integrity events" on public.integrity_events;
create policy "Admins can view integrity events"
on public.integrity_events
for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);

drop policy if exists "Admins can update integrity events" on public.integrity_events;
create policy "Admins can update integrity events"
on public.integrity_events
for update
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);
