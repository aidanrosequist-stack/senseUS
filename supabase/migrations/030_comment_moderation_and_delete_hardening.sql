-- senseUS: close two comments-table gaps found in the 2026-08-21 RLS
-- policy review
--
-- GAP 1 — moderation bypass by the comment's own author.
-- "Users can update own comments" only checks ownership
-- (auth.uid() = user_id), with no column restriction. moderate_comment()
-- recomputes is_flagged from the comment body, but explicitly skips
-- re-running "when tg_op = 'UPDATE' and new.body is not distinct from
-- old.body" (011's own stated reason: so an admin clearing a flag
-- doesn't get silently re-flagged) — which also means it never looks
-- at flag_count or is_removed at all, on INSERT or UPDATE. Net effect:
-- a user could directly PATCH their own comment with
-- { is_removed: false, flag_count: 0 } and body left untouched,
-- silently undoing an admin's moderation action on their own comment.
-- Confirmed there's no in-app flow that needs is_removed client-writable
-- at all (grepped the frontend — nothing sets it, consistent with
-- removal being an admin/DB-only action); flag_count and is_flagged ARE
-- set by admins in-app (Admin.jsx's "clear flag" button does a direct
-- .update({is_flagged:false, flag_count:0})), so the fix below exempts
-- admins the same way "Admins can update any comment" already does at
-- the RLS layer, rather than inventing a new trust boundary.
--
-- Deliberately NOT locking resonance_count here, even though it has the
-- same "no column restriction" exposure: toggleResonate() in
-- Conversation.jsx only ever inserts/deletes rows in comment_resonances
-- and updates its own local React state optimistically — it never
-- issues an UPDATE against comments.resonance_count itself. Whatever
-- actually keeps that column in sync with comment_resonances (if
-- anything does) almost certainly lives in an untracked trigger, same
-- as several other things this project has found live-only and never
-- migrated. Locking resonance_count here without being able to see that
-- trigger risks silently breaking the entire resonate/"like" count the
-- moment it's triggered by a non-admin user's own action. Flagged for
-- Aidan to confirm before this gets closed too — see the write-up.
--
-- GAP 2 — cross-user cascade delete via an unused DELETE policy.
-- "Users can delete own comments" (DELETE, auth.uid() = user_id) is
-- real and live, but grepping the whole frontend shows the app NEVER
-- calls .delete() on comments — every "delete" in the UI is the
-- is_deleted soft-delete flag via an UPDATE. Meanwhile
-- comments_parent_id_fkey is ON DELETE CASCADE. Postgres foreign-key
-- cascade actions are NOT subject to RLS on the cascaded-to rows (they
-- run as an internal referential-integrity action, not a normal DML
-- statement) — so a user hard-deleting their own top-level comment via
-- a direct REST call would cascade-delete every reply underneath it,
-- including replies written by other users, with no ownership check on
-- those child rows at all. Since the app never uses this capability,
-- removing it has zero functional impact and closes a real
-- content-destruction vector.
-- ============================================================

-- GAP 2 fix: drop the unused, dangerous DELETE policy. Soft-delete via
-- the existing "Users can update own comments" policy (is_deleted flag)
-- remains the only way a user removes their own comment, matching what
-- the app actually does today.
drop policy if exists "Users can delete own comments" on public.comments;

-- GAP 1 fix: lock flag_count / is_removed the same way
-- protect_admin_columns locks profiles' computed columns, with an admin
-- exemption matching "Admins can update any comment"'s existing trust
-- level. Deliberately leaves is_flagged alone — that's moderate_comment's
-- job and this must not fight it. resonance_count deliberately excluded
-- — see the note above.
CREATE OR REPLACE FUNCTION public.protect_comment_computed_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Deliberately `if not (A or B) then <protect> end if`, not an early
  -- `if (A or B) then return end if`. auth.role() reads NULL (not the
  -- literal 'service_role') for anything with no PostgREST request
  -- context — a migration run, a direct superuser session. With an
  -- early-return structure, `NULL = 'service_role'` is NULL, `NULL OR
  -- is_admin_user()` stays NULL when is_admin_user() is false, and
  -- `if NULL then return` is treated as false — so the early return
  -- would be skipped and the protective block below would incorrectly
  -- run even for a trusted system context. Wrapping the whole body in
  -- `if not (...)` instead means NOT NULL is also NULL, so `if NULL
  -- then <protect>` is likewise treated as false — protection correctly
  -- skipped for a NULL-role context either way. Same fix already made
  -- in protect_admin_columns (migration 029) after finding this exact
  -- mistake there first.
  if not (auth.role() = 'service_role' or is_admin_user()) then
    if tg_op = 'INSERT' then
      new.flag_count := 0;
      new.is_removed := false;
    else
      new.flag_count := old.flag_count;
      new.is_removed := old.is_removed;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_comment_computed_columns_trigger on public.comments;
create trigger protect_comment_computed_columns_trigger
  before insert or update on public.comments
  for each row
  execute function public.protect_comment_computed_columns();
