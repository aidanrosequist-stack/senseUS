-- senseUS: "Most Commented Questions" report for AdminReports.jsx
--
-- Aidan's ask: a top-10 (configurable) list of questions ranked by real
-- comment volume, next to the existing "Question Engagement" table
-- (which ranks by vote count via get_top_questions_by_votes(), migration
-- 021). Same reasoning as that migration: rank ALL questions in Postgres
-- rather than pulling a client-side page of rows and sorting/counting in
-- JS, which would silently miss a high-comment question sitting outside
-- whatever page happened to be fetched.
--
-- Comment counting convention: filtered on `is_deleted = false` only,
-- matching get_conversation_comments()'s own filter exactly (migrations
-- 061/072/076) -- NOT further filtered on is_removed. A comment a user
-- soft-deleted-with-replies-preserved (is_removed = true, body replaced
-- with "[deleted by user]" -- see deleteComment() in Conversation.jsx)
-- is still a real row in a real thread and still counted by every other
-- comment-reading code path in this app; there's no reason this report
-- should define "a comment" any differently. is_deleted itself appears
-- to be an orphaned legacy flag at this point -- grepping the whole
-- frontend, nothing anywhere ever sets it to true, only get_conversation_
-- comments() and its siblings still filter on it (worth a closer look in
-- a future audit pass, unrelated to this feature) -- but keeping the
-- exact same filter here rather than diverging from the established
-- convention costs nothing and stays consistent if that ever changes.
--
-- Verified against a local Postgres 16 instance before shipping: correct
-- ranking across questions with 5/2/2/0 comments (including a tie),
-- Unauthorized for a non-admin caller, is_deleted=true rows excluded
-- from the count while is_removed=true rows are correctly still
-- counted, and the same greatest()/least() limit-clamping behavior
-- get_top_questions_by_votes already uses (0 -> at least 1 row, NULL ->
-- default of 10, an oversized limit capped at 100).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_top_questions_by_comments(p_limit int DEFAULT 10)
 RETURNS TABLE(id uuid, text text, domain text, human_moderation_required boolean, created_at timestamptz, comment_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select q.id, q.text, q.domain, q.human_moderation_required, q.created_at, count(c.id) as comment_count
  from public.questions q
  left join public.comments c on c.question_id = q.id and c.is_deleted = false
  group by q.id, q.text, q.domain, q.human_moderation_required, q.created_at
  order by comment_count desc, q.created_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
end;
$function$;

grant execute on function public.get_top_questions_by_comments(int) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, exactly like
-- get_daily_activity/get_top_questions_by_votes needed the same entry
-- when migration 021 added them.
insert into public.intentionally_public_functions (function_name, note) values
  ('get_top_questions_by_comments', 'Client RPC (AdminReports.jsx) — admin-only, enforced inside the function via is_admin_user(); ranks all questions by real comment count in Postgres, for the "Most Commented Questions" report')
on conflict (function_name) do nothing;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm it's admin-gated:
--    select public.get_top_questions_by_comments(10);
--    -- run as a non-admin session/role -> should raise "Unauthorized."
--
-- 2. Spot-check the count against a question you know has comments:
--    select id, text, comment_count from public.get_top_questions_by_comments(10);
--    select count(*) from public.comments where question_id = '<that question's id>' and is_deleted = false;
--    -- should match
-- ============================================================
