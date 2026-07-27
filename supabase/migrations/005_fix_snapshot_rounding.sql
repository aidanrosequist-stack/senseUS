-- migration: 005_fix_snapshot_rounding.sql
--
-- Fixes a rounding invariant issue in take_question_snapshots().
-- Previously pct_yes and pct_no were both computed with round(),
-- which can produce pct_yes + pct_no = 101 on exact 50.5/49.5 splits.
-- Fix: compute pct_yes with round(), derive pct_no as 100 - pct_yes.
-- This guarantees pct_yes + pct_no = 100 always.

create or replace function public.take_question_snapshots()
returns void
language plpgsql
security definer
as $$
declare
  q record;
  yes_count integer;
  ly_count integer;
  ln_count integer;
  no_count integer;
  total integer;
  pct_yes_val integer;
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
      pct_yes_val := round(((yes_count + ly_count)::numeric / total) * 100);

      insert into public.question_snapshots (
        question_id, pct_yes, pct_no, total_votes,
        yes_votes, ly_votes, ln_votes, no_votes, snapshot_date
      ) values (
        q.id,
        pct_yes_val,
        100 - pct_yes_val,
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
$$;