-- migration: 004_fix_vote_triggers.sql

create or replace function public.log_vote_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into vote_changes (question_id, user_id, previous_choice, new_choice, changed_at)
  values (new.question_id, new.user_id, old.choice, new.choice, now());
  new.change_count := coalesce(old.change_count, 0) + 1;
  return new;
end;
$$;

drop trigger if exists on_vote_change_log on votes;
create trigger on_vote_change_log
  before update on votes
  for each row
  when (old.choice is distinct from new.choice)
  execute function log_vote_change();

drop trigger if exists update_streak_on_vote on votes;
create trigger update_streak_on_vote
  after insert on votes
  for each row
  execute function update_streak();