-- senseUS: create the sponsored_queue view — it was never migrated.
--
-- BACKGROUND: Admin.jsx's Sponsored tab has always queried
-- `supabase.from('sponsored_queue')` (see loadSponsoredQueue()), and the
-- row shape it expects is unambiguous from how it renders each row:
-- sponsor_name, question_text, domain, sponsor_category, created_at,
-- status, and a computed_eligibility value it maps through a fixed set
-- of labels (eligible / in_cooldown / slots_full / already_has_live_slot
-- / live / archived / waitlisted) to decide whether to show an Activate
-- button at all. But `sponsored_queue` doesn't exist anywhere in this
-- migration history — grepping every migration for the name turns up
-- nothing. loadSponsoredQueue() also only destructures `data` from the
-- query, silently dropping `error`, so querying a view that was never
-- created fails quietly: `data` comes back null, `setSponsoredQueue(data
-- || [])` sets an empty array, and the panel just renders "No
-- sponsorship requests yet" with no indication anything went wrong. That
-- silent failure is exactly what made a genuinely *live* sponsored
-- question ("Would you trust a company that publicly pledged never to
-- sell your data...", visible in Explore) show as Queue (0) in admin.
--
-- This creates the view, with computed_eligibility reproducing
-- activate_sponsored_question()'s own rules exactly (migration 032,
-- unchanged since 014) so the badge shown here always matches what the
-- Activate button will actually allow:
--   - status = 'live'     -> 'live'
--   - status = 'archived' -> 'archived'
--   - status = 'waitlisted', domain = 'politics & policy':
--       - 2+ other politics & policy sponsorships currently live -> 'slots_full'
--       - this sponsor archived a politics & policy slot within
--         the last 90 days                                       -> 'in_cooldown'
--       - this sponsor already has a live politics & policy slot -> 'already_has_live_slot'
--       - otherwise                                               -> 'eligible'
--   - status = 'waitlisted', any other domain                    -> 'eligible'
-- 'rejected' rows are excluded — nothing in the admin UI has a path to
-- set that status today (no Reject action exists), so there's nothing
-- for this queue to do with one if it ever appears.
-- ============================================================

create or replace view public.sponsored_queue as
select
  sq.id,
  sq.question_id,
  sq.sponsor_name,
  sq.sponsor_contact,
  sq.sponsor_category,
  sq.duration_days,
  sq.status,
  sq.created_at,
  sq.live_at,
  sq.archived_at,
  q.text as question_text,
  q.domain as domain,
  case
    when sq.status = 'live' then 'live'
    when sq.status = 'archived' then 'archived'
    when sq.status = 'waitlisted' and q.domain = 'politics & policy' and (
      select count(*) from public.sponsored_questions sq2
      join public.questions q2 on q2.id = sq2.question_id
      where q2.domain = 'politics & policy' and sq2.status = 'live'
    ) >= 2 then 'slots_full'
    when sq.status = 'waitlisted' and q.domain = 'politics & policy' and exists (
      select 1 from public.sponsored_questions sq3
      join public.questions q3 on q3.id = sq3.question_id
      where q3.domain = 'politics & policy'
        and sq3.sponsor_name = sq.sponsor_name
        and sq3.archived_at is not null
        and sq3.archived_at > now() - interval '90 days'
    ) then 'in_cooldown'
    when sq.status = 'waitlisted' and q.domain = 'politics & policy' and exists (
      select 1 from public.sponsored_questions sq4
      join public.questions q4 on q4.id = sq4.question_id
      where q4.domain = 'politics & policy'
        and sq4.sponsor_name = sq.sponsor_name
        and sq4.status = 'live'
    ) then 'already_has_live_slot'
    else 'eligible'
  end as computed_eligibility
from public.sponsored_questions sq
join public.questions q on q.id = sq.question_id
where sq.status in ('waitlisted', 'live', 'archived')
order by
  case sq.status when 'live' then 0 when 'waitlisted' then 1 else 2 end,
  sq.created_at asc;

-- This view runs with the querying user's own privileges (Postgres's
-- default for views — no security_invoker override needed), so it's
-- still governed by whatever RLS policies actually exist on
-- sponsored_questions and questions in the live database today. Whoever
-- can currently read sponsored_questions directly can read it through
-- this view and no more.
--
-- NOTE for Aidan: I could not find a CREATE POLICY for sponsored_questions
-- anywhere in this migrations folder (or, for that matter, for several
-- other core tables — questions, comments, votes, profiles — that
-- clearly do work correctly in the live app today, per this session's
-- QA pass). That strongly suggests those policies exist in the real
-- database but were set up by hand at some point rather than through a
-- committed migration, so this repo's migration history doesn't fully
-- reproduce the live schema. Worth a `supabase db pull` (or diffing the
-- dashboard's policy list against what's here) at some point so a fresh
-- environment built from these migrations alone wouldn't come up
-- missing them — not blocking, just flagging the gap since I ran into
-- it directly while fixing this view.
grant select on public.sponsored_queue to authenticated;
