-- senseUS: Compute vote-history comparisons server-side
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #9):
-- Compare.jsx pulled both accounts' entire vote histories (unbounded —
-- no limit on either query) to the client, intersected them in JS to
-- find shared questions, then fetched every one of those shared
-- questions in a separate round trip. For two long-tenured users this
-- is an ever-growing full-history download on both sides, just to
-- surface the handful of questions they've both actually answered.
--
-- FIX:
-- get_comparison computes the intersection directly with a self-join on
-- votes (mine vs. the other account), excludes undecided ('dec') votes
-- on either side the same way the old JS filter did, and joins
-- questions in the same query — so only the shared rows the UI actually
-- needs ever cross the wire, and it's one round trip instead of three.
--
-- Trust model: this doesn't change what's exposed versus before. The
-- client already read any authenticated user's full vote history and
-- profile directly via the public_votes/public_profiles views with no
-- additional gating beyond being signed in — this function reads the
-- same underlying data (the "other" side, via p_other_id) at the same
-- trust level, just already filtered down to the intersection instead
-- of handing back everything for the client to filter.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_comparison(p_other_id uuid)
 RETURNS TABLE(question_id uuid, mine text, theirs text, question_text text, domain text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    mv.question_id,
    mv.choice as mine,
    tv.choice as theirs,
    q.text as question_text,
    q.domain
  from public.votes mv
  join public.votes tv
    on tv.question_id = mv.question_id
   and tv.user_id = p_other_id
  join public.questions q
    on q.id = mv.question_id
  where mv.user_id = auth.uid()
    and mv.choice <> 'dec'
    and tv.choice <> 'dec';
$function$;

grant execute on function public.get_comparison(uuid) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('get_comparison', 'Client RPC (Compare.jsx) — "mine" is derived from auth.uid() internally, not a client parameter; "theirs" (p_other_id) is read at the same trust level the client already had via direct public_votes/public_profiles reads (any authenticated user), just pre-intersected server-side instead of downloaded in full')
on conflict (function_name) do nothing;
