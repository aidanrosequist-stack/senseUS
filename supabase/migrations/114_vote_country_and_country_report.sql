-- senseUS: country on every vote, with a "verified" flag, and a
-- results-by-country report for B2B
--
-- Aidan's decision (2026-11-18), "Option A": nobody is excluded. Every
-- vote records the country the voter had chosen when they cast it, plus
-- whether that country matches the country their verified phone number
-- belongs to. Global results are unchanged; country reports can show
-- everyone or verified respondents only.
--
-- Why: country of residence is self-reported, so a coordinated group
-- with real phone numbers from one allowed country could pose as another
-- (migration 113 already blocks numbers from outside the 36 allowed
-- countries). It also fixes reporting: votes had no country at all, so
-- a country breakdown had to use each voter's CURRENT country, and
-- changing country moved all of someone's past votes with them.
--
-- Privacy: no phone number or phone country is stored anywhere new. The
-- country is worked out from the number Supabase Auth already holds, at
-- the moment of voting, and only the yes/no result is kept on the vote.
--
--   1. votes.country_code + votes.country_verified (both nullable).
--   2. phone_number_country(): maps an E.164 number to an allowed country
--      (or a non-allowed code, or null). The +1 area-code table was
--      generated from libphonenumber-js's full metadata, the same library
--      the app uses (src/lib/countries.js), so the two agree. Territories
--      sharing an allowed country's dialing code count as that country:
--      Guernsey/Jersey/Isle of Man as GB, Aland as FI, Svalbard as NO,
--      Vatican as IT, Christmas/Cocos Islands as AU, and Puerto Rico, the
--      US Virgin Islands, Guam, the Northern Mariana Islands and American
--      Samoa as US.
--   3. vote_country_verified(): compares the two. Never raises: if the
--      phone can't be read for any reason, the result is null ("unknown")
--      and the vote goes through, because a verification lookup must
--      never be able to block voting.
--   4. secure_vote_fields(): 007's body (the latest definition) plus the
--      stamping above. A changed vote keeps its original country.
--   5. Backfill of existing votes from each voter's current country (the
--      best information there is). Two vote triggers are switched off for
--      exactly this update and back on in the same transaction:
--      secure_vote_fields_trigger (it would recompute every vote's
--      historical pct_yes/pct_no_at_vote snapshot) and block_archived_votes
--      (it would refuse to touch votes on archived questions).
--   6. get_question_country_results(): admin-only report, per country.
--
-- Note: votes.country_verified compares against the phone at voting
-- time; changing your number or country later doesn't rewrite old votes.

-- ---- 1. New vote columns ----
alter table public.votes
  add column if not exists country_code character(2),
  add column if not exists country_verified boolean;

comment on column public.votes.country_code is
  'Voter''s country of residence when this vote was first cast. Set server-side by secure_vote_fields() (migration 114).';
comment on column public.votes.country_verified is
  'Whether country_code matched the country of the voter''s verified phone number at voting time; null = unknown. Migration 114.';

