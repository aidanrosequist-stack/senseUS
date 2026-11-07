-- senseUS: notify a comment's owner when it receives a Comment Award
-- (Aidan, 2026-11-02, same conversation as 105/106: "should we have the
-- system notify the user when one of their comments is awarded?").
--
-- Fires for every award, positive AND negative alike -- Aidan's explicit
-- call (AskUserQuestion), consistent with his earlier call to show
-- attribution on every award type alike rather than anonymizing negative
-- ones. Not batched/milestone-style: every individual give_comment_award()
-- success inserts one notification, same granularity as 090's
-- comparison_accepted and 095's party_joined/party_completed. This is
-- intentionally NOT symmetric with calculate_badges()'s own choice to
-- skip a badge for receiving Needs Work (a badge is a passive profile
-- stat; a notification is an active ping, and the whole point here is
-- letting someone know right away regardless of polarity) -- flagging in
-- case a viral comment picking up awards from many distinct givers in one
-- month turns out to be noisier in practice than expected, since nothing
-- here batches multiple awards into one notification the way a true
-- "milestone" type would.
--
-- Three parts:
--
-- 1. notifications.type's CHECK constraint gets a new allowed value,
--    'comment_awarded' -- same reasoning as 090's own addition of
--    'comparison_accepted': none of the existing values fit without being
--    misleading in someone's history.
--
-- 2. notification_preferences gets a new column, push_comment_award,
--    default true -- matches 075/090/095's own exact precedent: this is
--    forward-looking data for a real push-sending step that doesn't exist
--    yet (see notification-preferences design doc), NOT a gate on today's
--    in-app notifications row. The insert below never checks it, same as
--    every other notification insert point in this schema so far.
--
-- 3. give_comment_award() (full body carried forward verbatim from
--    migration 105 -- confirmed via grep that 106 only touched
--    award_types rows, not this function) now inserts a notification for
--    the comment's owner right after the award row itself, inside the
--    same transaction -- if either write fails, neither happens.
--
--    Award labels aren't stored in the database (award_types only has
--    id/cost/is_negative/sort_order -- label/description live in the
--    frontend's src/lib/awardInfo.js, the single source of truth for
--    display text). The CASE below duplicates just the 12 labels so the
--    notification title can name the award -- same kind of accepted
--    duplication as getDisplayName()'s three hand-synced copies (noted in
--    090's own header). Keep this CASE in sync with awardInfo.js's
--    AWARD_CATALOG `label` field whenever an award is renamed or a new
--    one added (106 added two; this migration's CASE already includes
--    both).
--
--    action_url follows shareComment()'s own existing link format
--    (Conversation.jsx) of `/conversation/:questionId#comment-:commentId`
--    -- note Conversation.jsx doesn't actually scroll to that hash on
--    load yet (confirmed by grep: shareComment() is the only place that
--    string appears in the file), so today this just opens the right
--    conversation, not scrolled to the exact comment. Pre-existing gap,
--    not something this migration fixes.
-- ============================================================

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'badge_earned'::text,
    'new_tracking_question'::text,
    'system_message'::text,
    'milestone'::text,
    'admin_broadcast'::text,
    'welcome'::text,
    'urgent'::text,
    'breaking_question'::text,
    'comparison_accepted'::text,
    'party_joined'::text,
    'party_completed'::text,
    'comment_awarded'::text
  ]));

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_comment_award boolean NOT NULL DEFAULT true;

-- ---------- give_comment_award(): notify the comment owner on every award ----------

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
  v_question_id uuid;
  v_current_month date := date_trunc('month', now())::date;
  v_remaining smallint;
  v_giver_name text;
  v_award_label text;
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

  select user_id, question_id into v_comment_owner, v_question_id
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

  -- NEW (107): let the comment's owner know, every award, either
  -- polarity -- see this migration's header for why. Display-name
  -- handling mirrors 090/095's own inline case exactly (anon -> anon_name,
  -- first_only -> first_name, else first + last initial).
  select
    case
      when p.display_preference = 'anon' then coalesce(p.anon_name, 'Someone')
      when p.display_preference = 'first_only' then coalesce(p.first_name, 'Someone')
      else coalesce(p.first_name || ' ' || p.last_initial || '.', 'Someone')
    end
  into v_giver_name
  from public.profiles p
  where p.id = v_user_id;

  v_award_label := case p_award_type
    when 'gold-star' then 'Gold Star'
    when 'needs-work' then 'Needs Work'
    when 'well-argued' then 'Well-Argued'
    when 'changed-my-mind' then 'Changed My Mind'
    when 'brought-receipts' then 'Brought Receipts'
    when 'made-me-laugh' then 'Made Me Laugh'
    when 'fair-and-balanced' then 'Fair & Balanced'
    when 'good-faith-disagreement' then 'Good-Faith Disagreement'
    when 'taught-me-something' then 'Taught Me Something'
    when 'needs-a-source' then 'Needs a Source'
    when 'off-topic' then 'Off-Topic'
    when 'spelling-grammar' then 'Spelling & Grammar'
    else p_award_type
  end;

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  values (
    v_comment_owner,
    'comment_awarded',
    'normal',
    '🏷️ ' || v_giver_name || ' gave your comment "' || v_award_label || '"',
    'See it on your comment.',
    '/conversation/' || v_question_id || '#comment-' || p_comment_id
  );

  return v_remaining;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.give_comment_award(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.give_comment_award(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.give_comment_award(uuid, text) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('give_comment_award', 'Client RPC (Conversation.jsx) -- the only write path onto comment_awards. SECURITY DEFINER so it can atomically check/spend a user''s shared monthly award-points balance (profiles.award_points_remaining, otherwise locked by protect_admin_columns) and insert the award row in one transaction. Blocks self-awarding and duplicate (giver, comment, award_type). Migration 105 (2026-11-02). Migration 107 (2026-11-02) added: a comment_awarded notification to the comment owner on every successful award, either polarity.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Constraint accepts the new value:
--    insert into notifications (user_id, type, priority, title, body)
--    values ('<a real user id>', 'comment_awarded', 'normal', 'test', 'test');
--    -> succeeds. delete it again afterward.
--
-- 2. As account A, give account B's comment a positive everyday award
--    (select give_comment_award('<B''s comment id>', 'well-argued')).
--    As account B: select * from notifications where user_id = '<B''s id>'
--    order by created_at desc limit 1;
--    -> type = 'comment_awarded', title names A (or A's anon_name/
--    first-only per A's own display_preference), action_url is
--    /conversation/<the real question id>#comment-<the comment id>.
--
-- 3. Repeat with a negative award (e.g. 'off-topic') -> notification
--    still fires, same shape, title still just names the award
--    ("Off-Topic") with no extra framing.
--
-- 4. select push_comment_award from notification_preferences where
--    user_id = '<any real user id>'; -> true (new column, default on,
--    backfilled for every existing row by ADD COLUMN ... DEFAULT true).
-- ============================================================
