-- senseUS: limit country of residence to the countries senseUS is open to
--
-- Aidan's decision (2026-11-18): for now senseUS is open to the US,
-- Canada, the UK, Australia, New Zealand, the 27 EU members, Norway,
-- Switzerland, Iceland and Liechtenstein (36 countries). The motivation
-- is integrity: anyone could previously claim any country, so a
-- coordinated group abroad could skew another country's results.
--
-- The sign-up and Settings dropdowns now offer only these countries
-- (src/lib/countries.js), and the "Other" option is gone. "Other" never
-- actually worked: country_code is character(2), so 'OTHER' failed.
-- This trigger enforces the same list server-side, so it can't be
-- bypassed by calling the API directly.
--
-- It only fires when a country is being set or changed. A plain CHECK
-- constraint (even NOT VALID) would be re-evaluated on every update of
-- an existing row, so an older account with a now-unlisted country
-- would fail to save anything at all, even a bio. Here such an account
-- keeps working and keeps its country until it chooses a new one, which
-- must then be on the list. NULL stays allowed: the column has always
-- been nullable.
--
-- Keep in sync with src/lib/countries.js. Adding a country means
-- updating both. Phone numbers are restricted separately, in the app and
-- in Twilio's Geo Permissions; this covers only the stated country.

CREATE OR REPLACE FUNCTION public.enforce_allowed_country()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  allowed constant text[] := array[
    'US', 'CA', 'GB', 'AU', 'NZ',
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'CH'
  ];
begin
  if new.country_code is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.country_code is not distinct from old.country_code then
    return new;
  end if;

  if not (new.country_code = any (allowed)) then
    raise exception 'senseUS is currently open to the US, Canada, the UK, Australia, New Zealand and Europe.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_allowed_country() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_allowed_country() FROM anon;

DROP TRIGGER IF EXISTS enforce_allowed_country ON public.profiles;
CREATE TRIGGER enforce_allowed_country
  BEFORE INSERT OR UPDATE OF country_code ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_country();
