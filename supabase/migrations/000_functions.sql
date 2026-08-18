-- senseUS Database Functions
-- Exported from Supabase on 2026-07-21
-- These functions represent the live state of the database logic
-- Any changes should be made here first, then applied to Supabase

-- ============================================================
-- INTEGRITY WEIGHT CALCULATION
-- Upward-only, never penalizes, all-time counts
-- Range: 1.0000 - 1.0050
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
  comment_counts as (
    select user_id, count(*) as comment_count
    from comments
    where is_deleted = false
    group by user_id
  ),
  new_weights as (
    select
      p.id,
      least(
        1.0000
        + case when coalesce(vc.vote_count, 0) >= 10 then 0.0005 else 0 end
        + case when coalesce(vc.vote_count, 0) >= 25 then 0.0010 else 0 end
        + case when coalesce(vc.vote_count, 0) >= 50 then 0.0020 else 0 end
        + case when coalesce(cc.comment_count, 0) >= 5 then 0.0005 else 0 end
        + case when coalesce(cc.comment_count, 0) >= 10 then 0.0005 else 0 end
        + case when coalesce(p.streak_days, 0) >= 7 then 0.0005 else 0 end,
        1.0050
      ) as calculated_weight
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

-- ============================================================
-- BADGE CALCULATION
-- Awards Ultra-Definitive, Decisive Streak, Super Decisive Streak
-- Creates high-priority notifications for new badges
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_badges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  profile_record record;
  total_votes int;
  leaning_votes int;
  leaning_pct float;
  consecutive_definitive int;
  max_consecutive int;
  vote_record record;
  new_badges text[];
  old_badges text[];
  added_badge text;
begin
  for profile_record in select id, badges from public.profiles loop
    new_badges := '{}';
    old_badges := profile_record.badges;

    select
      count(*),
      count(*) filter (where choice in ('ly', 'ln'))
    into total_votes, leaning_votes
    from public.votes
    where user_id = profile_record.id;

    if total_votes >= 100 then
      leaning_pct := leaning_votes::float / total_votes::float;
      if leaning_pct < 0.10 then
        new_badges := array_append(new_badges, 'ultra-definitive');
      end if;
    end if;

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

    update public.profiles
    set badges = new_badges
    where id = profile_record.id;

    foreach added_badge in array new_badges loop
      if not (old_badges @> array[added_badge]) then
        insert into public.notifications (user_id, type, priority, title, body, action_url)
        values (
          profile_record.id,
          'badge_earned',
          'high',
          case added_badge
            when 'ultra-definitive' then '🎯 You earned Ultra-Definitive!'
            when 'decisive-streak' then '🔥 You earned Decisive Streak!'
            when 'super-decisive-streak' then '⚡ You earned Super Decisive Streak!'
            else 'You earned a new badge!'
          end,
          case added_badge
            when 'ultra-definitive' then 'You''ve cast 100+ votes with less than 10% leaning. Your conviction is unmatched.'
            when 'decisive-streak' then 'You''ve cast 20 consecutive definitive yes/no votes. That''s real conviction.'
            when 'super-decisive-streak' then '50 consecutive definitive votes. You are in rare company.'
            else 'Keep voting to unlock more badges.'
          end,
          '/profile'
        );
      end if;
    end loop;

  end loop;
end;
$function$;

-- ============================================================
-- VOTE TALLY FUNCTIONS
-- Integrity-weighted: sums integrity_weight_at_vote per choice
-- Total is raw count of votes
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_vote_tally(p_question_id uuid)
 RETURNS TABLE(yes bigint, ly bigint, ln bigint, no bigint, total bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'yes'), 0))::bigint as yes,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'ly'), 0))::bigint as ly,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'ln'), 0))::bigint as ln,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'no'), 0))::bigint as no,
    count(*) as total
  from votes
  where question_id = p_question_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_vote_tallies_batch(p_question_ids uuid[])
 RETURNS TABLE(question_id uuid, yes bigint, ly bigint, ln bigint, no bigint, total bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    question_id,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'yes'), 0))::bigint as yes,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'ly'), 0))::bigint as ly,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'ln'), 0))::bigint as ln,
    round(coalesce(sum(integrity_weight_at_vote) filter (where choice = 'no'), 0))::bigint as no,
    count(*) as total
  from votes
  where question_id = any(p_question_ids)
  group by question_id;
$function$;