-- ---- 2. Phone number -> country ----
CREATE OR REPLACE FUNCTION public.phone_number_country(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  area_code text;
begin
  if digits = '' then
    return null;
  end if;

  -- +1: US, Canada and the Caribbean share it, split by area code.
  if left(digits, 1) = '1' then
    area_code := substr(digits, 2, 3);
    return case
      when area_code in ('204', '226', '236', '249', '250', '257', '263', '289', '306', '343', '354', '365', '367', '368', '382', '403', '416', '418', '428', '431', '437', '438', '450', '468', '474', '506', '514', '519', '548', '579', '581', '584', '587', '600', '604', '613', '622', '633', '639', '647', '672', '683', '705', '709', '742', '753', '778', '780', '782', '807', '819', '825', '867', '873', '879', '902', '905', '942') then 'CA'
      when area_code in ('242') then 'BS'
      when area_code in ('246') then 'BB'
      when area_code in ('264') then 'AI'
      when area_code in ('268') then 'AG'
      when area_code in ('284') then 'VG'
      when area_code in ('345') then 'KY'
      when area_code in ('441') then 'BM'
      when area_code in ('473') then 'GD'
      when area_code in ('649') then 'TC'
      when area_code in ('658', '876') then 'JM'
      when area_code in ('664') then 'MS'
      when area_code in ('721') then 'SX'
      when area_code in ('758') then 'LC'
      when area_code in ('767') then 'DM'
      when area_code in ('784') then 'VC'
      when area_code in ('809', '829', '849') then 'DO'
      when area_code in ('868') then 'TT'
      when area_code in ('869') then 'KN'
      else 'US'
    end;
  end if;

  -- Allowed countries' dialing codes. 3-digit codes are checked first;
  -- no 2-digit code below is the start of a different 3-digit code.
  return case left(digits, 3)
    when '351' then 'PT'
    when '352' then 'LU'
    when '353' then 'IE'
    when '354' then 'IS'
    when '356' then 'MT'
    when '357' then 'CY'
    when '358' then 'FI'
    when '359' then 'BG'
    when '370' then 'LT'
    when '371' then 'LV'
    when '372' then 'EE'
    when '385' then 'HR'
    when '386' then 'SI'
    when '420' then 'CZ'
    when '421' then 'SK'
    when '423' then 'LI'
    else case left(digits, 2)
    when '30' then 'GR'
    when '31' then 'NL'
    when '32' then 'BE'
    when '33' then 'FR'
    when '34' then 'ES'
    when '36' then 'HU'
    when '39' then 'IT'
    when '40' then 'RO'
    when '41' then 'CH'
    when '43' then 'AT'
    when '44' then 'GB'
    when '45' then 'DK'
    when '46' then 'SE'
    when '47' then 'NO'
    when '48' then 'PL'
    when '49' then 'DE'
    when '61' then 'AU'
    when '64' then 'NZ'
      else null
    end
  end;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.phone_number_country(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.phone_number_country(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.phone_number_country(text) FROM authenticated;

-- ---- 3. Does a voter's chosen country match their phone? ----
CREATE OR REPLACE FUNCTION public.vote_country_verified(p_user_id uuid, p_country text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  phone_country text;
begin
  if p_country is null then
    return null;
  end if;

  select public.phone_number_country(u.phone) into phone_country
  from auth.users u
  where u.id = p_user_id;

  if phone_country is null then
    return null;
  end if;

  return phone_country = p_country;
exception when others then
  return null;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.vote_country_verified(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vote_country_verified(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.vote_country_verified(uuid, text) FROM authenticated;

-- ---- 4. Stamp country on every new vote ----
CREATE OR REPLACE FUNCTION public.secure_vote_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_weight numeric;
  current_country text;
  yes_side numeric;
  no_side numeric;
  total numeric;
begin
  if new.choice not in ('yes','ly','ln','no','dec') then
    raise exception 'Invalid vote choice.';
  end if;

  -- integrity_weight_at_vote is set from the server only, at first
  -- vote, from the voter's own current weight. Changing a vote never
  -- updates it — documented behavior, see AUDIT_NOTES.md. The client
  -- has no influence over this value at all now.
  if tg_op = 'INSERT' then
    select integrity_weight, country_code into current_weight, current_country
    from public.profiles
    where id = new.user_id;

    new.integrity_weight_at_vote := coalesce(current_weight, 1.0000);

    -- NEW (114): the voter's country at the moment they vote, and whether
    -- it matches the country their verified phone number belongs to.
    -- Never trusted from the client, same as integrity_weight_at_vote.
    new.country_code := current_country;
    new.country_verified := public.vote_country_verified(new.user_id, current_country);
  else
    new.integrity_weight_at_vote := old.integrity_weight_at_vote;
    -- A changed vote keeps the country it was first cast under.
    new.country_code := old.country_code;
    new.country_verified := old.country_verified;
  end if;

  -- pct_yes_at_vote / pct_no_at_vote are recomputed server-side from
  -- the live weighted tally (excluding this row itself) — never
  -- trusted from the client. Matches the canonical weighted-over-
  -- weighted formula documented in AUDIT_NOTES.md.
  select
    coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes','ly')), 0),
    coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice in ('ln','no')), 0)
  into yes_side, no_side
  from public.votes v
  where v.question_id = new.question_id
    and v.id is distinct from new.id;

  total := yes_side + no_side;

  if total > 0 then
    new.pct_yes_at_vote := round((yes_side / total) * 100);
    new.pct_no_at_vote := 100 - new.pct_yes_at_vote;
  else
    new.pct_yes_at_vote := null;
    new.pct_no_at_vote := null;
  end if;

  return new;
end;
$function$;


-- ---- 5. Backfill existing votes ----
do $$
begin
  alter table public.votes disable trigger secure_vote_fields_trigger;
  alter table public.votes disable trigger block_archived_votes;

  update public.votes v
  set country_code = p.country_code,
      country_verified = public.vote_country_verified(v.user_id, p.country_code)
  from public.profiles p
  where p.id = v.user_id
    and v.country_code is null;

  alter table public.votes enable trigger secure_vote_fields_trigger;
  alter table public.votes enable trigger block_archived_votes;
end
$$;

-- ---- 6. Results-by-country report (admin only) ----
-- One row per country (including "not set"), with raw counts for every
-- respondent and for verified respondents only, plus percentages using
-- the canonical weighted-over-weighted formula (AUDIT_NOTES.md). p_as_of
-- limits it to votes cast up to that moment, matching the export's date
-- range.
CREATE OR REPLACE FUNCTION public.get_question_country_results(p_question_id uuid, p_as_of timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(
   country_code text,
   respondents bigint,
   verified_respondents bigint,
   yes_count bigint,
   ly_count bigint,
   ln_count bigint,
   no_count bigint,
   verified_yes_count bigint,
   verified_ly_count bigint,
   verified_ln_count bigint,
   verified_no_count bigint,
   pct_yes_side numeric,
   verified_pct_yes_side numeric
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  return query
  select
    v.country_code::text,
    count(*),
    count(*) filter (where v.country_verified),
    count(*) filter (where v.choice = 'yes'),
    count(*) filter (where v.choice = 'ly'),
    count(*) filter (where v.choice = 'ln'),
    count(*) filter (where v.choice = 'no'),
    count(*) filter (where v.choice = 'yes' and v.country_verified),
    count(*) filter (where v.choice = 'ly' and v.country_verified),
    count(*) filter (where v.choice = 'ln' and v.country_verified),
    count(*) filter (where v.choice = 'no' and v.country_verified),
    round(100 * sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes', 'ly'))
      / nullif(sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes', 'ly', 'ln', 'no')), 0), 1),
    round(100 * sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes', 'ly') and v.country_verified)
      / nullif(sum(v.integrity_weight_at_vote) filter (where v.choice in ('yes', 'ly', 'ln', 'no') and v.country_verified), 0), 1)
  from public.votes v
  where v.question_id = p_question_id
    and (p_as_of is null or v.created_at <= p_as_of)
  group by v.country_code
  order by count(*) desc, v.country_code nulls last;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_question_country_results(uuid, timestamp with time zone) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_question_country_results(uuid, timestamp with time zone) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_question_country_results(uuid, timestamp with time zone) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_question_country_results', 'Admin-only results-by-country report for one question (Admin -> Questions -> Question Trend, and its XLSX/PDF export). Granted to authenticated so the admin''s own session can call it; raises Unauthorized for anyone who isn''t is_admin_user(). Migration 114 (2026-11-18).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;
