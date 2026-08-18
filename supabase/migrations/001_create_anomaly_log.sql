-- migration: 001_create_anomaly_log.sql
--
-- Central log for all threshold-alert events. Written to by DB triggers
-- when a threshold is crossed; read by the admin dashboard's anomaly log view.

create table if not exists anomaly_log (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  -- Expected values (matches the four alert types in the spec):
  --   'registration_spike'
  --   'vote_manipulation'
  --   'coordinated_signup'
  --   'flagged_question'
  --   'transparency_event'
  severity text not null default 'warning', -- 'warning' | 'critical'
  details jsonb not null default '{}',       -- flexible payload, e.g. { "count": 105, "window": "24h", "question_id": "..." }
  related_question_id uuid references questions(id),
  related_country text,                       -- for coordinated_signup alerts
  triggered_at timestamptz not null default now(),
  email_sent boolean not null default false,
  email_sent_at timestamptz,
  resolved boolean not null default false,    -- lets admins mark an alert as reviewed/handled
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

create index if not exists idx_anomaly_log_triggered_at on anomaly_log (triggered_at desc);
create index if not exists idx_anomaly_log_alert_type on anomaly_log (alert_type);
create index if not exists idx_anomaly_log_resolved on anomaly_log (resolved) where resolved = false;

-- RLS: only admins should read/write this table directly.
-- Adjust the policy below to match however you currently identify admins
-- (e.g. a profiles.is_admin boolean, or a separate admins table).
alter table anomaly_log enable row level security;

create policy "Admins can view anomaly log"
  on anomaly_log for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.is_admin = true
    )
  );

create policy "Admins can update anomaly log"
  on anomaly_log for update
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
      and profiles.is_admin = true
    )
  );

-- Note: inserts happen via trigger functions running as security definer,
-- so no insert policy is needed for regular users.