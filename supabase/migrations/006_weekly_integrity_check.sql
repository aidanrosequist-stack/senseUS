-- migration: 006_weekly_integrity_check.sql
--
-- Adds a weekly automated data integrity check that runs every Sunday
-- at 6am UTC. Checks five invariants and logs to anomaly_log if any
-- fail. Silent when clean, loud when something is wrong.
-- Anomalies appear in the Admin Reports tab and trigger alert emails.

create or replace function public.run_integrity_checks()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  answers_count_issues integer;
  invalid_choices integer;
  duplicate_votes integer;
  pct_sum_issues integer;
  orphaned_changes integer;
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
  left join votes v on v.user_id = vc.user_id 
  and v.question_id = vc.question_id
  where v.id is null;

  if answers_count_issues > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'answers_count_mismatch', 'affected_rows', answers_count_issues)
    );
  end if;

  if invalid_choices > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'invalid_choice_values', 'affected_rows', invalid_choices)
    );
  end if;

  if duplicate_votes > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'duplicate_votes', 'affected_rows', duplicate_votes)
    );
  end if;

  if pct_sum_issues > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'pct_sum_not_100', 'affected_rows', pct_sum_issues)
    );
  end if;

  if orphaned_changes > 0 then
    perform log_anomaly_only(
      'integrity_check_failed', 'critical',
      jsonb_build_object('check', 'orphaned_vote_changes', 'affected_rows', orphaned_changes)
    );
  end if;

end;
$$;

-- Schedule: every Sunday at 6am UTC
select cron.schedule(
  'weekly-integrity-check',
  '0 6 * * 0',
  $$select public.run_integrity_checks();$$
);