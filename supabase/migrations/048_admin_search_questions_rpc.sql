-- senseUS: admin-scoped question search for the Admin.jsx Questions tab.
--
-- PROBLEM: the Questions tab loads at most the 500 most-recently-created
-- questions (loadQuestions(), capped in an earlier scaling fix) and has
-- no search of its own. An admin trying to find an older question, or
-- one that's unpublished/archived and so wouldn't be sitting near the
-- top of that capped list, has no way to find it in the UI at all.
--
-- The existing search_questions() RPC (migration 018) can't be reused
-- as-is -- it's deliberately scoped to what a normal user should be able
-- to search (published, non-archived questions only), which is exactly
-- the wrong scope for an admin who specifically needs to find drafts and
-- archived questions to manage them.
--
-- FIX: a second, admin-only search RPC against the full table, no
-- publish-status filter, matching on text OR category OR domain (so
-- typing e.g. "hot take" finds every question in that category, not
-- just ones whose text happens to contain those words).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_search_questions(p_query text, p_limit int DEFAULT 100)
 RETURNS SETOF public.questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select *
  from public.questions
  where p_query is not null
    and length(trim(p_query)) > 0
    and (
      text ilike '%' || trim(p_query) || '%'
      or category ilike '%' || trim(p_query) || '%'
      or domain ilike '%' || trim(p_query) || '%'
    )
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_search_questions(text, int) TO authenticated;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('admin_search_questions', 'Client RPC (Admin.jsx, Questions tab) — admin-only, enforced inside the function via is_admin_user(); searches the full questions table (including unpublished/archived) by text/category/domain, independent of the 500-row cap on the tab''s initial load.')
ON CONFLICT (function_name) DO NOTHING;
