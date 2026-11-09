-- senseUS: mark existing accounts as already welcomed
--
-- Found 2026-11-09: Aidan signed in through the sign-up page from
-- Facebook's in-app browser and got a second welcome text.
--
-- Migration 057 added profiles.welcome_sms_sent_at as the once-per-account
-- guard for send-welcome-sms, but never backfilled it. Every account
-- created before 057 kept a null value, so the first time one of them went
-- through sign-up again, claim_welcome_sms_send() saw "never sent" and the
-- text went out.
--
-- The same commit fixes the sign-up flow itself (useRegistration.js), so
-- existing accounts are now signed straight in and never reach the step
-- that sends the welcome text. This backfill closes the gap independently,
-- in case any other path ever calls send-welcome-sms for an old account.
--
-- Marks every account more than a day old whose flag is still null, using
-- its own created_at as the timestamp. That covers everyone from before
-- 057 regardless of when 057 was applied. Accounts created after 057 have
-- the flag set already, unless their send failed; nothing ever retries a
-- welcome text after sign-up, so marking those changes nothing.
-- The one-day margin leaves any sign-up happening right now untouched.
--
-- protect_admin_columns() normally freezes this column; the documented
-- bypass setting (migration 057) is used so the update applies regardless
-- of the role this migration runs as. It is transaction-local, so it and
-- the update share one DO block (one transaction) on purpose: as separate
-- statements outside an explicit transaction, the setting would expire
-- before the update ran and the guard would silently undo it.

do $$
begin
  perform set_config('senseus.bypass_welcome_sms_sent_at_protection', 'true', true);

  update public.profiles
  set welcome_sms_sent_at = created_at
  where welcome_sms_sent_at is null
    and created_at < now() - interval '1 day';

  perform set_config('senseus.bypass_welcome_sms_sent_at_protection', '', true);
end
$$;
