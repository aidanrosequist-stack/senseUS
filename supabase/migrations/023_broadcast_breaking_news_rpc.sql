-- senseUS: Move "push as breaking news" broadcast server-side
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #11):
-- Admin.jsx's pushAsBreakingNews() fetched every profile id to the
-- client via `supabase.from("profiles").select("id")` with no limit,
-- then built and inserted one notification row per user from there.
-- PostgREST caps unbounded selects at 1000 rows by default — today this
-- genuinely reaches every user, but once the user base crosses that cap
-- it would silently notify only a subset, with no error and no
-- indication to the admin.
--
-- FIX:
-- broadcast_breaking_news does the priority-flag update and the
-- notification insert entirely server-side via INSERT ... SELECT, so
-- there's no client-side row cap to hit no matter how large the user
-- base gets, and no round trip of user ids through the client at all.
-- Confirmed with the user (2026-08-21): the broadcast targets literally
-- every profile, no exceptions — same reach the original code intended,
-- just no longer silently truncated.
-- ============================================================

CREATE OR REPLACE FUNCTION public.broadcast_breaking_news(p_question_id uuid)
 RETURNS TABLE(notified_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_question_text text;
  v_expires_at timestamptz := now() + interval '48 hours';
  v_notified bigint;
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  select text into v_question_text from public.questions where id = p_question_id;
  if v_question_text is null then
    raise exception 'Question not found.';
  end if;

  update public.questions
  set is_priority = true, priority_expires_at = v_expires_at
  where id = p_question_id;

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  select
    p.id,
    'breaking_question',
    'high',
    'We want your thoughts on a new question that was just added',
    v_question_text,
    '/vote?question=' || p_question_id
  from public.profiles p;

  get diagnostics v_notified = row_count;

  return query select v_notified;
end;
$function$;

grant execute on function public.broadcast_breaking_news(uuid) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('broadcast_breaking_news', 'Client RPC (Admin.jsx) — admin-only, enforced inside the function via is_admin_user(); inserts a notification for every profile server-side, replacing a client round trip of user ids that was silently capped at 1000 by PostgREST''s default row limit')
on conflict (function_name) do nothing;
