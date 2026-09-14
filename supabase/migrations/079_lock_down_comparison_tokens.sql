-- migration: 079_lock_down_comparison_tokens.sql
--
-- CRITICAL fix, from a live pen-test Aidan requested directly
-- (senseUS-anon-comparison-tokens-findings.md, 2026-09-14):
-- comparison_tokens was readable in full by a completely unauthenticated
-- request (`GET .../comparison_tokens?select=*` with just the public
-- anon key returned every pending invite's sender_id + raw token). Root
-- cause: all three of its RLS policies were written `TO public` — the
-- Postgres pseudo-role meaning "every role, anon included" — not `TO
-- authenticated` as whoever wrote them believed. Same bug *shape* this
-- project has hit repeatedly (public_votes/public_profiles in 049, the
-- PUBLIC-pseudo-role EXECUTE leak in 052, question_snapshots in 067) —
-- migration 074's own comment even half-diagnosed this already ("'View
-- own or unclaimed tokens' lets ANY authenticated user SELECT any row
-- where recipient_id IS NULL"), just didn't realize *anon* could reach
-- it too.
--
-- Digging into the actual policy text (pulled from 041, the migration
-- that originally captured these three verbatim from production) turned
-- up two MORE problems in the same table, beyond the one the pen-test
-- doc flagged — fixing only the anon/authenticated boundary and leaving
-- these open would still be a real vulnerability, just a smaller one:
--
-- 1. THE SELECT POLICY IS UNSCOPED, NOT JUST UNAUTHENTICATED. Its
--    `recipient_id IS NULL` branch matches every pending row at once —
--    RLS is row-level, it can't tell "the client filtered on one known
--    token" from "the client asked for everything", so simply narrowing
--    `TO public` to `TO authenticated` would still let any logged-in
--    user list every pending invite in the system with no filter at
--    all, just requiring a real account first instead of zero auth.
--    "Knowing the token is enough to view that one row" is a real,
--    reasonable design for a share link (same trust model
--    accept_comparison_token already uses — whoever holds the token is
--    the intended recipient) — but RLS literally cannot express "this
--    role may see a row IF they supply its token as a filter, but may
--    NOT list many rows in one request", because a policy's USING
--    clause is evaluated per-row after any client-side filter, not
--    instead of one. The only way to actually enforce "you must supply
--    the exact token" is to require the token as a function ARGUMENT,
--    not a row-visibility predicate — hence get_comparison_token(p_token)
--    below, the same reasoning already used for get_public_profiles
--    (054) and get_conversation_comments (061) on this exact class of
--    problem.
--
-- 2. THE UPDATE POLICY LETS ANY AUTHENTICATED USER BYPASS
--    accept_comparison_token()'S OWN VALIDATION ENTIRELY, VIA A RAW
--    TABLE WRITE. "Accept or decline unclaimed tokens"'s WITH CHECK is
--    `(status = 'accepted' AND auth.uid() = recipient_id) OR status =
--    'declined'` — and since recipient_id is being SET to auth.uid() by
--    the very same UPDATE that's being checked, the accept branch is
--    trivially satisfiable by ANY authenticated caller who knows a
--    pending token's id, not just its rightful holder. That means the
--    self-accept block, the 48h expiry check, the already-processed
--    check, and the 1-second rate limit — everything
--    accept_comparison_token() (migration 074) was built specifically
--    to enforce — were all skippable by hitting the table directly with
--    `.from('comparison_tokens').update(...)` instead of calling the
--    RPC. (Compare.jsx's own handleAccept() comment already flagged
--    exactly this reasoning for why accept moved server-side — "a
--    client-side-only check can always be bypassed" — but decline never
--    got the same treatment and still uses a raw update today.) The
--    decline branch is worse: `status = 'declined'` alone, no ownership
--    check of any kind, meaning literally any authenticated user (and,
--    same anon bug as the SELECT policy, actually ANY unauthenticated
--    request too, since this policy was also `TO public`) could decline
--    a comparison invite between two total strangers — a real,
--    zero-login denial-of-service against every pending invite in the
--    system, worse once combined with the SELECT listability bug above
--    (list every pending token's id, then decline all of them).
--
-- FIX: same shape as 049/054/061/067 — stop exposing the raw table to
-- any client-facing grant at all, and route every operation through a
-- SECURITY DEFINER RPC that enforces the real rule as code, not as an
-- RLS predicate a client can route around by omitting a filter:
--
--   - create_comparison_token()      replaces the direct INSERT
--   - get_comparison_token(p_token)  replaces the direct SELECT — the
--                                    fix for problem 1, "you must name
--                                    the exact token as an argument"
--   - decline_comparison_token(p_token)  new — gives decline the exact
--                                    same validation + rate-limit
--                                    cooldown accept_comparison_token
--                                    already has (migration 074),
--                                    fixing problem 2's decline half
--   - accept_comparison_token(p_token)   unchanged (already correct,
--                                    migration 074) — fixing problem 2's
--                                    accept half just means removing the
--                                    raw UPDATE path that let a caller
--                                    skip it, not changing this function
--
-- All three new/existing RPCs are the only way to touch this table from
-- the client after this migration: all three RLS policies are dropped
-- (not narrowed — there's no client-facing raw access left to scope),
-- and REVOKE ALL closes the standing anon table-level grants the
-- pen-test found too (anon's UPDATE/DELETE returned 200/no-rows rather
-- than 42501, meaning the grant existed independent of any policy).
-- Same end state as public_profiles after migration 054: zero direct
-- grants for anon OR authenticated, every real access path goes through
-- a scoped function instead.
--
-- Verified locally against a reconstructed schema slice in Postgres 16
-- (real auth.uid()/auth.role() mocks via session GUCs, real anon/
-- authenticated roles, a seeded pending token) — see this migration's
-- companion test notes in the project doc for the full scenario list;
-- summary: anon gets zero rows on every direct table access and
-- permission-denied on every RPC; authenticated gets zero rows on any
-- direct table access (closing the listability bug) but full correct
-- behavior through all four RPCs; a direct UPDATE attempt by a random
-- authenticated user against someone else's pending token now affects
-- zero rows (closing the hijack/DoS bug); decline_comparison_token
-- correctly rate-limits, rejects already-processed and expired tokens,
-- and commits its cooldown timestamp even on a rejected call, the same
-- as accept_comparison_token; accept_comparison_token itself re-verified
-- unaffected (self-accept, expiry, rate-limit, and a real accept all
-- still behave exactly as migration 074 left them).
-- ============================================================

-- ---------- create_comparison_token(): replaces the direct INSERT ----------
CREATE OR REPLACE FUNCTION public.create_comparison_token()
RETURNS TABLE(token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  return query
    insert into public.comparison_tokens (sender_id)
    values (auth.uid())
    returning comparison_tokens.token;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_comparison_token() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_comparison_token() FROM PUBLIC;

-- ---------- get_comparison_token(): replaces the direct, listable SELECT ----------
-- The fix for problem 1 above: "knowing the token" is enforced as a
-- required function argument (the WHERE clause), not as a row-visibility
-- predicate a client could satisfy for many rows at once by omitting a
-- filter. Returns the full row shape (matches what Compare.jsx's tokenRow
-- already reads: id/sender_id/recipient_id/status, plus token/
-- created_at/expires_at for completeness — same "return the full shape,
-- not a per-call-site-trimmed subset" reasoning as get_public_profiles,
-- migration 054).
CREATE OR REPLACE FUNCTION public.get_comparison_token(p_token text)
RETURNS TABLE(
  id uuid,
  token text,
  sender_id uuid,
  recipient_id uuid,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select id, token, sender_id, recipient_id, status, created_at, expires_at
  from public.comparison_tokens
  where token = p_token;
$function$;

GRANT EXECUTE ON FUNCTION public.get_comparison_token(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_comparison_token(text) FROM PUBLIC;

-- ---------- decline_comparison_token(): replaces the direct, unchecked UPDATE ----------
-- Exact same shape as accept_comparison_token (074): same rate-limit
-- cooldown (shared last_comparison_attempt_at column — declining is
-- just as much of a token-guessing oracle via rejected_reason as
-- accepting is, and deserves the same guess-throttling), same
-- "return normally with rejected_reason instead of raising" pattern for
-- the same reason 074 documents (a RAISE EXCEPTION would roll back the
-- rate-limit timestamp write and the log_anomaly_only() call right along
-- with it). No self-decline block — unlike accept, there's no realistic
-- harm in the sender declining their own pending invite, and the
-- feature never distinguished "recipient" from "anyone holding the
-- token" for accept either.
CREATE OR REPLACE FUNCTION public.decline_comparison_token(p_token text)
RETURNS TABLE(rejected_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_row public.comparison_tokens%rowtype;
  v_last_attempt_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select p.last_comparison_attempt_at into v_last_attempt_at
  from public.profiles p where p.id = auth.uid();

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '1 second' then
    perform public.log_anomaly_only(
      'comparison_token_guess_blocked',
      'low',
      jsonb_build_object('user_id', auth.uid(), 'attempted_token', p_token, 'action', 'decline'),
      null
    );

    return query select 'rate_limited'::text as rejected_reason;
    return;
  end if;

  perform set_config('senseus.bypass_comparison_attempt_protection', 'true', true);
  update public.profiles set last_comparison_attempt_at = now() where id = auth.uid();

  select * into v_row from public.comparison_tokens where token = p_token for update;

  if v_row.id is null then
    return query select 'not_found'::text as rejected_reason;
    return;
  end if;

  if v_row.status <> 'pending' then
    return query select 'already_processed'::text as rejected_reason;
    return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    update public.comparison_tokens set status = 'expired' where id = v_row.id;
    return query select 'expired'::text as rejected_reason;
    return;
  end if;

  update public.comparison_tokens set status = 'declined' where id = v_row.id;

  return query select null::text as rejected_reason;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.decline_comparison_token(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_comparison_token(text) FROM PUBLIC;

-- ---------- Close off every direct client path to the raw table ----------
DROP POLICY IF EXISTS "View own or unclaimed tokens" ON public.comparison_tokens;
DROP POLICY IF EXISTS "Accept or decline unclaimed tokens" ON public.comparison_tokens;
DROP POLICY IF EXISTS "Create own tokens" ON public.comparison_tokens;

-- RLS stays enabled with zero policies from here — same deliberate
-- "SECURITY DEFINER-only access" end state migration 067 documented for
-- the six other zero-policy tables (authorized_admins,
-- intentionally_public_functions, etc.): nothing in src/ ever queries
-- comparison_tokens directly after this migration, every access goes
-- through the four functions above/074, which run as the function
-- owner and bypass RLS/grants by design.
REVOKE ALL ON public.comparison_tokens FROM PUBLIC, anon, authenticated;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('create_comparison_token', 'Client RPC (Compare.jsx, startNewComparison) — replaces a direct INSERT into comparison_tokens now that the table has zero standing grants. sender_id is always auth.uid(), never a client parameter. Migration 079 (2026-09-14).'),
  ('get_comparison_token', 'Client RPC (Compare.jsx, load()) — replaces a direct, unscoped SELECT on comparison_tokens that let any caller list every pending invite via select=* with no filter (RLS cannot distinguish "filtered by one known token" from "no filter" at the row level). Requiring the token as a function argument is what actually enforces "you must already know the exact token" -- the real fix for the CRITICAL finding in senseUS-anon-comparison-tokens-findings.md. Migration 079 (2026-09-14).'),
  ('decline_comparison_token', 'Client RPC (Compare.jsx, handleDecline) — replaces a raw UPDATE that had no ownership check at all (any authenticated user, and, before this migration, any unauthenticated request too, could decline a stranger''s pending invite) and bypassed accept_comparison_token''s sibling validation entirely. Same rate-limit/rejected_reason pattern as accept_comparison_token (074). Migration 079 (2026-09-14).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Direct table access is now closed for every client role:
--    select grantee, privilege_type from information_schema.table_privileges
--    where table_schema = 'public' and table_name = 'comparison_tokens';
--    -> should return nothing for anon or authenticated.
--    select policyname from pg_policies where tablename = 'comparison_tokens';
--    -> should return zero rows.
--
-- 2. The live CRITICAL finding is closed -- as a real anon-key-only
--    request (no login, matching the pen-test's own methodology):
--    GET .../rest/v1/comparison_tokens?select=*
--    -> should now return [] / Content-Range 0-0/0, not real rows.
--
-- 3. A real signed-in user can still create a link, and the recipient
--    (a second real signed-in account) can still open it, see it, and
--    accept or decline it -- full Compare.jsx flow, both directions.
--
-- 4. As a second signed-in account that is NEITHER the sender NOR
--    holder of a given real pending token's link, confirm a raw
--    `supabase.from('comparison_tokens').update({status:'declined'})
--    .eq('id', <that token's real id>)` from the browser console now
--    affects zero rows (the bug this migration closes) -- do this
--    against a throwaway test token, not a real pending invite.
-- ============================================================
