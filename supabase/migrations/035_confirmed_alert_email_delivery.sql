-- senseUS: make anomaly_log.email_sent mean what it says
--
-- BACKGROUND (found while investigating an open question from the
-- 2026-08-22 hardening pass — whether anomaly_log.request_id was a real
-- column or a bug):
--
-- check_pending_alert_emails() runs every 5 minutes and reconciles
-- anomaly_log.email_sent from the async pg_net response, matching on
-- anomaly_log.request_id = net._http_response.id. That mechanism was
-- correct in principle, but tracing the full migration history in order
-- showed it has been dead since 003_threshold_alert_triggers.sql:
--
--   - 000_functions.sql's original check_vote_manipulation() was the
--     only place that ever captured request_id and inserted with
--     email_sent = false, deferring confirmation to
--     check_pending_alert_emails().
--   - 003_threshold_alert_triggers.sql runs after 000 and replaces
--     check_vote_manipulation() (along with check_coordinated_signup,
--     check_flagged_question, check_new_transparency_event, and
--     call_alert_function itself) with versions that insert with
--     email_sent = true immediately, before net.http_post() is even
--     called, and never touch request_id.
--   - Nothing after 003 ever restored request_id capture.
--
-- The practical effect: since 003, "email_sent = true" has meant "we
-- attempted to call send-alert-email", not "the email was confirmed
-- delivered". If send-alert-email ever fails (bad key, function down,
-- 500, whatever), the admin dashboard still shows email_sent = true for
-- alerts that were never actually delivered — including every
-- migration-013/014 security-check alert and every migration-033/034
-- monitoring alert (heartbeat staleness, policy drift, trigger
-- coverage, admin volume spikes), since all of those go through the
-- shared call_alert_function() helper.
--
-- check_pending_alert_emails() itself is unchanged here — its logic was
-- already correct, it just had nothing feeding it. This migration
-- restores the feed: call_alert_function() and the four still-hand-rolled
-- 003 trigger functions now capture the pg_net request id and insert
-- with email_sent = false, same as the original 000_functions.sql
-- check_vote_manipulation() did, letting the existing 5-minute
-- reconciliation job do real confirmation for every alert type.
--
-- `request_id` is added defensively with IF NOT EXISTS in case it
-- already exists live from some out-of-band change — either way this
-- migration is now the first place it's actually captured on git.
--
-- Tested against a local Postgres instance built from 00_mock_supabase.sql
-- plus the full real migration history (000-034), the same methodology
-- used for migrations 033/034 — see the project doc for details.
-- ============================================================

alter table public.anomaly_log add column if not exists request_id bigint;

-- ============================================================
-- call_alert_function() — shared pipeline behind check_registration_spike,
-- the migration-013/014 security checks, and all of migration 033/034's
-- monitoring alerts.
-- ============================================================
create or replace function public.call_alert_function(
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
  v_request_id bigint;
begin
  select decrypted_secret into service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  select net.http_post(
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
  ) into v_request_id;

  insert into anomaly_log (alert_type, severity, details, email_sent, request_id)
  values (p_alert_type, p_severity, p_details, false, v_request_id);
end;
$$;

-- ============================================================
-- check_vote_manipulation() — >50 vote changes on one question in 1h
-- ============================================================
create or replace function public.check_vote_manipulation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ============================================================
-- check_coordinated_signup() — >20 new accounts from same country in 1h
-- ============================================================
create or replace function public.check_coordinated_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  country_count int;
  already_alerted boolean;
  v_request_id bigint;
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
    select net.http_post(
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
    ) into v_request_id;

    insert into anomaly_log (alert_type, severity, details, related_country, email_sent, request_id)
    values (
      'coordinated_signup',
      'warning',
      jsonb_build_object('count', country_count, 'country', NEW.country_code, 'window', '1h'),
      NEW.country_code,
      false,
      v_request_id
    );
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- check_flagged_question() — question flagged for human moderation
-- ============================================================
create or replace function public.check_flagged_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id bigint;
begin
  if NEW.human_moderation_required = true and (OLD.human_moderation_required is distinct from true) then
    select net.http_post(
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
    ) into v_request_id;

    insert into anomaly_log (alert_type, severity, details, related_question_id, email_sent, request_id)
    values (
      'flagged_question',
      'warning',
      jsonb_build_object('question', NEW.text),
      NEW.id,
      false,
      v_request_id
    );
  end if;

  return NEW;
end;
$$;

-- ============================================================
-- check_new_transparency_event() — new transparency event added
-- ============================================================
create or replace function public.check_new_transparency_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id bigint;
begin
  select net.http_post(
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
  ) into v_request_id;

  insert into anomaly_log (alert_type, severity, details, email_sent, request_id)
  values (
    'transparency_event',
    'warning',
    jsonb_build_object('eventType', NEW.event_type),
    false,
    v_request_id
  );

  return NEW;
end;
$$;
