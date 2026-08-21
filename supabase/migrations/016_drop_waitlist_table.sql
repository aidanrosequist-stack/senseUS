-- senseUS: Remove the waitlist feature (superseded by phone-OTP registration)
--
-- Real phone-OTP registration is now fully built and working, so the
-- "early access" gate this table backed no longer serves any purpose.
-- Home.jsx's waitlist form has been removed and now links straight to
-- /register; useRegistration.js no longer touches this table; the
-- join-waitlist edge function has been removed from config.toml (and
-- should be deleted from supabase/functions/ alongside this migration).
--
-- Safety: refuses to drop if the table still holds real signups, so a
-- routine `db push` can't silently destroy someone's data. If this
-- raises, go look at what's in there (select * from public.waitlist)
-- before deciding whether to export it first or just clear it and
-- re-run.

do $$
declare
  row_count integer;
begin
  select count(*) into row_count from public.waitlist;
  if row_count > 0 then
    raise exception 'waitlist has % row(s) — inspect before dropping (select * from public.waitlist)', row_count;
  end if;
end $$;

drop table if exists public.waitlist;