-- ============================================================
-- STREAK TRACKING
-- Updates streak_days and longest_streak on each vote
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_streak()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  last_vote_date date;
  today date := current_date;
  current_streak int;
  longest int;
begin
  select date(created_at) into last_vote_date
  from public.votes
  where user_id = NEW.user_id
    and id != NEW.id
  order by created_at desc
  limit 1;

  select streak_days, longest_streak
  into current_streak, longest
  from public.profiles
  where id = NEW.user_id;

  if last_vote_date is null then
    current_streak := 1;
  elsif last_vote_date = today then
    return NEW;
  elsif last_vote_date = today - interval '1 day' then
    current_streak := current_streak + 1;
  else
    current_streak := 1;
  end if;

  if current_streak > longest then
    longest := current_streak;
  end if;

  update public.profiles
  set
    streak_days = current_streak,
    longest_streak = longest
  where id = NEW.user_id;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_expired_streaks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update public.profiles
  set streak_days = 0
  where id in (
    select p.id
    from public.profiles p
    where p.streak_days > 0
    and not exists (
      select 1 from public.votes v
      where v.user_id = p.id
      and date(v.created_at) >= current_date - interval '1 day'
    )
  );
end;
$function$;

-- ============================================================
-- QUESTION SNAPSHOTS
-- Daily snapshot of vote tallies for trend analysis
-- Stores raw counts for full auditability
-- pct_yes + pct_no should always equal 100
-- yes_votes + ly_votes + ln_votes + no_votes should always equal total_votes
-- ============================================================

CREATE OR REPLACE FUNCTION public.take_question_snapshots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  q record;
  yes_count integer;
  ly_count integer;
  ln_count integer;
  no_count integer;
  total integer;
begin
  for q in select id from public.questions where published_at is not null loop
    select
      count(*) filter (where choice = 'yes'),
      count(*) filter (where choice = 'ly'),
      count(*) filter (where choice = 'ln'),
      count(*) filter (where choice = 'no')
    into yes_count, ly_count, ln_count, no_count
    from public.votes
    where question_id = q.id;

    total := yes_count + ly_count + ln_count + no_count;

    if total > 0 then
      insert into public.question_snapshots (
        question_id, pct_yes, pct_no, total_votes,
        yes_votes, ly_votes, ln_votes, no_votes, snapshot_date
      ) values (
        q.id,
        round(((yes_count + ly_count)::numeric / total) * 100),
        round(((ln_count + no_count)::numeric / total) * 100),
        total, yes_count, ly_count, ln_count, no_count, current_date
      )
      on conflict (question_id, snapshot_date) 
      do update set
        pct_yes = excluded.pct_yes,
        pct_no = excluded.pct_no,
        total_votes = excluded.total_votes,
        yes_votes = excluded.yes_votes,
        ly_votes = excluded.ly_votes,
        ln_votes = excluded.ln_votes,
        no_votes = excluded.no_votes;
    end if;
  end loop;
