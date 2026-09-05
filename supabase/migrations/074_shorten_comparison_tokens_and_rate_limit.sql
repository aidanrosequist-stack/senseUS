-- migration: 074_shorten_comparison_tokens_and_rate_limit.sql
--
-- CONTEXT (Aidan, 2026-09-05): two questions about the comparison-vote
-- share link — can it be shorter, and why doesn't it get a link preview
-- like a question share does (that second half is addressed by the new
-- og-preview branch + vercel.json rewrite shipped alongside this
-- migration, not here).
--
-- On shortening: comparison_tokens.token defaults to a full
-- gen_random_uuid()::text (~122 bits of entropy) — genuinely the only
-- thing standing between a stranger and someone else's pending
-- comparison invite. Checked the RLS: "View own or unclaimed tokens"
-- lets ANY authenticated user SELECT any row where recipient_id IS NULL
-- (i.e. any still-pending invite, not just ones addressed to them), and
-- accept_comparison_token() had no rate limiting at all — so the token's
-- own randomness was carrying the entire security load, with unlimited
-- guesses. Aidan's call: shorten it AND add rate limiting, so the
-- shorter token doesn't quietly lower the actual security bar.
--
-- FIX, two parts:
--
-- 1. comparison_tokens.token's DEFAULT becomes a 10-character
--    alphanumeric string (generate_short_token()) instead of a full
--    UUID — 62^10 ≈ 8.4×10^17 possibilities, still nowhere near
--    guessable by hand, and combined with part 2 below, nowhere near
--    guessable by script either. Existing rows keep whatever token they
--    already have (a DEFAULT only affects future inserts) — both
--    lengths validate identically since lookup is just an exact string
--    match, so this is fully backward compatible with any link already
--    sent out.
--
-- 2. accept_comparison_token() gets the exact same cooldown pattern
--    cast_vote() already uses against machine-speed abuse (migration
--    055): a 1-second minimum spacing between calls from the same
--    account, tracked in a new profiles.last_comparison_attempt_at
--    column (locked by protect_admin_columns() the same way
--    last_vote_at is, so a direct client write can't reset it and
--    defeat the cooldown), with every blocked attempt logged to
--    anomaly_log for a queryable trail. Same reasoning as 055 for why
--    this returns normally with a rejected_reason column instead of
--    raising: a RAISE EXCEPTION rolls back the whole transaction,
--    including the very log_anomaly_only() insert meant to survive it.
--    accept_comparison_token's signature changes from `RETURNS void` to
--    `RETURNS TABLE(rejected_reason text)` for this reason — and, found
--    during local testing, its other pre-existing rejections (not found,
--    expired, self-accept, already-processed) had to move off plain
--    RAISE EXCEPTION too, for the same rollback reason: each of those
--    checks runs AFTER the last_comparison_attempt_at update earlier in
--    the same call, so a raised exception there was rolling that
--    timestamp write back right along with it — meaning a run of bad
--    token guesses (exactly the abuse case the rate limit exists for)
--    never actually tripped the cooldown on the next guess. All four now
--    return normally via rejected_reason ('not_found', 'self_accept',
--    'already_processed', 'expired') so the timestamp always commits.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_comparison_attempt_at timestamptz;

-- ---------- generate_short_token(): the new, shorter token source ----------
--
-- One gen_random_bytes() draw per character, mapped into a 62-symbol
-- alphabet via modulo. This has a small, known modulo bias (256 isn't
-- evenly divisible by 62, so the lowest 8 symbols in the alphabet are
-- ~1.6% more likely than the rest) — acceptable here: this is a
-- shareable invite link, not a cryptographic key, and the bias doesn't
-- meaningfully reduce the ~59.5 bits of entropy at length 10 (log2(62)
-- * 10), which combined with the rate limit below is already far beyond
-- anything worth brute-forcing.
CREATE OR REPLACE FUNCTION public.generate_short_token(p_length integer DEFAULT 10)
 RETURNS text
 LANGUAGE sql
 VOLATILE
