-- senseUS: Comment Awards -- free, Reddit-style named accolades givers can
-- attach to a comment instead of (or alongside) writing a reply.
--
-- CONTEXT (Aidan brainstorm, 2026-11-02): wants a way for people to react
-- strongly to a comment -- for or against -- without typing a reply, free
-- (no paid currency, consistent with this app's existing meritocratic/free
-- mechanics -- integrity weight, resonance, badges are all earned, never
-- bought), capped at a small shared monthly allowance so it stays a
-- deliberate, scarce signal rather than a second resonate button. Settled
-- shape, confirmed across several follow-ups:
--   * One shared pool of 5 "award points" per user, resetting on a fixed
--     calendar-month boundary (not a rolling per-user window -- Aidan's
--     call, also simplest to reason about and keeps this consistent with
--     every other monthly/periodic mechanic in this app being calendar-
--     aligned rather than per-user).
--   * No rollover of unused points.
--   * 10 award types. Two "big" ones cost the ENTIRE monthly allowance (5
--     points): Gold Star (positive -- "this comment was great, full
--     stop") and Needs Work (negative -- "the antithesis of the Gold
--     Star"). Eight "everyday" ones cost 1 point each: six positive
--     (Well-Argued, Changed My Mind, Brought Receipts, Made Me Laugh,
--     Fair & Balanced, Good-Faith Disagreement) and two negative (Needs a
--     Source, Off-Topic).
--   * Attribution is shown on every award, positive or negative alike --
--     Aidan's explicit call after being walked through the asymmetric-
--     attribution alternative (anonymizing only the negative ones, to
--     reduce a harassment/pile-on vector given there's no moderation step
--     here the way comment_flags has). Flagging this again here in case
--     Aidan wants to revisit it once this is live and the negative awards
--     see real use -- the data model below resolves attribution through
--     the same server-side display-name convention get_conversation_
--     comments()/get_pinned_comments() already use (never a raw user_id
--     to the client), which would make switching to anonymous-for-
--     negative a small, contained follow-up change to just
--     get_comment_award_details() rather than a schema change.
--   * Awards feed into exactly 3 badges (Aidan: "but that's about it" --
--     no ranking boost, no visibility effect beyond the badge and the
--     award pills themselves): a general "giving" badge, a general
--     "receiving" badge, and a specific rare badge for receiving a Gold
--     Star. Deliberately nothing for receiving Needs Work -- a badge is a
--     reward, and rewarding/flagging the one unmoderated negative signal
--     in the app would cut against the "let's try and be nice" framing
--     this whole feature was pitched under. Threshold picks below (25
--     given / 25 received) are a first guess, not something Aidan
--     specified -- easy to retune in a later migration if they feel too
--     easy or too hard once this is live.
--   * Aidan also wants to track/highlight the most-awarded comments for
--     his own marketing use -- get_top_awarded_comments() below, same
--     admin-only shape as get_top_questions_by_comments() (migration 089),
--     added as a third snapshot card on AdminDashboard.jsx.
--
-- SCHEMA DECISIONS:
--   award_types -- a small reference table (id/cost/is_negative/
--   sort_order) rather than hardcoding the 10 ids and costs inside every
--   function that needs them. Lets give_comment_award() validate a type
--   and look up its cost with one join instead of a big CASE, and lets a
--   type's cost/active status change later without touching function
--   bodies at all.
--
--   comment_awards -- the actual given-awards, same surrogate-uuid-PK/
--   cascade-FK shape as comment_resonances/pinned_comments. UNIQUE
--   (giver_id, comment_id, award_type) -- a user can give a comment
--   several DIFFERENT awards, but not stack the same one twice. No
--   "unaward"/take-back flow -- not asked for, and reversing a spent
--   point would need its own design (does the point come back? does a
--   notification get un-sent?) that's out of scope for what Aidan asked.
--
--   RLS/grants deliberately mirror vote_changes, not comment_resonances:
--   no client INSERT/UPDATE/DELETE policy on comment_awards at all. The
--   only write path is give_comment_award(), a SECURITY DEFINER RPC,
--   because giving an award has to be atomic with spending a shared point
--   balance -- a bare client-side INSERT policy can't enforce "you have
--   enough points left" without a separate round trip that a race
--   condition (two fast clicks, two browser tabs) could slip between.
--   SELECT is scoped to a caller's own given-awards only (so the client
--   can check "did I already give this" without a round trip); the public
--   listing-with-attribution path is get_comment_award_details() below,
--   which resolves display name server-side the same way get_conversation_
--   comments() does rather than ever exposing another user's raw
--   giver_id to the client.
--
--   profiles.award_points_remaining / award_points_reset_month -- a lazy
--   reset inside give_comment_award() itself (if the stored reset-month
--   is behind the real current month, refill to 5 before spending) rather
--   than a new cron job. Mirrors why resonance_count was moved to a
--   trigger (migration 088) instead of a batch job: a lazy/atomic check at
--   the point of use can't silently drift the way a scheduled job that
--   fails to run can. Both new columns get the same protect_admin_columns
--   treatment as every other server-computed profiles column (is_admin,
--   integrity_weight, resonance_score, etc.) -- otherwise a direct PATCH
--   through the anon/authenticated REST API could set its own balance.
--   give_comment_award() updates them via the same transaction-local
--   "senseus.bypass_<column>_protection" session-setting pattern migration
--   055 established for last_vote_at/answers_count, so a normal
--   authenticated call can still legitimately move the balance.
-- ============================================================

