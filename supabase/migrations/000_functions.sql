-- ============================================
-- senseUS Database Functions
-- Exported from Supabase (live) on 2026-08-05
-- ============================================
-- This file is a snapshot of every function in the public schema,
-- pulled directly from the live database via pg_get_functiondef().
-- It exists for reference and for the pre-launch checksum-comparison
-- gate item — it is not itself run against the database.
--
-- Prior export (2026-07-21) had drifted from production in three ways,
-- corrected in this export:
--   1. take_question_snapshots() was still on the pre-fix version here
--      (independently-rounded pct_yes/pct_no, which could sum to 101).
--      This turned out to be a real production bug, not just a stale
--      file — the 2026-07-27 fix documented in AUDIT_NOTES.md had never
--      actually shipped. Fixed live and re-exported here on 2026-08-05.
--   2. Missing the VOIP-probation logic in calculate_all_integrity_weights
--      (migration 010).
--   3. Missing the full-column lock in protect_admin_columns
--      (migration 011).
-- ============================================

-- ============================================
-- activate_sponsored_question
-- ============================================
CREATE OR REPLACE FUNCTION public.activate_sponsored_question(p_sponsored_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_question_id uuid;
  v_sponsor_name text;
  v_domain text;
  v_duration_days integer;
  v_live_political_count integer;
begin
  select sq.question_id, sq.sponsor_name, sq.duration_days, q.domain
  into v_question_id, v_sponsor_name, v_duration_days, v_domain
  from sponsored_questions sq
  join questions q on q.id = sq.question_id
  where sq.id = p_sponsored_id;

  if v_domain = 'politics & policy' then
    select count(*) into v_live_political_count
    from sponsored_questions sq2
    join questions q2 on q2.id = sq2.question_id
    where q2.domain = 'politics & policy' and sq2.status = 'live';

    if v_live_political_count >= 2 then
      raise exception 'Both political sponsorship slots are currently full.';
    end if;

    if exists (
      select 1 from sponsored_questions sq3
      join questions q3 on q3.id = sq3.question_id
      where sq3.sponsor_name = v_sponsor_name
        and q3.domain = 'politics & policy'
        and sq3.archived_at is not null
        and sq3.archived_at > now() - interval '90 days'
    ) then
      raise exception 'This sponsor is in cooldown and cannot activate another political sponsorship yet.';
    end if;

    if exists (
      select 1 from sponsored_questions sq4
      join questions q4 on q4.id = sq4.question_id
      where sq4.sponsor_name = v_sponsor_name
        and q4.domain = 'politics & policy'
        and sq4.status = 'live'
    ) then
      raise exception 'This sponsor already has a live political sponsorship.';
    end if;
  end if;

  update sponsored_questions
  set status = 'live', live_at = now()
  where id = p_sponsored_id;

  update questions
  set is_sponsored = true,
      sponsor_id = p_sponsored_id,
      published_at = coalesce(published_at, now()),
      archive_at = now() + (v_duration_days || ' days')::interval
  where id = v_question_id;
end;
$function$
;

-- ============================================
-- archive_due_questions
-- ============================================
CREATE OR REPLACE FUNCTION public.archive_due_questions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  archived_count integer;
begin
  update questions
  set archived_at = now()
  where archive_at is not null
    and archive_at <= now()
    and archived_at is null;

  get diagnostics archived_count = row_count;

  update sponsored_questions sq
  set archived_at = now(), status = 'archived'
  from questions q
  where q.id = sq.question_id
    and q.archived_at is not null
    and sq.status = 'live'
    and sq.archived_at is null;

  return archived_count;
end;
$function$
;

-- ============================================
-- block_archived_question_votes
-- ============================================
CREATE OR REPLACE FUNCTION public.block_archived_question_votes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if exists (select 1 from questions where id = new.question_id and archived_at is not null) then
    raise exception 'Voting is closed for this question — it has been archived.';
  end if;
  return new;
end;
$function$
;

-- ============================================
-- calculate_all_integrity_weights
-- ============================================
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
$function$
;

-- ============================================
-- calculate_badges
-- ============================================
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

    -- Count total votes and leaning votes
    select
      count(*),
      count(*) filter (where choice in ('ly', 'ln'))
    into total_votes, leaning_votes
    from public.votes
    where user_id = profile_record.id;

    -- Ultra-Definitive: 100+ votes, less than 10% leaning
    if total_votes >= 100 then
      leaning_pct := leaning_votes::float / total_votes::float;
      if leaning_pct < 0.10 then
        new_badges := array_append(new_badges, 'ultra-definitive');
      end if;
    end if;

    -- Calculate max consecutive definitive votes
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

    -- Decisive Streak: 20 consecutive definitive votes
    if max_consecutive >= 20 then
      new_badges := array_append(new_badges, 'decisive-streak');
    end if;

    -- Super Decisive Streak: 50 consecutive definitive votes
    if max_consecutive >= 50 then
      new_badges := array_append(new_badges, 'super-decisive-streak');
    end if;

    -- Update badges on profile
    update public.profiles
    set badges = new_badges
    where id = profile_record.id;

    -- Create notifications for newly earned badges
    foreach added_badge in array new_badges loop
      if not (old_badges @> array[added_badge]) then
        -- This badge is new -- create a notification
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
$function$
;

-- ============================================
-- call_alert_function
-- ============================================
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
$function$
;

-- ============================================
-- check_coordinated_signup
-- ============================================
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
$function$
;

-- ============================================
-- check_flagged_question
-- ============================================
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
$function$
;

-- ============================================
-- check_new_transparency_event
-- ============================================
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
$function$
;

-- ============================================
-- check_pending_alert_emails
-- ============================================
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
$function$
;

-- ============================================
-- check_registration_spike
-- ============================================
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
$function$
;

-- ============================================
-- check_vote_manipulation
-- ============================================
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
$function$
;

-- ============================================
-- get_vote_tallies_batch
-- ============================================
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
$function$
;

-- ============================================
-- get_vote_tally
-- ============================================
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
$function$
;

-- ============================================
-- handle_updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

-- ============================================
-- increment_answers_count
-- ============================================
CREATE OR REPLACE FUNCTION public.increment_answers_count(user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or auth.uid() != user_id then
    raise exception 'Unauthorized: you can only increment your own answers_count.';
  end if;

  update public.profiles
  set answers_count = answers_count + 1
  where id = user_id;
end;
$function$
;

-- ============================================
-- increment_flag_count
-- ============================================
CREATE OR REPLACE FUNCTION public.increment_flag_count(comment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  if not exists (
    select 1 from public.comment_flags cf
    where cf.comment_id = increment_flag_count.comment_id
      and cf.user_id = auth.uid()
  ) then
    raise exception 'You must flag this comment before its count can be incremented.';
  end if;

  update public.comments c
  set flag_count = c.flag_count + 1,
      is_flagged = true
  where c.id = increment_flag_count.comment_id;
end;
$function$
;

-- ============================================
-- log_anomaly_only
-- ============================================
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
$function$
;

-- ============================================
-- log_vote_change
-- ============================================
CREATE OR REPLACE FUNCTION public.log_vote_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into vote_changes (question_id, user_id, previous_choice, new_choice, changed_at)
  values (new.question_id, new.user_id, old.choice, new.choice, now());
  new.change_count := coalesce(old.change_count, 0) + 1;
  return new;
end;
$function$
;

-- ============================================
-- moderate_comment
-- ============================================
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
  -- Only re-run the moderation check when the actual comment text changes.
  -- Without this, any update at all (like an admin clearing a flag) would
  -- silently re-flag the comment right back based on its unchanged text.
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
$function$
;

-- ============================================
-- protect_admin_columns
-- ============================================
CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if auth.role() != 'service_role' then
    new.is_admin := old.is_admin;
    new.integrity_weight := old.integrity_weight;
    new.answers_count := old.answers_count;
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
  return new;
end;
$function$
;

-- ============================================
-- require_recovery_email_for_export
-- ============================================
CREATE OR REPLACE FUNCTION public.require_recovery_email_for_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_email boolean;
begin
  select (recovery_email is not null and recovery_email != '')
  into has_email
  from public.profiles
  where id = new.user_id;

  if not coalesce(has_email, false) then
    raise exception 'A recovery email is required before requesting a data export. Add one in Settings first.';
  end if;

  return new;
end;
$function$
;

-- ============================================
-- reset_expired_streaks
-- ============================================
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
$function$
;

-- ============================================
-- run_integrity_checks
-- ============================================
CREATE OR REPLACE FUNCTION public.run_integrity_checks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  answers_count_issues integer;
  invalid_choices integer;
  duplicate_votes integer;
  pct_sum_issues integer;
  orphaned_changes integer;
  issues_found boolean := false;
begin
  -- 1. answers_count mismatch
  select count(*) into answers_count_issues
  from (
    select p.id
    from profiles p
    left join votes v on v.user_id = p.id
    group by p.id, p.answers_count
    having p.answers_count != count(v.id)
  ) t;

  -- 2. Invalid choice values
  select count(*) into invalid_choices
  from votes
  where choice not in ('yes', 'ly', 'ln', 'no', 'dec');

  -- 3. Duplicate votes
  select count(*) into duplicate_votes
  from (
    select user_id, question_id
    from votes
    group by user_id, question_id
    having count(*) > 1
  ) t;

  -- 4. pct_yes + pct_no != 100
  select count(*) into pct_sum_issues
  from votes
  where pct_yes_at_vote is not null
  and pct_no_at_vote is not null
  and pct_yes_at_vote + pct_no_at_vote != 100;

  -- 5. Orphaned vote_changes
  select count(*) into orphaned_changes
  from vote_changes vc
  left join votes v on v.user_id = vc.user_id and v.question_id = vc.question_id
  where v.id is null;

  -- Log anomaly if any issues found
  if answers_count_issues > 0 then
    issues_found := true;
    perform log_anomaly_only(
      'integrity_check_failed',
      'critical',
      jsonb_build_object(
        'check', 'answers_count_mismatch',
        'affected_rows', answers_count_issues
      )
    );
  end if;

  if invalid_choices > 0 then
    issues_found := true;
    perform log_anomaly_only(
      'integrity_check_failed',
      'critical',
      jsonb_build_object(
        'check', 'invalid_choice_values',
        'affected_rows', invalid_choices
      )
    );
  end if;

  if duplicate_votes > 0 then
    issues_found := true;
    perform log_anomaly_only(
      'integrity_check_failed',
      'critical',
      jsonb_build_object(
        'check', 'duplicate_votes',
        'affected_rows', duplicate_votes
      )
    );
  end if;

  if pct_sum_issues > 0 then
    issues_found := true;
    perform log_anomaly_only(
      'integrity_check_failed',
      'critical',
      jsonb_build_object(
        'check', 'pct_sum_not_100',
        'affected_rows', pct_sum_issues
      )
    );
  end if;

  if orphaned_changes > 0 then
    issues_found := true;
    perform log_anomaly_only(
      'integrity_check_failed',
      'critical',
      jsonb_build_object(
        'check', 'orphaned_vote_changes',
        'affected_rows', orphaned_changes
      )
    );
  end if;

end;
$function$
;

-- ============================================
-- secure_vote_fields
-- ============================================
CREATE OR REPLACE FUNCTION public.secure_vote_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_weight numeric;
  yes_side numeric;
  no_side numeric;
  total numeric;
begin
  if new.choice not in ('yes','ly','ln','no','dec') then
    raise exception 'Invalid vote choice.';
  end if;

  -- integrity_weight_at_vote is set from the server only, at first
  -- vote, from the voter's own current weight. Changing a vote never
  -- updates it — documented behavior, see AUDIT_NOTES.md. The client
  -- has no influence over this value at all now.
  if tg_op = 'INSERT' then
    select integrity_weight into current_weight
    from public.profiles
    where id = new.user_id;

    new.integrity_weight_at_vote := coalesce(current_weight, 1.0000);
  else
    new.integrity_weight_at_vote := old.integrity_weight_at_vote;
  end if;

  -- pct_yes_at_vote / pct_no_at_vote are recomputed server-side from
  -- the live weighted tally (excluding this row itself) — never
  -- trusted from the client. Matches the canonical weighted-over-
  -- weighted formula documented in AUDIT_NOTES.md.
  select
    coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes','ly')), 0),
    coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice in ('ln','no')), 0)
  into yes_side, no_side
  from public.votes v
  where v.question_id = new.question_id
    and v.id is distinct from new.id;

  total := yes_side + no_side;

  if total > 0 then
    new.pct_yes_at_vote := round((yes_side / total) * 100);
    new.pct_no_at_vote := 100 - new.pct_yes_at_vote;
  else
    new.pct_yes_at_vote := null;
    new.pct_no_at_vote := null;
  end if;

  return new;
end;
$function$
;

-- ============================================
-- take_question_snapshots
-- ============================================
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
  computed_pct_yes integer;
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
      computed_pct_yes := round(((yes_count + ly_count)::numeric / total) * 100);

      insert into public.question_snapshots (
        question_id, pct_yes, pct_no, total_votes,
        yes_votes, ly_votes, ln_votes, no_votes, snapshot_date
      ) values (
        q.id, computed_pct_yes, 100 - computed_pct_yes, total,
        yes_count, ly_count, ln_count, no_count, current_date
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
$function$
;

-- ============================================
-- update_streak
-- ============================================
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
  -- Get the date of the user's previous most recent vote (excluding current)
  select date(created_at) into last_vote_date
  from public.votes
  where user_id = NEW.user_id
    and id != NEW.id
  order by created_at desc
  limit 1;

  -- Get current streak and longest streak
  select streak_days, longest_streak
  into current_streak, longest
  from public.profiles
  where id = NEW.user_id;

  if last_vote_date is null then
    -- First ever vote
    current_streak := 1;
  elsif last_vote_date = today then
    -- Already voted today, no change
    return NEW;
  elsif last_vote_date = today - interval '1 day' then
    -- Voted yesterday, increment streak
    current_streak := current_streak + 1;
  else
    -- Missed a day, reset streak
    current_streak := 1;
  end if;

  -- Update longest streak if needed
  if current_streak > longest then
    longest := current_streak;
  end if;

  -- Update profile
  update public.profiles
  set
    streak_days = current_streak,
    longest_streak = longest
  where id = NEW.user_id;

  return NEW;
end;
$function$
;
