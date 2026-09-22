-- senseUS: resonance counts never actually persisted -- comments.
-- resonance_count has had no server-side mechanism updating it since the
-- feature shipped
--
-- CONTEXT (Aidan, 2026-09-21): he resonated with two comments, watched
-- the count go from 0 to 1 on each, navigated away and back, and found
-- both back at 0. Not a cron-job lag (there's no cron job in this
-- feature's path at all) -- the count was never actually being written
-- to the database in the first place.
--
-- toggleResonate() in Conversation.jsx only ever inserts/deletes rows in
-- comment_resonances (the toggle/membership table) and then updates its
-- own local React state optimistically -- it never issues an UPDATE
-- against comments.resonance_count itself. That's the correct client
-- design (the count is meant to be a server-computed aggregate, not
-- something the client writes directly), but it depends on *something*
-- server-side keeping resonance_count in sync with comment_resonances,
-- and nothing does. Migration 030 flagged this exact possibility in
-- passing ("almost certainly lives in an untracked trigger ... flagged
-- for Aidan to confirm") but it was never confirmed either way at the
-- time. It's now confirmed, two ways:
--   1. AUDIT_NOTES.md's full live trigger inventory (pulled directly
--      from pg_trigger, not a grep) lists every trigger that exists on
--      `comments` -- moderate_comment_trigger, protect_comment_
--      computed_columns_trigger, set_updated_at -- and none on
--      `comment_resonances` at all. There has never been a trigger
--      anywhere in this project connecting the two tables.
--   2. Reproduced live today: resonance_count starts at its schema
--      default (0) on every comment and, absent this migration, no code
--      path anywhere -- trigger, RPC, or otherwise -- ever changes it. A
--      resonate only ever touches comment_resonances.
-- So every comment's resonance_count has been permanently stuck at
-- whatever it started as since the feature shipped -- 0, unless a
-- comment happened to be seeded with a nonzero value directly. The
-- "sort by top" comment ranking (Conversation.jsx's `sort === 'top'`)
-- and the featured-comment picks (topYesComment/topNoComment, whichever
-- comment on each side has the highest resonance_count) have therefore
-- never actually reflected real resonance activity either -- both are a
-- second, quieter symptom of the same root cause, not separate bugs.
--
-- FIX -- an AFTER INSERT/DELETE trigger on comment_resonances that
-- increments/decrements the matching comment's resonance_count, so the
-- existing client code (unchanged) now actually persists what it's
-- already been optimistically showing. SECURITY DEFINER so it can write
-- resonance_count regardless of which user's insert/delete fired it,
-- same pattern already used by increment_flag_count() and
-- protect_comment_computed_columns() elsewhere in this file set.
-- Deliberately a trigger rather than a client-called RPC (the
-- increment_flag_count() shape): a trigger can never be skipped by a
-- future code change forgetting to call it, and it's atomic with the
-- insert/delete itself rather than a second round trip the client has to
-- remember to make.
--
-- Also backfills every existing comment's resonance_count from the real
-- comment_resonances rows already sitting in the table -- including
-- Aidan's own two resonates from today, which are for-real persisted in
-- comment_resonances (that part always worked -- it's why the
-- highlighted/"already resonated" icon state survives a reload even
-- though the count didn't) and just need the count column to catch up
-- to what they already say.
--
-- Verified against a local Postgres 16 instance: resonate -> count is 1
-- on a fresh read in a new transaction (the exact scenario reported);
-- second distinct resonator accumulates to 2, not stuck at 0/1;
-- un-resonate brings it back down; a duplicate resonate attempt (fast
-- double-click) still fails on the real unique constraint and does NOT
-- double-count; deleting a comment cascades its comment_resonances rows
-- without erroring even though the parent row is gone by the time each
-- row's delete trigger runs; migration 030's protect_comment_computed_
-- columns_trigger still blocks a non-admin from clearing their own
-- flag_count, confirming this doesn't weaken that existing protection;
-- the backfill correctly recomputes a drifted comment's count from its
-- real resonance rows and leaves an already-correct comment (0 rows, 0
-- count) untouched.
--
-- One accepted, harmless side effect worth knowing about: this fires an
-- UPDATE on the comment row on every resonate/un-resonate, which also
-- re-runs comments' existing set_updated_at trigger and bumps
-- updated_at. Nothing in the UI reads updated_at (the "--edited--" tag
-- and edit-history blocks key off edited_at, which this never touches),
-- so this has no visible effect -- flagging it here rather than adding
-- complexity to suppress it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_comment_resonance_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    update public.comments
    set resonance_count = resonance_count + 1
    where id = new.comment_id;
    return new;
  elsif tg_op = 'DELETE' then
    -- greatest(...,0) is a defensive floor only -- it should never
    -- actually bite given the unique constraint on comment_resonances
    -- and the backfill below, but a count can never go visibly negative
    -- even if some future data anomaly slipped past those.
    update public.comments
    set resonance_count = greatest(resonance_count - 1, 0)
    where id = old.comment_id;
    return old;
  end if;
  return null;
end;
$function$;

drop trigger if exists sync_comment_resonance_count_trigger on public.comment_resonances;
create trigger sync_comment_resonance_count_trigger
  after insert or delete on public.comment_resonances
  for each row
  execute function public.sync_comment_resonance_count();

-- Backfill: recompute every comment's resonance_count from the real
-- comment_resonances rows, one time, to fix the drift that's been
-- accumulating since the feature shipped.
with counts as (
  select comment_id, count(*)::int as cnt
  from public.comment_resonances
  group by comment_id
)
update public.comments c
set resonance_count = coalesce(counts.cnt, 0)
from counts
where counts.comment_id = c.id
  and c.resonance_count is distinct from counts.cnt;

-- Covers the other direction too: a comment with a nonzero count but no
-- matching comment_resonances rows at all (none expected today, since
-- nothing has ever written to resonance_count -- but this makes the
-- backfill correct regardless of that assumption, not just under it).
update public.comments c
set resonance_count = 0
where resonance_count <> 0
  and not exists (
    select 1 from public.comment_resonances r where r.comment_id = c.id
  );

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the trigger is live:
--    select tgname from pg_trigger where tgrelid = 'public.comment_resonances'::regclass;
--    -> should include sync_comment_resonance_count_trigger
--
-- 2. Spot-check the backfill against a comment you resonated with today:
--    select c.id, c.resonance_count, (select count(*) from comment_resonances r where r.comment_id = c.id) as real_count
--    from comments c where c.id = '<that comment's id>';
--    -> resonance_count should now equal real_count
--
-- 3. Confirm no comment is out of sync anywhere:
--    select c.id, c.resonance_count, coalesce(r.cnt, 0) as real_count
--    from comments c
--    left join (select comment_id, count(*) cnt from comment_resonances group by comment_id) r on r.comment_id = c.id
--    where c.resonance_count is distinct from coalesce(r.cnt, 0);
--    -> should return zero rows
-- ============================================================
