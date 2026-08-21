-- senseUS: enforce comparison_tokens.expires_at server-side
--
-- PROBLEM (flagged in senseUS-code-audit-findings.md, confirmed in the
-- 2026-08-21 deep security review): comparison_tokens.expires_at
-- defaults to 48 hours out, and Compare.jsx tells the recipient "This
-- link expires 48 hours after you created it" — but nothing anywhere
-- (client or server) actually checked it. handleAccept() in Compare.jsx
-- did a raw `.update({ status: 'accepted', ... })` with no expiry
-- check, no RPC enforced it either, and no cron/trigger ever flipped a
-- stale row to 'expired'. An expired invite could still be accepted
-- indefinitely.
--
-- FIX: a SECURITY DEFINER RPC that does the accept, with the expiry
-- (and a couple of other correctness checks worth having at the same
-- time — a token can't be accepted twice, and a sender can't accept
-- their own link) enforced server-side where a client can't bypass it.
-- Also opportunistically flips a found-expired row's status to
-- 'expired' (a real value already in the status CHECK constraint that
-- nothing was ever writing) so a later viewer of that same link sees an
-- honest status instead of a stale 'pending'.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_comparison_token(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.comparison_tokens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select * into v_row from public.comparison_tokens where token = p_token for update;

  if v_row.id is null then
    raise exception 'Comparison link not found.';
  end if;

  if v_row.sender_id = auth.uid() then
    raise exception 'You cannot accept your own comparison link.';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'This comparison link is no longer pending.';
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    update public.comparison_tokens set status = 'expired' where id = v_row.id;
    raise exception 'This comparison link has expired.';
  end if;

  update public.comparison_tokens
  set status = 'accepted', recipient_id = auth.uid()
  where id = v_row.id;
end;
$function$;

grant execute on function public.accept_comparison_token(text) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this function
-- now has an authenticated EXECUTE grant that isn't yet on the allowlist
-- it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('accept_comparison_token', 'Client RPC (Compare.jsx) — accepts a comparison invite; enforces expiry, prevents self-accept and double-accept server-side, which the previous raw client-side update never checked')
on conflict (function_name) do nothing;