-- ============================================================
-- award_types: the 10-item catalog. cost is 1 or 5 (the shared monthly
-- pool is 5 points total); is_negative drives the "needs attention"
-- grouping in the UI and is what calculate_badges() excludes from the
-- receiving badge's eligibility reasoning below (it isn't actually -- see
-- that section -- but is kept here for any future report/UI that wants to
-- split positive from negative without re-encoding the list).
-- ============================================================

CREATE TABLE public.award_types (
  id text PRIMARY KEY,
  cost smallint NOT NULL CHECK (cost IN (1, 5)),
  is_negative boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL
);

INSERT INTO public.award_types (id, cost, is_negative, sort_order) VALUES
  ('gold-star', 5, false, 1),
  ('needs-work', 5, true, 2),
  ('well-argued', 1, false, 3),
  ('changed-my-mind', 1, false, 4),
  ('brought-receipts', 1, false, 5),
  ('made-me-laugh', 1, false, 6),
  ('fair-and-balanced', 1, false, 7),
  ('good-faith-disagreement', 1, false, 8),
  ('needs-a-source', 1, true, 9),
  ('off-topic', 1, true, 10);

ALTER TABLE public.award_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view award types"
  ON public.award_types FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.award_types TO authenticated;

-- ============================================================
-- comment_awards: who gave what to which comment, and when.
-- ============================================================

CREATE TABLE public.comment_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  giver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  award_type text NOT NULL REFERENCES public.award_types(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comment_awards_giver_comment_type_key UNIQUE (giver_id, comment_id, award_type)
);

CREATE INDEX idx_comment_awards_comment_id ON public.comment_awards (comment_id);
CREATE INDEX idx_comment_awards_giver_id ON public.comment_awards (giver_id);

ALTER TABLE public.comment_awards ENABLE ROW LEVEL SECURITY;

-- Own given-awards only, directly -- lets the client answer "have I
-- already given this comment X" without a round trip. The public,
-- attributed view of ALL awards on a comment goes through
-- get_comment_award_details() below instead of a broader SELECT policy
-- here, so another user's raw giver_id is never sent to the client
-- directly off this table.
CREATE POLICY "Users can view own given awards"
  ON public.comment_awards FOR SELECT
  TO authenticated
  USING (auth.uid() = giver_id);

GRANT SELECT ON public.comment_awards TO authenticated;

-- Deliberately no INSERT/UPDATE/DELETE policy and no corresponding GRANT
-- for authenticated -- see header. The only write path is
-- give_comment_award() (SECURITY DEFINER) below.

-- ============================================================
-- profiles: the shared monthly award-points balance.
-- award_points_reset_month stores the first day of the month the balance
-- currently reflects; give_comment_award() compares it against the real
-- current month and refills lazily rather than relying on a cron job.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS award_points_remaining smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS award_points_reset_month date NOT NULL DEFAULT date_trunc('month', now())::date;

-- ============================================================
-- protect_admin_columns(): CREATE OR REPLACE carries forward the function's
-- full current body VERBATIM from migration 095_question_parties.sql
-- (confirmed via grep that nothing between 095 and here redefines it),
-- per this project's own standing rule against replacing a function from
-- a stale copy. Only addition: award_points_remaining/award_points_
-- reset_month get the same INSERT-defaults-to-server-truth / UPDATE-
-- reverts-unless-bypassed treatment as every other server-computed
-- column, using the same transaction-local bypass-flag pattern migration
-- 055 introduced for last_vote_at/answers_count (new bypass flags:
-- senseus.bypass_award_points_protection, covering both columns together
-- since give_comment_award() always writes them as a pair).
-- ============================================================

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

-- Trigger itself is unchanged (still fires before insert/update on
-- profiles) -- only the function body above changed. Not re-creating the
-- trigger here since CREATE OR REPLACE FUNCTION already applies to it.

