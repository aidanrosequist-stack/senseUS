-- migration: 081_harden_og_preview_edge_function.sql
--
-- Found by round-5's edge-function runtime testing harness
-- (PENETRATION_TEST_ROUND5_2026-09-14.md): `supabase/functions/og-preview`
-- exists to give link-preview crawlers (Slack, iMessage, Discord, etc.)
-- something real to render before a link is opened. Running unauthenticated
-- and reading through the service-role admin client is correct and
-- necessary -- a crawler bot has no session. The bug isn't the missing
-- login requirement; it's that the function forgot to apply the same
-- visibility rules every other read path in this app already enforces, and
-- read through the service-role client -- which bypasses RLS by design --
-- with nothing standing in for the RLS filters it was bypassing:
--
-- 1. `handleQuestionPreview` queried `questions` by `question_number`
--    alone, no `published_at`/`pulled_at` filter at all. Reproduced end to
--    end: a genuine draft (never-published) question's full text plus a
--    live vote tally was readable by guessing a sequential integer
--    (question_number is a plain sequence, migration 000). Same for a
--    question an admin PULLED for cause (071/072's own protection) --
--    still served here. Both are things RLS already hides from literally
--    everyone, including logged-in users -- this function was the one
--    read path in the app that didn't apply that filter.
--
-- 2. `handleComparePreview` looks up `comparison_tokens` by the raw token
--    with no rate limit and no audit trail, and renders the sender's real
--    display name on a hit. A guessed/wrong token returns 404, a real one
--    returns 200 -- a clean exists/doesn't-exist oracle with zero
--    per-guess cost (no account, no cooldown, nothing written to
--    anomaly_log), sitting one file away from the exact comparison-token
--    hijack/enumeration path migrations 074 and 079 spent two rounds
--    locking down on the RPC side. The 10-character token (074) still
--    isn't practically guessable at random, but nothing here would notice
--    or slow down a script trying anyway.
--
-- FIX, two parts:
--
-- 1. `handleQuestionPreview` (index.ts, not this migration) now applies
--    the exact same filter as the "Public can view published questions"
--    RLS policy (071): `published_at IS NOT NULL AND published_at <= now()
--    AND pulled_at IS NULL`. A draft or pulled question now 404s exactly
--    like a nonexistent question_number -- no separate signal leaked.
--
-- 2. `handleComparePreview` gets a per-IP rate limit backed by the table
--    and function below, plus a log_anomaly_only() entry on every miss
--    (same pattern as accept_comparison_token's 'comparison_token_guess_
--    blocked', migration 074) so a scripted sweep now shows up in
--    anomaly_log instead of leaving zero trace. This can't require auth --
--    an OG preview inherently has to work for a crawler that has no
--    session, that's the entire point of the feature -- so unlike the RPC
--    side, the fix here is throttling and visibility, not an auth check.
--    IPs are hashed (SHA-256, computed in the edge function via Deno's
--    Web Crypto, no pgcrypto dependency -- same reasoning as
--    generate_short_token avoiding pgcrypto, migration 074) before ever
--    reaching Postgres, so this table never holds a raw IP address.
-- ============================================================

-- ---------- og_preview_rate_limits: per-IP-hash fixed-window counter ----------
CREATE TABLE IF NOT EXISTS public.og_preview_rate_limits (
  ip_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0
);

-- No client (anon/authenticated) ever has a reason to read or write this
-- table -- only check_og_preview_rate_limit() below touches it, running as
-- its definer. Same "RLS enabled, zero policies, SECURITY DEFINER-only
-- access" end state as comparison_tokens (079) and the other zero-policy
-- tables noted there.
ALTER TABLE public.og_preview_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.og_preview_rate_limits FROM PUBLIC, anon, authenticated;

-- ---------- check_og_preview_rate_limit(): the throttle itself ----------
--
-- Fixed window, not sliding -- deliberately simple. p_limit is generous
-- (40 requests/minute/IP by default) because a single crawler IP can
-- legitimately fetch previews for many different senseUS links sent by
-- many different users in a short window (e.g. a messaging platform's
-- shared link-unfurling pool) -- this exists to stop a scripted sweep
-- guessing thousands of tokens, not to throttle normal preview traffic.
-- A null/empty ip_hash (no forwarded-IP header reached the function) fails
-- OPEN rather than blocking every request behind a proxy that doesn't
-- forward one -- the point of this check is added friction against
-- automated guessing, not a hard security boundary (the boundary is that
-- a wrong guess still only gets a name for a token that was already valid
-- to guess in principle, same as before -- this narrows how cheaply that
-- can be scripted, it doesn't add a new one).
CREATE OR REPLACE FUNCTION public.check_og_preview_rate_limit(
  p_ip_hash text,
  p_limit integer DEFAULT 40,
  p_window interval DEFAULT interval '1 minute'
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if p_ip_hash is null or p_ip_hash = '' then
    return true;
  end if;

  insert into public.og_preview_rate_limits (ip_hash, window_start, request_count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
    set request_count = case
          when public.og_preview_rate_limits.window_start < now() - p_window
            then 1
          else public.og_preview_rate_limits.request_count + 1
        end,
        window_start = case
          when public.og_preview_rate_limits.window_start < now() - p_window
            then now()
          else public.og_preview_rate_limits.window_start
        end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$function$;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of role-specific rules. Revoked here; this
-- function is only ever called via the service-role client inside
-- og-preview, so it needs no anon/authenticated grant and (per 052's own
-- unexpected-grants check, which only looks at anon/authenticated/PUBLIC
-- grantees) doesn't need an intentionally_public_functions entry either --
-- it genuinely isn't public.
REVOKE EXECUTE ON FUNCTION public.check_og_preview_rate_limit(text, integer, interval) FROM PUBLIC;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. select public.check_og_preview_rate_limit('test-hash-1'); -- true
--    (first request for this hash)
-- 2. Loop the same call 40 times total -- still true through the 40th.
-- 3. A 41st call within the same minute -- false.
-- 4. select * from public.og_preview_rate_limits where ip_hash =
--    'test-hash-1'; -- request_count = 41, window_start unchanged since
--    call 1.
-- 5. Wait (or manually push window_start back more than a minute), call
--    again -- true, and request_count resets to 1 / window_start resets to
--    now() (new window).
-- 6. select public.check_og_preview_rate_limit(null); -- true (fail-open
--    on a missing IP).
--
-- The og-preview edge function's own behavior (draft/pulled filtering,
-- the rate-limit call, and anomaly logging on a token miss) is verified by
-- redeploying the function and re-running round 5's harness against it --
-- not exercised by this migration alone, since that logic lives in
-- index.ts, not Postgres.
-- ============================================================
