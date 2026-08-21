-- senseUS: Scope the Activity "my comments" reply-count query to the user
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #8):
-- Activity.jsx's fetchComments() fetched every non-deleted comment on the
-- entire platform (despite being named allCommentsOnMyQuestions, it had
-- no filter scoping it to the current user at all) just to walk parent_id
-- links in JS and count direct/total replies on the user's own handful of
-- comments. This scales with total platform comment volume, not with how
-- active that one user is — a comment-heavy platform would mean every
-- Activity page visit downloads essentially the entire comments table.
--
-- FIX:
-- A recursive-CTE RPC scoped to exactly the comment ids the caller
-- already has (their own comments), walking only that subtree
-- server-side and returning direct/total reply counts per root comment.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_comment_reply_counts(p_comment_ids uuid[])
 RETURNS TABLE(comment_id uuid, direct_replies bigint, total_replies bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive descendants as (
    -- Seed: each requested comment as its own root, depth 1 (not a reply).
    select c.id as root_id, c.id as descendant_id, 1 as depth
    from public.comments c
    where c.id = any(p_comment_ids)
      and c.is_deleted = false

    union all

    -- Walk down: children of whatever we found at the previous depth.
    select d.root_id, child.id, d.depth + 1
    from descendants d
    join public.comments child
      on child.parent_id = d.descendant_id
     and child.is_deleted = false
  )
  select
    root_id as comment_id,
    count(*) filter (where depth = 2) as direct_replies,
    count(*) filter (where depth > 1) as total_replies
  from descendants
  group by root_id;
$function$;

grant execute on function public.get_comment_reply_counts(uuid[]) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('get_comment_reply_counts', 'Client RPC (Activity.jsx) — takes an explicit array of comment ids from the caller (their own comments) and returns reply counts for exactly those; does not expose any comment the caller did not already have the id for')
on conflict (function_name) do nothing;