-- ============================================================
-- give_comment_award(): the one write path onto comment_awards. Validates
-- the award type, blocks self-awarding (same reasoning as comment_
-- resonances' INSERT policy -- migration 041 -- blocking self-resonance),
-- lazily refills the monthly balance if the stored reset-month is stale,
-- checks for a duplicate (giver, comment, type), and spends the points
-- and inserts the award atomically in one transaction. Returns the
-- caller's remaining balance so the client can update its own UI without
-- a second round trip.
-- ============================================================

CREATE OR REPLACE FUNCTION public.give_comment_award(p_comment_id uuid, p_award_type text)
 RETURNS smallint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_cost smallint;
  v_comment_owner uuid;
  v_current_month date := date_trunc('month', now())::date;
  v_remaining smallint;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  select cost into v_cost
  from public.award_types
  where id = p_award_type;

  if v_cost is null then
    raise exception 'Unknown award type: %', p_award_type;
  end if;

  select user_id into v_comment_owner
  from public.comments
  where id = p_comment_id and is_deleted = false;

  if v_comment_owner is null then
    raise exception 'Comment not found.';
  end if;

  if v_comment_owner = v_user_id then
    raise exception 'You can''t give an award to your own comment.';
  end if;

  if exists (
    select 1 from public.comment_awards
    where giver_id = v_user_id and comment_id = p_comment_id and award_type = p_award_type
  ) then
    raise exception 'You''ve already given this award to this comment.';
  end if;

  -- Lazy monthly refill, atomic with the spend below (same row lock) --
  -- if the stored reset-month is behind the real current month, top the
  -- balance back up to 5 before checking/spending against it.
  perform set_config('senseus.bypass_award_points_protection', 'true', true);

  update public.profiles
  set award_points_remaining = 5,
      award_points_reset_month = v_current_month
  where id = v_user_id
    and award_points_reset_month < v_current_month;

  update public.profiles
  set award_points_remaining = award_points_remaining - v_cost
  where id = v_user_id
    and award_points_remaining >= v_cost
  returning award_points_remaining into v_remaining;

  if v_remaining is null then
    raise exception 'Not enough awards remaining this month.';
  end if;

  insert into public.comment_awards (comment_id, giver_id, award_type)
  values (p_comment_id, v_user_id, p_award_type);

  return v_remaining;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.give_comment_award(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.give_comment_award(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.give_comment_award(uuid, text) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('give_comment_award', 'Client RPC (Conversation.jsx) -- the only write path onto comment_awards. SECURITY DEFINER so it can atomically check/spend a user''s shared monthly award-points balance (profiles.award_points_remaining, otherwise locked by protect_admin_columns) and insert the award row in one transaction. Blocks self-awarding and duplicate (giver, comment, award_type). Migration 105 (2026-11-02).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- get_remaining_award_points(): tiny read-only helper so the client can
-- show "3 awards left this month" on page load without duplicating the
-- lazy-refill logic client-side (and without the refill actually
-- happening just from looking -- this is SELECT-only, it never writes).
-- Returns what the balance WOULD be after a refill, not the possibly-
-- stale stored value, so the UI is never wrong for a whole render cycle
-- after a month boundary passes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_remaining_award_points()
 RETURNS smallint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.award_points_reset_month < date_trunc('month', now())::date then 5
    else p.award_points_remaining
  end
  from public.profiles p
  where p.id = auth.uid();
$function$;

GRANT EXECUTE ON FUNCTION public.get_remaining_award_points() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_remaining_award_points() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_remaining_award_points() FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_remaining_award_points', 'Client RPC (Conversation.jsx) -- read-only; computes what the caller''s monthly award-points balance would be after a lazy refill (if their stored reset-month is stale) without actually writing it, so the displayed balance is never wrong across a month boundary even though the real refill only happens inside give_comment_award(). Migration 105 (2026-11-02).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- get_conversation_comments() rewrite: adds award_counts, a jsonb map of
-- award_type -> count of DISTINCT givers for that comment (e.g.
-- {"gold-star": 1, "well-argued": 3}), so the thread can show award pills
-- on every comment without a second round trip per comment. NULL (not an
-- empty object) when a comment has never received an award -- cheaper to
-- compute and the frontend treats both the same way. DROP + CREATE (not
-- CREATE OR REPLACE) because the output column list is changing, same
-- reason migrations 061/072/076 needed a fresh CREATE each time they did
-- this. Every other column/line here is carried forward verbatim from
-- migration 076, the function's current definition.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_conversation_comments(uuid);

CREATE FUNCTION public.get_conversation_comments(p_question_id uuid)
 RETURNS TABLE(
   id uuid,
   body text,
   resonance_count integer,
   created_at timestamp with time zone,
   parent_id uuid,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   vote_choice text,
   original_body text,
   original_vote_choice text,
   previous_body text,
   previous_vote_choice text,
   edit_count integer,
   award_counts jsonb
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.body,
    c.resonance_count,
    c.created_at,
    c.parent_id,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name,
    c.vote_choice_at_comment as vote_choice,
    c.original_body,
    c.original_vote_choice,
    c.previous_body,
    c.previous_vote_choice,
    c.edit_count,
    (
      select jsonb_object_agg(ca.award_type, ca.cnt)
      from (
        select award_type, count(*) as cnt
        from public.comment_awards
        where comment_id = c.id
        group by award_type
      ) ca
    ) as award_counts
  from public.comments c
  left join public.profiles p on p.id = c.user_id
  where c.question_id = p_question_id
    and c.is_deleted = false
  order by c.resonance_count desc
  limit 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_conversation_comments(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_conversation_comments', 'Client RPC (Conversation.jsx) -- single call replacing the comments select + get_public_profiles + get_commenter_vote_choices pattern, so another user''s raw user_id is never sent to the client at all. Computes is_own server-side via auth.uid(). Migration 072 (2026-09-04): vote_choice is the frozen vote_choice_at_comment snapshot rather than a live join against votes, plus original_body/original_vote_choice/edit_count for the strikethrough edit-history display. Migration 076 (2026-09-08): added previous_body/previous_vote_choice, capturing the version immediately before the most recent edit (not just the very first), so a second edit no longer silently loses the version that existed between the two edits. Migration 105 (2026-11-02): added award_counts, a jsonb map of award_type to distinct-giver count, so Comment Award pills render on every comment with no per-comment follow-up call.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- get_comment_award_details(): the attributed, per-award list for ONE
-- comment -- fetched on demand (e.g. a "who gave this" expand), not
-- bundled into get_conversation_comments() above, since most comments on
-- a busy thread will never be expanded and every giver's resolved display
-- name for every award on every comment would be a lot of payload most
-- renders never use. Same display-name resolution (first_name/
-- last_initial/display_preference/anon_name) as get_conversation_
-- comments()/get_pinned_comments() -- another user's raw id is never
-- sent to the client.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_comment_award_details(p_comment_id uuid)
 RETURNS TABLE(
   award_type text,
   given_at timestamp with time zone,
   is_own boolean,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    ca.award_type,
    ca.created_at as given_at,
    (ca.giver_id = auth.uid()) as is_own,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name
  from public.comment_awards ca
  join public.profiles p on p.id = ca.giver_id
  where ca.comment_id = p_comment_id
  order by ca.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION public.get_comment_award_details(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_comment_award_details(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comment_award_details(uuid) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_comment_award_details', 'Client RPC (Conversation.jsx, "who gave this" expand) -- the attributed list of every award a single comment has received, with giver display name resolved server-side the same way get_conversation_comments() does. Fetched on demand rather than bundled into the main thread payload. Migration 105 (2026-11-02).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- get_top_awarded_comments(): admin-only report for Aidan's marketing use
-- ("track and perhaps highlight what comments have been awarded the
-- most"). Same admin-gating/limit-clamping shape as
-- get_top_questions_by_comments() (migration 089).
--
-- Filtered on is_deleted = false AND is_removed = false -- deliberately
-- DIFFERENT from 089's own convention of counting is_removed = true
-- comments as real (089's job is an accurate size-of-thread count; this
-- report's job is picking comments to put in front of an audience, and a
-- comment the author chose to delete -- even with replies preserved --
-- should never be the thing Aidan screenshots for marketing).
--
-- award_count is a count of individual award ROWS (each distinct giver
-- counts once per award type), not spend-weighted by cost -- "most
-- awarded" reads most naturally as "most accolades received," and
-- weighting by cost would make a single Gold Star outrank five different
-- people each giving a different everyday award, which doesn't match
-- that framing. gold_star_count surfaced as its own column alongside the
-- total specifically because Aidan called out Gold Star as the
-- prestige/standout award -- "won a Gold Star" is likely the more useful
-- marketing fact on its own, separate from the raw total.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_top_awarded_comments(p_limit int DEFAULT 10)
 RETURNS TABLE(
   id uuid,
   body text,
   question_id uuid,
   question_text text,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   award_count bigint,
   gold_star_count bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select
    c.id,
    c.body,
    c.question_id,
    q.text as question_text,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name,
    count(ca.id) as award_count,
    count(ca.id) filter (where ca.award_type = 'gold-star') as gold_star_count
  from public.comments c
  join public.comment_awards ca on ca.comment_id = c.id
  join public.questions q on q.id = c.question_id
  left join public.profiles p on p.id = c.user_id
  where c.is_deleted = false
    and c.is_removed = false
  group by c.id, c.body, c.question_id, q.text, p.first_name, p.last_initial, p.display_preference, p.anon_name
  order by award_count desc, gold_star_count desc, c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_top_awarded_comments(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_top_awarded_comments(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_top_awarded_comments(int) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_top_awarded_comments', 'Client RPC (AdminDashboard.jsx) -- admin-only, enforced inside the function via is_admin_user(); ranks comments by total Comment Awards received, for Aidan''s marketing-highlight use. Excludes deleted/self-removed comments (unlike get_top_questions_by_comments, which deliberately still counts those for thread-size purposes -- this report is about picking comments to showcase). Migration 105 (2026-11-02).')
ON CONFLICT (function_name) DO NOTHING;

-- ============================================================
-- calculate_badges(): CREATE OR REPLACE carries forward the function's
-- full current body VERBATIM from migration 103_party_starter_badge.sql
-- (confirmed via grep that nothing between 103 and here redefines it),
-- per this project's own standing rule against replacing a function from
-- a stale copy. Three additions, all per Aidan's confirmed badge scope:
--   * award-giver: given 25+ comment awards (any type/cost mix).
--   * well-regarded: received 25+ comment awards on your own comments
--     (any type/cost mix -- deliberately NOT excluding Needs Work/Needs a
--     Source/Off-Topic from this count: a badge for "a lot of people have
--     reacted strongly to your comments" is a reasonable thing to earn
--     even if some of those reactions were critical, and splitting the
--     count by polarity would need a second badge Aidan didn't ask for).
--   * gold-standard: received at least 1 Gold Star specifically -- the
--     rare, prestige-tier badge Aidan asked for alongside the two general
--     ones. Deliberately nothing for receiving Needs Work -- see the
--     migration header.
-- Grants/schedule unchanged -- CREATE OR REPLACE never resets them, same
-- note every prior version of this function has made.
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_badges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  profile_record record;
  total_votes int;
  leaning_votes int;
  leaning_pct float;
  distinct_domains int;
  total_domains int;
  consecutive_definitive int;
  max_consecutive int;
  vote_record record;
  new_badges text[];
  old_badges text[];
  final_badges text[];
  added_badge text;
  comment_count int;
  max_replies_on_one_comment int;
  distinct_changed_questions int;
  distinct_resonated int;
  distinct_flagged int;
  distinct_articles_read int;
  founding_rank int;
  first_responder_count int;
  party_completed_count int;
  awards_given_count int;
  awards_received_count int;
  gold_stars_received_count int;
  already_notified boolean;
  notif_title text;
  notif_body text;
begin
  select count(distinct domain) into total_domains
  from public.questions
  where published_at is not null;

  for profile_record in select id, badges, created_at, longest_streak from public.profiles loop
    new_badges := '{}';
    old_badges := coalesce(profile_record.badges, '{}');

    -- Votes: total, leaning pct, and domain coverage
    select
      count(*),
      count(*) filter (where v.choice in ('ly', 'ln')),
      count(distinct q.domain)
    into total_votes, leaning_votes, distinct_domains
    from public.votes v
    join public.questions q on q.id = v.question_id
    where v.user_id = profile_record.id;

    -- Ultra-Definitive: 100+ votes, less than 10% leaning
    if total_votes >= 100 then
      leaning_pct := leaning_votes::float / total_votes::float;
      if leaning_pct < 0.10 then
        new_badges := array_append(new_badges, 'ultra-definitive');
      end if;
    end if;

    -- Civically Engaged / Voice of the People: total votes cast
    if total_votes >= 100 then
      new_badges := array_append(new_badges, 'civically-engaged');
    end if;
    if total_votes >= 500 then
      new_badges := array_append(new_badges, 'voice-of-the-people');
    end if;

    -- Well-Rounded: voted in every domain currently published
    if total_domains > 0 and distinct_domains >= total_domains then
      new_badges := array_append(new_badges, 'well-rounded');
    end if;

    -- Calculate max consecutive definitive votes (unchanged from before)
    consecutive_definitive := 0;
    max_consecutive := 0;

    for vote_record in
      select choice from public.votes
      where user_id = profile_record.id
      order by created_at asc
    loop
      if vote_record.choice in ('yes', 'no') then
        consecutive_definitive := consecutive_definitive + 1;
        if consecutive_definitive > max_consecutive then
          max_consecutive := consecutive_definitive;
        end if;
      else
        consecutive_definitive := 0;
      end if;
    end loop;

    if max_consecutive >= 20 then
      new_badges := array_append(new_badges, 'decisive-streak');
    end if;
    if max_consecutive >= 50 then
      new_badges := array_append(new_badges, 'super-decisive-streak');
    end if;

    -- Conversationalist / Town Crier: comments + replies posted
    select count(*) into comment_count
    from public.comments
    where user_id = profile_record.id and is_deleted = false;

    if comment_count >= 50 then
      new_badges := array_append(new_badges, 'conversationalist');
    end if;
    if comment_count >= 100 then
      new_badges := array_append(new_badges, 'town-crier');
    end if;

    -- Conversation Starter / Lightning Rod: most direct replies on any
    -- one comment the user wrote
    select coalesce(max(reply_count), 0) into max_replies_on_one_comment
    from (
      select count(*) as reply_count
      from public.comments r
      join public.comments c on c.id = r.parent_id
      where c.user_id = profile_record.id and r.is_deleted = false
      group by r.parent_id
    ) reply_counts;

    if max_replies_on_one_comment >= 10 then
      new_badges := array_append(new_badges, 'conversation-starter');
    end if;
    if max_replies_on_one_comment >= 50 then
      new_badges := array_append(new_badges, 'lightning-rod');
    end if;

    -- On a Roll / Unstoppable / Constant as the Sun: longest_streak is a
    -- high-water mark (protected elsewhere from ever decreasing), so
    -- these are safe against today's streak resetting to 0.
    if coalesce(profile_record.longest_streak, 0) >= 7 then
      new_badges := array_append(new_badges, 'on-a-roll');
    end if;
    if coalesce(profile_record.longest_streak, 0) >= 30 then
      new_badges := array_append(new_badges, 'unstoppable');
    end if;
    if coalesce(profile_record.longest_streak, 0) >= 100 then
      new_badges := array_append(new_badges, 'constant-as-the-sun');
    end if;

    -- Open Minded: changed vote on N distinct questions (not N total
    -- change events — someone flip-flopping on one question shouldn't
    -- count the same as genuine reconsideration across many)
    select count(distinct question_id) into distinct_changed_questions
    from public.vote_changes
    where user_id = profile_record.id;

    if distinct_changed_questions >= 10 then
      new_badges := array_append(new_badges, 'open-minded');
    end if;

    -- Ripple Maker / Amplifier: resonated with N distinct comments
    select count(distinct comment_id) into distinct_resonated
    from public.comment_resonances
    where user_id = profile_record.id;

    if distinct_resonated >= 20 then
      new_badges := array_append(new_badges, 'ripple-maker');
    end if;
    if distinct_resonated >= 50 then
      new_badges := array_append(new_badges, 'amplifier');
    end if;

    -- Watchful Eye / Guardian of Truth: flagged N distinct comments
    select count(distinct comment_id) into distinct_flagged
    from public.comment_flags
    where user_id = profile_record.id;

    if distinct_flagged >= 10 then
      new_badges := array_append(new_badges, 'watchful-eye');
    end if;
    if distinct_flagged >= 50 then
      new_badges := array_append(new_badges, 'guardian-of-truth');
    end if;

    -- Diligent Researcher / Master Researcher: read the Make Up My Mind
    -- articles behind N distinct questions
    select count(distinct question_id) into distinct_articles_read
    from public.article_views
    where user_id = profile_record.id;

    if distinct_articles_read >= 10 then
      new_badges := array_append(new_badges, 'diligent-researcher');
    end if;
    if distinct_articles_read >= 50 then
      new_badges := array_append(new_badges, 'diligent-researcher-2');
    end if;

    -- Founding Member: one of the first 500 accounts by signup order.
    -- Fixed by created_at, so this rank never changes retroactively.
    select count(*) into founding_rank
    from public.profiles p2
    where p2.created_at <= profile_record.created_at;

    if founding_rank <= 500 then
      new_badges := array_append(new_badges, 'founding-member');
    end if;

    -- First Responder: among the first 10 voters on a question, on 10
    -- different questions. Ranks each voter on every question this user
    -- voted on, then counts how many of THIS user's own votes landed in
    -- the top 10 for their question.
    select count(*) into first_responder_count
    from (
      select v.user_id,
             row_number() over (partition by v.question_id order by v.created_at asc) as vote_rank
      from public.votes v
      where v.question_id in (
        select question_id from public.votes where user_id = profile_record.id
      )
    ) ranked
    where ranked.user_id = profile_record.id
      and ranked.vote_rank <= 10;

    if first_responder_count >= 10 then
      new_badges := array_append(new_badges, 'first-responder');
    end if;

    -- Party Starter: completed at least one ?Party! (as host or guest --
    -- both roles are rows in question_party_participants, and only a
    -- party that's actually reached 'completed' counts, not one that
    -- merely expired with some answers in it).
    select count(*) into party_completed_count
    from public.question_party_participants qpp
    join public.question_parties qp on qp.id = qpp.party_id
    where qpp.user_id = profile_record.id and qp.status = 'completed';

    if party_completed_count >= 1 then
      new_badges := array_append(new_badges, 'party-starter');
    end if;

    -- Award-Giver: given 25+ Comment Awards (any type/cost mix).
    select count(*) into awards_given_count
    from public.comment_awards
    where giver_id = profile_record.id;

    if awards_given_count >= 25 then
      new_badges := array_append(new_badges, 'award-giver');
    end if;

    -- Well-Regarded: received 25+ Comment Awards on your own comments
    -- (any type/cost mix -- see migration 105's header for why this
    -- deliberately doesn't exclude the negative award types).
    select count(*) into awards_received_count
    from public.comment_awards ca
    join public.comments c on c.id = ca.comment_id
    where c.user_id = profile_record.id;

    if awards_received_count >= 25 then
      new_badges := array_append(new_badges, 'well-regarded');
    end if;

    -- Gold Standard: received at least one Gold Star specifically.
    select count(*) into gold_stars_received_count
    from public.comment_awards ca
    join public.comments c on c.id = ca.comment_id
    where c.user_id = profile_record.id and ca.award_type = 'gold-star';

    if gold_stars_received_count >= 1 then
      new_badges := array_append(new_badges, 'gold-standard');
    end if;


    -- Merge additively: once earned, a badge stays earned even if the
    -- activity that earned it is later partially undone (see header).
    select array(
      select distinct b from unnest(old_badges || new_badges) as b order by b
    ) into final_badges;

    update public.profiles
    set badges = final_badges
    where id = profile_record.id;

    -- Notify only for badges that are newly present versus before this
    -- run (unchanged logic, now covering all 25 badges) — and only if a
    -- badge_earned notification with this exact title doesn't already
    -- exist for this user. That second check matters on this migration's
    -- first run specifically: several accounts (this app's own included)
    -- already have real badge_earned notifications for badges that
    -- profiles.badges never actually contained, from whatever produced
    -- those before this fix existed. Without the check, backfilling
    -- profiles.badges for the first time would read as "all of these are
    -- newly earned" and re-notify for every one of them.
    foreach added_badge in array new_badges loop
      if not (old_badges @> array[added_badge]) then
        notif_title := case added_badge
            when 'ultra-definitive' then '🎯 You earned Ultra-Definitive!'
            when 'decisive-streak' then '🔥 You earned Decisive Streak!'
            when 'super-decisive-streak' then '⚡ You earned Super Decisive Streak!'
            when 'civically-engaged' then '🗳️ You earned Civically Engaged!'
            when 'voice-of-the-people' then '🌍 You earned Voice of the People!'
            when 'conversationalist' then '💬 You earned Conversationalist!'
            when 'town-crier' then '📢 You earned Town Crier!'
            when 'conversation-starter' then '🗣️ You earned Conversation Starter!'
            when 'lightning-rod' then '⚡ You earned Lightning Rod!'
            when 'on-a-roll' then '🔥 You earned On a Roll!'
            when 'unstoppable' then '🌋 You earned Unstoppable!'
            when 'constant-as-the-sun' then '☀️ You earned Constant as the Sun!'
            when 'ripple-maker' then '🌊 You earned Ripple Maker!'
            when 'amplifier' then '🔊 You earned Amplifier!'
            when 'watchful-eye' then '🛡️ You earned Watchful Eye!'
            when 'guardian-of-truth' then '⚖️ You earned Guardian of Truth!'
            when 'founding-member' then '🏛️ You earned Founding Member!'
            when 'well-rounded' then '🧭 You earned Well-Rounded!'
            when 'open-minded' then '🔄 You earned Open Minded!'
            when 'first-responder' then '⏱️ You earned First Responder!'
            when 'diligent-researcher' then '📚 You earned Diligent Researcher!'
            when 'diligent-researcher-2' then '📖 You earned Master Researcher!'
            when 'party-starter' then '🎉 You earned Party Starter!'
            when 'award-giver' then '🎁 You earned Award-Giver!'
            when 'well-regarded' then '🏅 You earned Well-Regarded!'
            when 'gold-standard' then '🌟 You earned Gold Standard!'
            else 'You earned a new badge!'
          end;
        notif_body := case added_badge
            when 'ultra-definitive' then 'You''ve cast 100+ votes with less than 10% leaning. Your conviction is unmatched.'
            when 'decisive-streak' then 'You''ve cast 20 consecutive definitive yes/no votes. That''s real conviction.'
            when 'super-decisive-streak' then '50 consecutive definitive votes. You are in rare company.'
            when 'civically-engaged' then 'You''ve voted on 100 questions. Your voice is being heard.'
            when 'voice-of-the-people' then 'You''ve voted on 500 questions. Your reach is remarkable.'
            when 'conversationalist' then 'You''ve shared 50 comments or replies. You''re part of the conversation.'
            when 'town-crier' then 'You''ve shared 100 comments or replies. Your voice carries far.'
            when 'conversation-starter' then 'One of your comments has 10 direct replies. You started something.'
            when 'lightning-rod' then 'One of your comments has 50 direct replies. You really struck a nerve.'
            when 'on-a-roll' then 'You''ve kept a 7-day voting streak going.'
            when 'unstoppable' then 'You''ve kept a 30-day voting streak going.'
            when 'constant-as-the-sun' then 'You''ve kept a 100-day voting streak going. Reliable as sunrise.'
            when 'ripple-maker' then 'You''ve resonated with 20 different comments.'
            when 'amplifier' then 'You''ve resonated with 50 different comments.'
            when 'watchful-eye' then 'You''ve flagged 10 comments for review. Thanks for helping keep things honest.'
            when 'guardian-of-truth' then 'You''ve flagged 50 comments for review.'
            when 'founding-member' then 'You were one of the first 500 people to join senseUS.'
            when 'well-rounded' then 'You''ve voted in every domain on the platform.'
            when 'open-minded' then 'You''ve changed your mind on 10 different questions — genuine reconsideration.'
            when 'first-responder' then 'You''ve been among the first 10 voters on 10 different questions.'
            when 'diligent-researcher' then 'You''ve read the articles behind 10 questions.'
            when 'diligent-researcher-2' then 'You''ve read the articles behind 50 questions.'
            when 'party-starter' then 'You completed your first ?Party! -- nice work getting everyone to the finish line.'
            when 'award-giver' then 'You''ve given 25 Comment Awards. Thanks for recognizing good conversation.'
            when 'well-regarded' then 'Your comments have received 25 Comment Awards from other people.'
            when 'gold-standard' then 'Someone gave one of your comments a Gold Star -- the highest Comment Award there is.'
            else 'Keep voting to unlock more badges.'
          end;

        select exists(
          select 1 from public.notifications
          where user_id = profile_record.id
            and type = 'badge_earned'
            and title = notif_title
        ) into already_notified;

        if not already_notified then
          insert into public.notifications (user_id, type, priority, title, body, action_url)
          values (profile_record.id, 'badge_earned', 'high', notif_title, notif_body, '/profile');
        end if;
      end if;
    end loop;

  end loop;

  perform public.record_function_heartbeat('calculate_badges');
end;
$function$;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm RLS is on and self-award is blocked:
--    select public.give_comment_award('<your own comment id>', 'gold-star');
--    -> "You can't give an award to your own comment."
--
-- 2. Give someone else's comment an everyday award, confirm the balance
--    drops by 1:
--    select public.get_remaining_award_points(); -- note the value
--    select public.give_comment_award('<their comment id>', 'well-argued');
--    select public.get_remaining_award_points(); -- should be 1 less
--
-- 3. Give the SAME award type to the SAME comment again -> "You've
--    already given this award to this comment." A DIFFERENT award type on
--    the same comment should succeed.
--
-- 4. Spend down to 0, then try a Gold Star (cost 5) -> "Not enough awards
--    remaining this month."
--
-- 5. Manually backdate award_points_reset_month on your own profile to
--    last month, confirm the next give_comment_award() call refills to 5
--    before spending (and that a direct
--    `update profiles set award_points_remaining = 999` as yourself has
--    no effect, reverted by protect_admin_columns).
--
-- 6. get_conversation_comments() on a question with some awarded comments
--    -> award_counts is a jsonb object keyed by award_type with the right
--    distinct-giver counts; a never-awarded comment has award_counts =
--    null.
--
-- 7. get_comment_award_details() on an awarded comment returns one row
--    per award with a resolved display name, is_own true only for awards
--    the calling user actually gave.
--
-- 8. get_top_awarded_comments(5) as a non-admin -> "Unauthorized." As an
--    admin, returns the right comments ranked by award_count, with
--    gold_star_count correct and a deleted/self-removed comment excluded
--    even if it has awards.
--
-- 9. Run calculate_badges() after giving/receiving 25 awards and a Gold
--    Star on a test account -- award-giver/well-regarded/gold-standard
--    all appear in profiles.badges with matching notifications.
-- ============================================================
