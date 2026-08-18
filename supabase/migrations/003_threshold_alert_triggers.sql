-- migration: 003_threshold_alert_triggers.sql
--
-- Four triggers, one per threshold condition in the spec. Each writes to
-- anomaly_log and calls send-alert-email via pg_net.
--
-- SCHEMA — confirmed against live database:
--   - profiles: id, created_at, country_code
--   - vote_changes: id, question_id, changed_at
--   - questions: id, question_text, human_moderation_required (boolean)
--   - transparency_events: id, event_type, created_at
--
-- Requires the service_role_key to already be in Vault (see 002_schedule_reports.sql).

create or replace function call_alert_function(
  p_alert_type text,
  p_severity text,
  p_message text,
  p_details jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ============================================================
-- 1. Registration spike: >100 new registrations in a 24h window
-- ============================================================
create or replace function check_registration_spike()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count int;
  already_alerted boolean;
begin
  select count(*) into recent_count
  from profiles
  where created_at > now() - interval '24 hours';

  -- Avoid duplicate alerts: skip if we already alerted on this in the last hour
  select exists(
    select 1 from anomaly_log
    where alert_type = 'registration_spike'
    and triggered_at > now() - interval '1 hour'
  ) into already_alerted;

  if recent_count > 100 and not already_alerted then
    perform call_alert_function(
      'registration_spike',
      'warning',
      format('New registrations have exceeded 100 in the last 24 hours (%s total).', recent_count),
      jsonb_build_object('count', recent_count, 'window', '24h')
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_registration_spike_check on profiles;
create trigger on_registration_spike_check
  after insert on profiles
  for each row
  execute function check_registration_spike();

-- ============================================================
-- 2. Vote manipulation: >50 vote changes on one question in 1 hour
-- ============================================================
create or replace function check_vote_manipulation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  change_count int;
  already_alerted boolean;
  q_text text;
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

    insert into anomaly_log (alert_type, severity, details, related_question_id, email_sent)
    values (
      'vote_manipulation',
      'critical',
      jsonb_build_object('count', change_count, 'window', '1h', 'question', q_text),
      NEW.question_id,
      true
    );

    perform net.http_post(
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
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_vote_manipulation_check on vote_changes;
create trigger on_vote_manipulation_check
  after insert on vote_changes
  for each row
  execute function check_vote_manipulation();

-- ============================================================
-- 3. Coordinated signup: >20 new accounts from same country in 1 hour
-- ============================================================
create or replace function check_coordinated_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    insert into anomaly_log (alert_type, severity, details, related_country, email_sent)
    values (
      'coordinated_signup',
      'warning',
      jsonb_build_object('count', country_count, 'country', NEW.country_code, 'window', '1h'),
      NEW.country_code,
      true
    );

    perform net.http_post(
      url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-alert-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object(
        'alertType', 'coordinated_signup',
        'severity', 'warning',
        'message', format('More than 20 new accounts from %s in the last hour (%s accounts).', NEW.country_code, country_count),
        'details', jsonb_build_object('country', NEW.country_code, 'count', country_count)
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_coordinated_signup_check on profiles;
create trigger on_coordinated_signup_check
  after insert on profiles
  for each row
  execute function check_coordinated_signup();

-- ============================================================
-- 4a. Question flagged for human moderation (instant)
-- ============================================================
create or replace function check_flagged_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.human_moderation_required = true and (OLD.human_moderation_required is distinct from true) then
    insert into anomaly_log (alert_type, severity, details, related_question_id, email_sent)
    values (
      'flagged_question',
      'warning',
      jsonb_build_object('question', NEW.text),
      NEW.id,
      true
    );

    perform net.http_post(
      url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-alert-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object(
        'alertType', 'flagged_question',
        'severity', 'warning',
        'message', format('A question has been flagged for human review: "%s"', NEW.text),
        'details', jsonb_build_object('questionId', NEW.id)
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_flagged_question_check on questions;
create trigger on_flagged_question_check
  after update on questions
  for each row
  execute function check_flagged_question();

-- ============================================================
-- 4b. New transparency event added (instant)
-- ============================================================
create or replace function check_new_transparency_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into anomaly_log (alert_type, severity, details, email_sent)
  values (
    'transparency_event',
    'warning',
    jsonb_build_object('eventType', NEW.event_type),
    true
  );

  perform net.http_post(
    url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-alert-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object(
      'alertType', 'transparency_event',
      'severity', 'warning',
      'message', format('A new transparency event was added: %s', NEW.event_type),
      'details', jsonb_build_object('eventType', NEW.event_type)
    )
  );

  return NEW;
end;
$$;

drop trigger if exists on_new_transparency_event on transparency_events;
create trigger on_new_transparency_event
  after insert on transparency_events
  for each row
  execute function check_new_transparency_event();