AS $function$
  select string_agg(
    substr(
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      (get_byte(gen_random_bytes(1), 0) % 62) + 1,
      1
    ),
    ''
  )
  from generate_series(1, p_length);
$function$;

GRANT EXECUTE ON FUNCTION public.generate_short_token(integer) TO authenticated;

-- See migration 052 -- every CREATE FUNCTION gets an automatic PUBLIC
-- EXECUTE grant regardless of any anon/authenticated-specific ALTER
-- DEFAULT PRIVILEGES rule. Revoked here explicitly, same as every other
-- function this project has added since that finding. `authenticated`
-- needs its own grant above because comparison_tokens' INSERT (which
-- evaluates this as the token column's DEFAULT) only ever happens as an
-- authenticated user in the first place ("Create own tokens" requires
-- auth.uid() = sender_id) -- anon never inserts a row here.
REVOKE EXECUTE ON FUNCTION public.generate_short_token(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_short_token(integer) FROM anon;

ALTER TABLE public.comparison_tokens
  ALTER COLUMN token SET DEFAULT public.generate_short_token(10);

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('generate_short_token', 'Not a client RPC -- evaluated server-side as comparison_tokens.token''s DEFAULT expression on INSERT. Needs an authenticated EXECUTE grant because evaluating a column DEFAULT still checks the inserting role''s privileges even though the function itself is not SECURITY DEFINER. Migration 074 (2026-09-05), replacing the previous full-UUID token with a shorter one.')
ON CONFLICT (function_name) DO NOTHING;

-- ---------- protect_admin_columns(): lock the new cooldown timestamp ----------
--
-- Same bypass-flag pattern as last_vote_at (migration 055) -- without
-- this, a user could directly `.from('profiles').update({
-- last_comparison_attempt_at: null })` and defeat the cooldown entirely,
-- the same gap migration 055 closed for last_vote_at.
CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() != 'service_role' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.integrity_weight := 1.0000;
      new.answers_count := 0;
      new.resonance_score := 50;
      new.resonance_tier := 'Independent';
      new.streak_days := 0;
      new.longest_streak := 0;
      new.replies_count := 0;
      new.likes_received := 0;
      new.tier := 'newcomer';
      new.badges := '{}';
      new.voip_flagged_at := null;
      new.country_changed_at := null;
      new.created_at := now();
      new.last_vote_at := null;
      new.last_comparison_attempt_at := null;
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      if coalesce(current_setting('senseus.bypass_last_vote_at_protection', true), '') <> 'true' then
        new.last_vote_at := old.last_vote_at;
      end if;
      if coalesce(current_setting('senseus.bypass_comparison_attempt_protection', true), '') <> 'true' then
        new.last_comparison_attempt_at := old.last_comparison_attempt_at;
      end if;
      new.is_admin := old.is_admin;
      new.integrity_weight := old.integrity_weight;
      new.resonance_score := old.resonance_score;
      new.resonance_tier := old.resonance_tier;
      new.streak_days := old.streak_days;
      new.longest_streak := old.longest_streak;
      new.replies_count := old.replies_count;
      new.likes_received := old.likes_received;
      new.tier := old.tier;
      new.badges := old.badges;
      new.voip_flagged_at := old.voip_flagged_at;
      new.country_changed_at := old.country_changed_at;
      new.created_at := old.created_at;
      new.id := old.id;
    end if;
  end if;

  return new;
end;
$function$;

-- ---------- accept_comparison_token(): add the rate limit ----------
--
-- DROP + CREATE because the return type is changing (void ->
-- RETURNS TABLE(rejected_reason text)) -- CREATE OR REPLACE can't do
-- that, same reason every other RETURNS-TABLE change in this project
-- has needed a DROP first.
DROP FUNCTION IF EXISTS public.accept_comparison_token(text);

CREATE FUNCTION public.accept_comparison_token(p_token text)
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
    -- Same "return normally, don't raise" reasoning as cast_vote's own
    -- cooldown (migration 055): a RAISE EXCEPTION here would roll back
    -- this same transaction's log_anomaly_only() insert right along
    -- with it, defeating the point of a durable trail.
    perform public.log_anomaly_only(
      'comparison_token_guess_blocked',
      'low',
      jsonb_build_object('user_id', auth.uid(), 'attempted_token', p_token),
      null
    );

    return query select 'rate_limited'::text as rejected_reason;
    return;
  end if;

  perform set_config('senseus.bypass_comparison_attempt_protection', 'true', true);
  update public.profiles set last_comparison_attempt_at = now() where id = auth.uid();

  select * into v_row from public.comparison_tokens where token = p_token for update;

  -- These four checks used to RAISE EXCEPTION (028 baseline). Found during
  -- local testing that a raised exception rolls back the ENTIRE
  -- transaction, including the last_comparison_attempt_at update just
  -- above -- so a run of bad-token guesses (exactly the abuse case the
  -- rate limit exists for) would each roll their own timestamp write
  -- back and never actually trip the 1-second check on the next guess.
  -- Switched to the same "return normally, don't raise" pattern as the
  -- rate-limit branch above (and cast_vote's cooldown, migration 055) so
  -- the timestamp commits regardless of outcome. The client (Compare.jsx)
  -- now reads these off `rejected_reason` instead of a thrown error.
  if v_row.id is null then
    return query select 'not_found'::text as rejected_reason;
    return;
  end if;

  if v_row.sender_id = auth.uid() then
    return query select 'self_accept'::text as rejected_reason;
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

  update public.comparison_tokens
  set status = 'accepted', recipient_id = auth.uid()
  where id = v_row.id;

  return query select null::text as rejected_reason;
end;
$function$;

grant execute on function public.accept_comparison_token(text) to authenticated;
revoke execute on function public.accept_comparison_token(text) from public;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('accept_comparison_token', 'Client RPC (Compare.jsx) — accepts a comparison invite; enforces expiry, prevents self-accept and double-accept server-side. Migration 074 (2026-09-05): added a 1-second-minimum-spacing rate limit (same pattern as cast_vote''s cooldown) now that the token itself is shorter, and changed from RETURNS void to RETURNS TABLE(rejected_reason text) so every rejection (rate_limited, not_found, self_accept, already_processed, expired) can return normally instead of raising — necessary so the rate-limit timestamp write always commits, even on a bad-token guess.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. New comparison tokens are short:
--    insert into comparison_tokens (sender_id) values ('<a real user id>') returning token;
--    -> a 10-character alphanumeric string, not a UUID.
--
-- 2. An existing (pre-migration) long-UUID token still works exactly as
--    before -- accept_comparison_token() doesn't care about length.
--
-- 3. Two accept_comparison_token calls from the same account under 1
--    second apart, EVEN WHEN BOTH ARE BAD/UNKNOWN TOKENS -- the second
--    call returns rejected_reason = 'rate_limited', not 'not_found'.
--    (This is the case that was actually broken before the fix above:
--    the first bad-token call's timestamp write was getting rolled back
--    by its own RAISE EXCEPTION, so the second call never saw it.)
--
-- 4. The same two calls spaced more than 1 second apart both proceed to
--    the real lookup logic (rejected_reason null on a real pending
--    token, or 'not_found' / 'self_accept' / 'already_processed' /
--    'expired' as appropriate) -- none of these raise an exception
--    anymore, so `error` from the client's .rpc() call stays null.
--
-- 5. Confirm last_comparison_attempt_at can't be reset directly:
--    as a non-admin, `update profiles set last_comparison_attempt_at = null
--    where id = auth.uid()` should silently have no effect on that column
--    (protect_admin_columns_trigger reverts it).