end;
$function$;

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_answers_count(user_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update public.profiles
  set answers_count = answers_count + 1
  where id = user_id;
$function$;

CREATE OR REPLACE FUNCTION public.increment_flag_count(comment_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update public.comments
  set 
    flag_count = flag_count + 1,
    is_flagged = true
  where id = comment_id;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if auth.role() != 'service_role' then
    new.is_admin := old.is_admin;
    new.integrity_weight := old.integrity_weight;
  end if;
  return new;
end;
$function$;

-- ============================================================
-- COMMENT MODERATION
-- Database-level banned word enforcement
-- ============================================================

CREATE OR REPLACE FUNCTION public.moderate_comment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  banned_words text[] := array['nigger','nigga','faggot','fag','kike','spic','chink','gook',
    'wetback','towelhead','raghead','tranny','retard','retarded','cunt','motherfucker','motherfucking',
    'pedophile','pedo','pedofile'];
  review_words text[] := array['fuck','fucking','shit','bitch','asshole','bastard','dick',
    'pussy','cock','whore','slut','damn','ass','crap','piss','hell','idiot','moron','stupid',
    'dumb','loser','freak'];
  normalized text;
  w text;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if new.body is null or length(trim(new.body)) = 0 then
    raise exception 'Comment cannot be empty.';
  end if;

  if length(trim(new.body)) < 2 then
    raise exception 'Comment is too short.';
  end if;

  if length(new.body) > 1000 then
    raise exception 'Comment must be under 1000 characters.';
  end if;

  normalized := lower(regexp_replace(new.body, '[^a-z0-9\s]', '', 'g'));
  normalized := trim(regexp_replace(normalized, '\s+', ' ', 'g'));

  foreach w in array banned_words loop
    if normalized like '%' || w || '%' then
      raise exception 'Your comment contains language that isn''t allowed on senseUS. Please revise and try again.';
    end if;
  end loop;

  new.is_flagged := false;
  foreach w in array review_words loop
    if normalized like '%' || w || '%' then
      new.is_flagged := true;
      exit;
    end if;
  end loop;

  return new;
end;
$function$;

-- ============================================================
-- ANOMALY DETECTION & ALERTING
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_anomaly_only(p_alert_type text, p_severity text, p_details jsonb, p_related_question_id uuid DEFAULT NULL::uuid, p_related_country text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into anomaly_log (alert_type, severity, details, related_question_id, related_country, email_sent)
  values (p_alert_type, p_severity, p_details, p_related_question_id, p_related_country, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.call_alert_function(p_alert_type text, p_severity text, p_message text, p_details jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_role_key text;
  function_url text := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-alert-email';
begin
  select decrypted_secret into service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  insert into anomaly_log (alert_type, severity, details, email_sent)
  values (p_alert_type, p_severity, p_details, true);

  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object(
      'alertType', p_alert_type,
      'severity', p_severity,
      'message', p_message,
      'details', p_details
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_registration_spike()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  recent_count int;
  already_alerted boolean;
begin
  select count(*) into recent_count
  from profiles
  where created_at > now() - interval '24 hours';

  select exists(
    select 1 from anomaly_log
    where alert_type = 'registration_spike'
    and triggered_at > now() - interval '1 hour'
  ) into already_alerted;

  if recent_count > 100 and not already_alerted then
    perform log_anomaly_only(
      'registration_spike',
      'warning',
      jsonb_build_object('count', recent_count, 'window', '24h')
    );
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_coordinated_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  country_count int;
  already_alerted boolean;
begin
  if NEW.country_code is null then
    return NEW;
  end if;

  select count(*) into country_count
  from profiles
  where country_code = NEW.country_code
  and created_at > now() - interval '1 hour';

  select exists(
    select 1 from anomaly_log
    where alert_type = 'coordinated_signup'
    and related_country = NEW.country_code
    and triggered_at > now() - interval '1 hour'
  ) into already_alerted;

  if country_count > 20 and not already_alerted then
    perform log_anomaly_only(
      'coordinated_signup',
      'warning',
      jsonb_build_object('count', country_count, 'country', NEW.country_code, 'window', '1h'),
      null,
      NEW.country_code
    );
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_vote_manipulation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  change_count int;
  already_alerted boolean;
  q_text text;
  v_request_id bigint;
begin
  select count(*) into change_count
  from vote_changes
  where question_id = NEW.question_id
  and changed_at > now() - interval '1 hour';

  select exists(
    select 1 from anomaly_log
    where alert_type = 'vote_manipulation'
    and related_question_id = NEW.question_id
    and triggered_at > now() - interval '1 hour'
  ) into already_alerted;

  if change_count > 50 and not already_alerted then
    select text into q_text from questions where id = NEW.question_id;

    select net.http_post(
      url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-alert-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object(
        'alertType', 'vote_manipulation',
        'severity', 'critical',
        'message', format('More than 50 vote changes detected on one question in the last hour (%s changes).', change_count),
        'details', jsonb_build_object('question', q_text, 'changeCount', change_count)
      )
    ) into v_request_id;

    insert into anomaly_log (alert_type, severity, details, related_question_id, email_sent, request_id)
    values (
      'vote_manipulation',
      'critical',
      jsonb_build_object('count', change_count, 'window', '1h', 'question', q_text),
      NEW.question_id,
      false,
      v_request_id
    );
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_flagged_question()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.human_moderation_required = true and (OLD.human_moderation_required is distinct from true) then
    perform log_anomaly_only(
      'flagged_question',
      'warning',
      jsonb_build_object('question', NEW.text),
      NEW.id
    );
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_new_transparency_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform log_anomaly_only(
    'transparency_event',
    'warning',
    jsonb_build_object('eventType', NEW.event_type)
  );

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_pending_alert_emails()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update anomaly_log a
  set email_sent = true,
      email_sent_at = now()
  from net._http_response r
  where a.request_id = r.id
  and a.email_sent = false
  and r.status_code between 200 and 299
  and a.triggered_at > now() - interval '1 hour';
end;
$function$;