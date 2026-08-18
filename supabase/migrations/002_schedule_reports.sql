-- migration: 002_schedule_reports.sql
--
-- Schedules the daily and weekly report Edge Functions using pg_cron + pg_net.
-- Run this AFTER both Edge Functions are deployed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service role key in Vault first (one-time, if not already done
-- for the export-email trigger):
--   select vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'service_role_key', 'Used by cron jobs to call Edge Functions');

-- Daily report — 7:00 AM UTC every day
select cron.schedule(
  'send-daily-report',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-daily-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Weekly report — Monday 8:00 AM UTC
select cron.schedule(
  'send-weekly-report',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/send-weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check scheduled jobs:
--   select * from cron.job;
-- To check run history/errors:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To unschedule (if needed):
--   select cron.unschedule('send-daily-report');