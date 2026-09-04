-- migration: 072_comment_edit_history_and_vote_snapshot.sql
--
-- CONTEXT (Aidan, 2026-09-04): two questions about /conversation led here.
-- First: does editing a comment show the original text, or does it just
-- silently overwrite it? Today it's a silent overwrite -- updateComment()
-- REPLACEs body outright, leaving only an "--edited--" tag with no way to
-- see what changed. Second, while checking get_conversation_comments()
-- (migration 061) to answer a related question, its vote_choice column
-- turned out to be a LIVE join against votes -- `left join public.votes v
-- on v.user_id = c.user_id and v.question_id = p_question_id` -- so the
-- little vote badge next to every comment silently updates for EVERY past
-- comment the moment its author changes their vote on the question,
-- however long ago they wrote it. Aidan confirmed this was a real, unwanted
-- bug: "so if someone voted one way, then someone resonates with it, or
-- replies, then that person comes back and changes their vote... you would
-- have to notify the user that resonated/replied somehow, correct?"
--
-- DESIGN (Aidan, confirmed 2026-09-04): a comment freezes the vote choice
-- held at the moment it was posted, shown alongside it forever, with no
-- notification system needed -- the badge simply stops silently
-- rewriting history instead. Editing works the same way: the ORIGINAL
-- text and the ORIGINAL vote stance are frozen together the first time a
-- comment is edited (never again after that), shown struck through above
-- the current text, and the current text is re-colored in whatever the
-- vote stance is AT THE TIME OF THAT EDIT. A comment can be edited at
-- most twice ("if they can't make up their mind or spell right in 3
-- takes, then they're out of luck").
--
-- FOUR NEW COLUMNS on comments:
--   vote_choice_at_comment  -- the vote stance behind the CURRENT body:
--                              snapshotted at INSERT, re-snapshotted only
--                              at each genuine text edit. This is what
--                              get_conversation_comments() now returns
--                              instead of a live votes join.
--   original_body            -- the very first body text, frozen the
--                              first time (and only the first time) the
--                              comment is edited. NULL until then.
--   original_vote_choice     -- the vote stance frozen alongside
--                              original_body, at that same first edit.
--   edit_count               -- how many genuine text edits this comment
--                              has had. Capped at 2 by the trigger below.
--
-- Both new columns are populated by a single new BEFORE INSERT OR UPDATE
-- trigger, snapshot_comment_edit_history() -- see its own header comment
-- for exactly how it tells a genuine text edit apart from every other kind
-- of UPDATE this table sees (an admin clearing a flag, resonance_count
-- churn, and critically deleteComment()'s soft-delete path, which rewrites
-- body to a fixed placeholder and must NOT count as an edit or be blocked
-- by the cap once it's exhausted).
--
-- A SECOND, SMALLER FIX bundled in here because the trigger above depends
-- on it working correctly: protect_comment_computed_columns() (migration
-- 030) locks is_removed for non-admins on every UPDATE by unconditionally
-- reverting it back to old.is_removed -- `new.is_removed := old.is_removed`,
-- no exceptions. That was written to stop a user undoing an admin's
-- moderation call, and correctly cites "nothing in the frontend sets
-- is_removed" as its justification -- true at the time. But
-- deleteComment()'s soft-delete path (added later, for a comment with
-- replies) DOES set is_removed: true directly, as the comment's own
-- owner, and that trigger has been silently reverting it back to false
-- ever since: it never actually looked like a bug in the UI because
-- deleteComment() also rewrites body to '[deleted by user]' in the same
-- call, which reads the same either way. Fixed below to allow exactly one
-- transition for a non-admin: is_removed false -> true (a genuine
-- self-delete). Every other transition (most importantly true -> false,
-- undoing an admin's moderation) is still blocked exactly as before --
-- RLS's existing "Users can update own comments" (auth.uid() = user_id)
-- already means only the comment's own owner can reach this code path for
-- their own row at all, so this doesn't open any new door.
--
-- BACKFILL: existing comments get vote_choice_at_comment backfilled using
-- the exact join get_conversation_comments() used to run live, so nothing
-- goes blank post-migration. original_body/original_vote_choice are left
-- NULL for existing comments -- there's no way to recover a body an
-- earlier UPDATE already overwrote, so a comment edited before this
-- migration just won't show a "before" state (same as today). edit_count
-- is backfilled to 1 where edited_at is already set, 0 otherwise -- an
-- approximation (a comment edited twice before today only shows 1 edit
-- used), noted here rather than hidden, since exact historical edit
-- counts were never tracked.
-- ============================================================

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS vote_choice_at_comment text,
  ADD COLUMN IF NOT EXISTS original_body text,
  ADD COLUMN IF NOT EXISTS original_vote_choice text,
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

UPDATE public.comments c
SET vote_choice_at_comment = v.choice
FROM public.votes v
WHERE v.user_id = c.user_id
  AND v.question_id = c.question_id
  AND c.vote_choice_at_comment IS NULL;

UPDATE public.comments
SET edit_count = 1
WHERE edited_at IS NOT NULL
  AND edit_count = 0;

-- ============================================================
-- Trigger: snapshot_comment_edit_history
--
-- BEFORE INSERT: freeze the vote choice held right now as
-- vote_choice_at_comment, and force original_body/original_vote_choice/
-- edit_count to their "brand new comment" state regardless of anything a
-- client tried to insert directly -- same defensive posture
-- protect_comment_computed_columns already takes with flag_count/
-- is_removed on INSERT.
--
-- BEFORE UPDATE, in order:
--   1. The self-delete path (is_removed flipping false -> true in this
--      same UPDATE, once protect_comment_computed_columns above has
--      already resolved whether that transition is even allowed) --
--      leave every edit-history column exactly as it was. This must be
--      checked FIRST, before the "did body change" check below, because
--      deleteComment() changes body AND is_removed in the same call --
--      without this early branch, every soft-delete would otherwise fall
--      through into the "genuine edit" branch and both consume one of
--      the two allowed edits and be blocked once the cap is already hit.
--   2. No real body change (an admin clearing a flag, resonance churn,
--      or any other column-only update) -- also leave edit-history alone.
--   3. A genuine text edit: enforce the 2-edit cap for non-admins: freeze
--      original_body/original_vote_choice on the FIRST edit only (never
--      overwritten by a second edit), increment edit_count, and
--      re-snapshot vote_choice_at_comment to whatever the user's vote is
--      right now.
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
    new.edit_count := 0;
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.

  -- Branch 1: the soft-delete path. By this point
  -- protect_comment_computed_columns_trigger has already run (it fires
  -- first -- "protect..." sorts before "snapshot..." alphabetically,
  -- Postgres' own BEFORE-trigger ordering) and either allowed this exact
  -- false -> true transition (self-delete) or reverted it back to false
  -- (blocked). Either way, this is not a text edit -- leave everything
  -- alone.
  if new.is_removed = true and old.is_removed = false then
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
    new.edit_count := old.edit_count;
    new.vote_choice_at_comment := old.vote_choice_at_comment;
    return new;
  end if;

  -- Branch 2: no real body change -- nothing here to track.
  if new.body is not distinct from old.body then
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
    new.edit_count := old.edit_count;
    new.vote_choice_at_comment := old.vote_choice_at_comment;
    return new;
  end if;

  -- Branch 3: a genuine text edit.
  if old.edit_count >= 2 and not (auth.role() = 'service_role' or is_admin_user()) then
    raise exception 'This comment has already been edited twice and cannot be edited again.';
  end if;

  if old.original_body is null then
    -- First-ever edit: freeze the original text and the vote stance it
    -- was posted under.
    new.original_body := old.body;
    new.original_vote_choice := old.vote_choice_at_comment;
  else
    -- A second edit must not overwrite the already-frozen original.
    new.original_body := old.original_body;
    new.original_vote_choice := old.original_vote_choice;
  end if;

  new.edit_count := old.edit_count + 1;

  select v.choice into new.vote_choice_at_comment
  from public.votes v
  where v.user_id = new.user_id and v.question_id = new.question_id;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS snapshot_comment_edit_history_trigger ON public.comments;
CREATE TRIGGER snapshot_comment_edit_history_trigger
  BEFORE INSERT OR UPDATE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_comment_edit_history();

-- ============================================================
-- protect_comment_computed_columns fix: allow a user's own is_removed
-- false -> true transition (self-delete), keep every other transition
-- locked for non-admins exactly as migration 030 left it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_comment_computed_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (auth.role() = 'service_role' or is_admin_user()) then
    if tg_op = 'INSERT' then
      new.flag_count := 0;
      new.is_removed := false;
    else
      new.flag_count := old.flag_count;
      -- Allow exactly one is_removed transition for a non-admin: their
      -- own false -> true (deleteComment()'s soft-delete path, run under
      -- "Users can update own comments" -- ownership-only RLS, so this
      -- can only ever apply to a user's own row). Every other transition,
      -- most importantly true -> false undoing an admin's moderation
      -- action, is still forced back to old.is_removed exactly as before.
      if not (old.is_removed = false and new.is_removed = true) then
        new.is_removed := old.is_removed;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- ============================================================
-- get_conversation_comments() rewrite: return the frozen snapshot columns
-- instead of a live join against votes. DROP + CREATE (not CREATE OR
-- REPLACE) because the output column list is changing, same reason
-- migration 061 needed a fresh CREATE rather than a REPLACE of some
-- still-hypothetical earlier version.
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
-- DEFAULT PRIVILEGES rule. Revoked here explicitly, same as 061 did.
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversation_comments(uuid) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_conversation_comments', 'Client RPC (Conversation.jsx) -- single call replacing the comments select + get_public_profiles + get_commenter_vote_choices pattern, so another user''s raw user_id is never sent to the client at all. Computes is_own server-side via auth.uid(). Migration 072 (2026-09-04): vote_choice is now the frozen vote_choice_at_comment snapshot rather than a live join against votes, plus original_body/original_vote_choice/edit_count for the strikethrough edit-history display.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Post a comment, then change your vote on that question. Re-fetch
--    get_conversation_comments() for it -- vote_choice should still show
--    the ORIGINAL choice, not the new one.
--
-- 2. Edit that same comment. original_body/original_vote_choice should
--    now be populated with the pre-edit text and the vote choice from
--    step 1; vote_choice should now reflect whatever your CURRENT vote
--    is; edit_count should be 1.
--
-- 3. Edit it again -- edit_count becomes 2, original_body/
--    original_vote_choice stay exactly as they were after the first
--    edit (not overwritten with the second edit's "before" text).
--
-- 4. Try a third edit -- should fail with "This comment has already been
--    edited twice and cannot be edited again."
--
-- 5. Post a comment with at least one reply from another test user, then
--    delete it as its owner (soft-delete path). Confirm: is_removed is
--    now actually true (previously silently reverted to false),
--    edit_count/original_body/original_vote_choice are unchanged from
--    before the delete, and a subsequent edit attempt is irrelevant
--    (the UI hides edit/delete controls once is_removed is true).
--
-- 6. Confirm a comment made before this migration still shows a
--    vote_choice_at_comment value (backfilled) and no original_body
--    (correctly -- no way to recover pre-migration edit history).
