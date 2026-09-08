-- migration: 076_comment_edit_history_second_freeze.sql
--
-- CONTEXT (Aidan, 2026-09-08): while testing migration 072's edit-history
-- feature, Aidan made two edits to the same comment in a row (also
-- changing his vote in between) and found the version between the two
-- edits vanished entirely -- only the very-first-ever version
-- (original_body) and the final current version were ever visible. With
-- a 2-edit cap there are up to 3 real versions of a comment (original,
-- after edit 1, after edit 2/final), but the UI only ever showed 2 of
-- them.
--
-- Aidan's call after weighing it: freeze BOTH edits, not just the first
-- -- "if someone has changed their vote after their first and second
-- edits, it should be reflected." original_body/original_vote_choice
-- keep behaving exactly as migration 072 left them (frozen once, on the
-- very first genuine edit, never touched again). Two new columns,
-- previous_body/previous_vote_choice, capture the state immediately
-- before the MOST RECENT genuine edit -- so after a first edit they're
-- identical to original_body/original_vote_choice (nothing new to show),
-- and after a second edit they diverge, giving the frontend a second,
-- distinct struck-through block to render.
--
-- Both are computed by the same snapshot_comment_edit_history() trigger
-- migration 072 introduced -- every branch that already carries
-- original_body/original_vote_choice forward unchanged (the soft-delete
-- path, the no-real-body-change path) now also carries
-- previous_body/previous_vote_choice forward unchanged, and the genuine-
-- edit branch sets previous_body/previous_vote_choice to whatever the
-- OLD row's body/vote_choice_at_comment were, on every genuine edit (not
-- just the first).
--
-- BACKFILL: existing edited comments get previous_body/previous_vote_choice
-- mirrored from original_body/original_vote_choice -- the best available
-- approximation (there's no way to recover a mid-edit version an earlier
-- UPDATE already overwrote before this migration existed), matching
-- exactly how migration 072 itself left original_body NULL for comments
-- edited before IT existed. A comment edited again after this migration
-- will get a real, distinct previous_body from that point on.
-- ============================================================

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS previous_body text,
  ADD COLUMN IF NOT EXISTS previous_vote_choice text;

UPDATE public.comments
SET previous_body = original_body,
    previous_vote_choice = original_vote_choice
WHERE edit_count >= 1
  AND previous_body IS NULL;

-- ============================================================
-- snapshot_comment_edit_history(): same shape as migration 072, with
-- previous_body/previous_vote_choice added alongside original_body/
-- original_vote_choice in every branch. CREATE OR REPLACE is fine here
-- (unlike get_conversation_comments() below) -- this is a trigger
-- function, its signature (RETURNS trigger, no args) never changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.snapshot_comment_edit_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    select v.choice into new.vote_choice_at_comment
    from public.votes v
    where v.user_id = new.user_id and v.question_id = new.question_id;

    new.original_body := null;
    new.original_vote_choice := null;
    new.previous_body := null;
    new.previous_vote_choice := null;
    new.edit_count := 0;
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.

  -- Branch 1: the soft-delete path -- not a text edit, leave everything
  -- (including the newly-added previous_* columns) alone.
  if new.is_removed = true and old.is_removed = false then
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
    new.previous_body := old.previous_body;
    new.previous_vote_choice := old.previous_vote_choice;
    new.edit_count := old.edit_count;
    new.vote_choice_at_comment := old.vote_choice_at_comment;
    return new;
  end if;

  -- Branch 2: no real body change -- nothing here to track.
  if new.body is not distinct from old.body then
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
    new.previous_body := old.previous_body;
    new.previous_vote_choice := old.previous_vote_choice;
    new.edit_count := old.edit_count;
    new.vote_choice_at_comment := old.vote_choice_at_comment;
    return new;
  end if;

  -- Branch 3: a genuine text edit.
  if old.edit_count >= 2 and not (auth.role() = 'service_role' or is_admin_user()) then
    raise exception 'This comment has already been edited twice and cannot be edited again.';
  end if;

  if old.original_body is null then
    -- First-ever edit: freeze the original text/vote stance (as before),
    -- AND previous_body/previous_vote_choice start out identical to it --
    -- there's nothing else to show yet, so the frontend renders just one
    -- struck-through block until a second edit actually happens.
    new.original_body := old.body;
    new.original_vote_choice := old.vote_choice_at_comment;
  else
    -- A second (or later, for admins) edit must not overwrite the
    -- already-frozen true original.
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
  end if;

  -- previous_body/previous_vote_choice always capture what's being
  -- superseded by THIS edit -- updated on every genuine edit, not just
  -- the first, so a second edit's struck-through "what it said right
  -- before this" is preserved instead of silently vanishing.
  new.previous_body := old.body;
  new.previous_vote_choice := old.vote_choice_at_comment;

  new.edit_count := old.edit_count + 1;

  select v.choice into new.vote_choice_at_comment
  from public.votes v
  where v.user_id = new.user_id and v.question_id = new.question_id;

  return new;
