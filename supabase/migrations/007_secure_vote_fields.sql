-- senseUS: Secure vote integrity fields against client manipulation
--
-- PROBLEM (found in security review, 2026-07-27):
-- Vote.jsx computed integrity_weight_at_vote, pct_yes_at_vote, and
-- pct_no_at_vote in the browser and sent them directly in the upsert.
-- Nothing server-side validated or recomputed these values. Since
-- get_vote_tally() sums integrity_weight_at_vote straight from the
-- votes table, anyone who intercepted or scripted the request could
-- set their own vote's weight to any value they wanted — a direct
-- vote-manipulation vulnerability that defeats the integrity-weighting
-- system entirely.
--
-- Separately, increment_answers_count(user_id) had no check that the
-- caller was the user being incremented, letting any authenticated
-- user inflate anyone's answers_count via a direct RPC call.
--
-- FIX:
-- 1. A BEFORE INSERT OR UPDATE trigger on votes now overwrites
--    integrity_weight_at_vote and the pct_*_at_vote fields
--    server-side, ignoring whatever the client sent. The client can
--    still choose `choice`, but nothing else that affects tallies.
-- 2. A CHECK constraint backstops the weight range and choice value,
--    independent of the trigger, in case anything ever bypasses it.
-- 3. increment_answers_count now requires auth.uid() = user_id.
-- ============================================================

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
$function$;

drop trigger if exists secure_vote_fields_trigger on public.votes;
create trigger secure_vote_fields_trigger
before insert or update on public.votes
for each row
execute function public.secure_vote_fields();

-- Backstop constraints — hold even if some future code path bypasses
-- the trigger somehow (e.g. a bulk admin import).
alter table public.votes
  drop constraint if exists integrity_weight_at_vote_range;
alter table public.votes
  add constraint integrity_weight_at_vote_range
  check (integrity_weight_at_vote between 1.0000 and 1.0050);

alter table public.votes
  drop constraint if exists valid_choice;
alter table public.votes
  add constraint valid_choice
  check (choice in ('yes','ly','ln','no','dec'));

-- ============================================================
-- FIX: increment_answers_count ownership check
-- ============================================================

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
$function$;
