-- senseUS: Server-side question search
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #7):
-- Explore.jsx's search box ran a client-side .filter()/.includes() scan
-- over the entire loaded question catalog on every keystroke. That was
-- workable while the catalog fetch was itself unbounded (search reached
-- everything), but the same audit pass caps that catalog fetch at the
-- 500 most recently published questions to put a ceiling on the payload
-- the domain-row browsing UI loads (see Explore.jsx). Once that cap is
-- in place, client-side search over the capped array would silently stop
-- finding older questions — a real regression, not just a performance one.
--
-- FIX:
-- A dedicated search RPC that runs against the full questions table
-- server-side, independent of whatever subset the browse view has
-- loaded. The client now debounces keystrokes and calls this once
-- typing pauses, instead of filtering in the browser on every keystroke.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_questions(p_query text, p_limit int DEFAULT 40)
 RETURNS SETOF public.questions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select *
  from public.questions
  where published_at is not null
    and published_at <= now()
    and archived_at is null
    and p_query is not null
    and length(trim(p_query)) > 0
    and text ilike '%' || trim(p_query) || '%'
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 100));
$function$;

grant execute on function public.search_questions(text, int) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('search_questions', 'Client RPC (Explore.jsx) — read-only search over published, non-archived questions; no user-specific data, replaces an unbounded client-side catalog scan')
on conflict (function_name) do nothing;
