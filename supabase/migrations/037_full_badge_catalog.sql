-- senseUS: implement the full badge catalog in calculate_badges().
--
-- BACKGROUND: src/lib/badgeInfo.js defines 22 badges as "the single
-- source of truth for badge labels, descriptions, and emojis." But
-- calculate_badges() (public.calculate_badges, the only function that
-- ever writes profiles.badges or inserts a badge_earned notification)
-- has only ever computed 3 of them: ultra-definitive, decisive-streak,
-- and super-decisive-streak — confirmed by reading every version of this
-- function across migration history (000_functions.sql through
-- 033_function_heartbeats.sql), all three identical on this point. The
-- other 19 badges — including civically-engaged, conversationalist,
-- founding-member, well-rounded, open-minded, and first-responder, the
-- six that already have real badge_earned notifications sitting on a
-- live account — have never had any server-side award logic at all, so
-- profiles.badges never actually contains them and the Profile page's
-- Badges widget (which reads profiles.badges) shows "keep voting to earn
-- your first badge" no matter how earned those six notifications look.
--
-- This migration implements the remaining 19 using tables that already
-- exist for exactly this purpose (article_views, comment_flags,
-- comment_resonances, vote_changes, profiles.longest_streak), with
-- notification title/body text matching badgeInfo.js's own label and
-- description for each, so the notification a user gets matches what
-- the Badges widget will show them from then on.
--
-- SECOND FIX, same migration: badges are now accumulated additively
-- (union of old_badges and newly-qualifying badges) instead of being
-- fully recomputed and overwritten every run. The old overwrite pattern
-- was harmless for the original 3 badges because their criteria are
-- historical maximums that can only ever stay true once true. Several of
-- the newly-added badges don't have that property — ripple-maker/
-- amplifier count *current* resonate rows, watchful-eye/guardian-of-truth
-- count *current* flag rows, and both comment_resonances and
-- comment_flags rows get hard-deleted on un-resonate/un-flag (confirmed
-- in src/pages/Conversation.jsx). Under the old overwrite pattern, a
-- user could earn ripple-maker, later un-resonate a few comments, and
-- silently lose the badge on the next run — badges are meant to be
-- permanent achievements (that's the whole premise of a notification
-- saying "you earned..."), not a live status, so this migration makes
-- that true for all 22, not just the 3 that happened to be safe before.
--
-- Nothing else about this function changes: grants (migrations 008, 014)
-- and search_path (migration 026) apply to the function itself, not its
-- body, so they're untouched.
-- ============================================================

create or replace function public.calculate_badges()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

    -- Merge additively: once earned, a badge stays earned even if the
    -- activity that earned it is later partially undone (see header).
    select array(
      select distinct b from unnest(old_badges || new_badges) as b order by b
    ) into final_badges;

    update public.profiles
    set badges = final_badges
    where id = profile_record.id;

    -- Notify only for badges that are newly present versus before this
    -- run (unchanged logic, now covering all 22 badges) — and only if a
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

-- Grants/schedule unchanged — CREATE OR REPLACE above only changes the
-- function body.


-- ============================================================
-- One-time verification (run manually after this migration is applied):
--
-- select public.calculate_badges();
-- select badges from public.profiles where id = auth.uid(); -- as yourself, or via service role for any user
-- select title, body, created_at from public.notifications
--   where type = 'badge_earned' order by created_at desc limit 10;
-- ============================================================