end;
$function$;

-- ============================================================
-- get_conversation_comments() rewrite: return previous_body/
-- previous_vote_choice alongside the existing edit-history columns.
-- DROP + CREATE (not CREATE OR REPLACE) because the output column list
-- is changing -- same reason migrations 061 and 072 needed a fresh
-- CREATE rather than a REPLACE.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_conversation_comments(uuid);

CREATE FUNCTION public.get_conversation_comments(p_question_id uuid)
 RETURNS TABLE(
   id uuid,
   body text,
   resonance_count integer,
   created_at timestamp with time zone,
   parent_id uuid,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   vote_choice text,
   original_body text,
   original_vote_choice text,
   previous_body text,
   previous_vote_choice text,
   edit_count integer
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.body,
    c.resonance_count,
    c.created_at,
    c.parent_id,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    p.first_name,
    p.last_initial,
    p.display_preference,
    p.anon_name,
    c.vote_choice_at_comment as vote_choice,
    c.original_body,
    c.original_vote_choice,
    c.previous_body,
    c.previous_vote_choice,
    c.edit_count
  from public.comments c
  left join public.profiles p on p.id = c.user_id
  where c.question_id = p_question_id
    and c.is_deleted = false
  order by c.resonance_count desc
  limit 500;
$function$;

GRANT EXECUTE ON FUNCTION public.get_conversation_comments(uuid) TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked here explicitly, same as 061/072 did.
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_conversation_comments', 'Client RPC (Conversation.jsx) -- single call replacing the comments select + get_public_profiles + get_commenter_vote_choices pattern, so another user''s raw user_id is never sent to the client at all. Computes is_own server-side via auth.uid(). Migration 072 (2026-09-04): vote_choice is the frozen vote_choice_at_comment snapshot rather than a live join against votes, plus original_body/original_vote_choice/edit_count for the strikethrough edit-history display. Migration 076 (2026-09-08): added previous_body/previous_vote_choice, capturing the version immediately before the most recent edit (not just the very first), so a second edit no longer silently loses the version that existed between the two edits.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Post a comment, edit it once. original_body/previous_body should
--    both equal the pre-edit text (identical -- nothing new to show
--    yet). edit_count = 1.
--
-- 2. Change your vote, edit the same comment again (a real text
--    change). original_body should be UNCHANGED from step 1.
--    previous_body should now equal whatever the comment said right
--    after step 1's edit (distinct from original_body).
--    previous_vote_choice should equal the vote you had during step 1,
--    NOT your original pre-edit-1 vote and NOT your current vote.
--    vote_choice_at_comment should equal your CURRENT vote. edit_count = 2.
--
-- 3. Try a third edit -- still fails with "already been edited twice."
--
-- 4. Post a comment, edit it ONCE only, leaving text unchanged from what
--    was in the box (no real edit) -- edit_count stays 0,
--    original_body/previous_body both stay NULL.
--
-- 5. Confirm a comment edited before this migration (edit_count >= 1,
--    original_body set) now also has previous_body = original_body
--    (backfilled), not NULL.
