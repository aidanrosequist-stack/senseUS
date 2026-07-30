-- senseUS: Export pipeline foundation
--
-- Requires a recovery_email on file before an export can be requested
-- (enforced server-side, not just in the UI — a client-side-only check
-- would be trivially bypassable the same way everything else in this
-- audit was). Also creates the private storage bucket the processing
-- function writes into, and schedules the processing cron.
-- ============================================================

CREATE OR REPLACE FUNCTION public.require_recovery_email_for_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_email boolean;
begin
  select (recovery_email is not null and recovery_email != '')
  into has_email
  from public.profiles
  where id = new.user_id;

  if not coalesce(has_email, false) then
    raise exception 'A recovery email is required before requesting a data export. Add one in Settings first.';
  end if;

  return new;
end;
$function$;

drop trigger if exists require_recovery_email_for_export_trigger on public.exports;
create trigger require_recovery_email_for_export_trigger
before insert on public.exports
for each row
execute function public.require_recovery_email_for_export();

-- Private bucket — no public access, no client-facing RLS policy is
-- added on purpose. Only the service role (used exclusively by the
-- process-pending-exports Edge Function) ever writes to or reads from
-- this bucket directly; users only ever see a time-limited signed URL
-- generated server-side, which works independently of RLS/bucket
-- policies. A bucket with no policies and public=false already denies
-- all direct client access by default.
insert into storage.buckets (id, name, public)
values ('user-exports', 'user-exports', false)
on conflict (id) do nothing;

-- Runs every 15 minutes, picks up any pending exports and processes them.
select cron.schedule(
  'process-pending-exports',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://gckjlshfesyxualwxurj.functions.supabase.co/process-pending-exports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
