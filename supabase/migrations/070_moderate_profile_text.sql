-- Blocks profanity/slurs in profiles.first_name and profiles.bio, kept in
-- sync with src/lib/moderation.js's checkDisplayText(), which does the
-- equivalent client-side check for immediate UX feedback. That
-- client-side check is not the real safeguard — it's reachable only
-- through the app's own UI, so this trigger is what actually closes the
-- gap (someone calling the Supabase API directly to set first_name/bio
-- would otherwise bypass any client-only check entirely, the same lesson
-- this project has hit before with RLS/policy-only gaps).
--
-- Two deliberate differences from moderate_comment()'s pattern:
--
-- 1. Blocks BOTH word tiers outright rather than letting the milder
--    review_words tier through with a flag — a display name or bio is a
--    persistent, always-visible label with no equivalent moderation queue
--    an admin would ever see, so there's no "let it through and flag for
--    later" middle ground here the way there is for a single comment.
--
-- 2. Whole-word matching only, not moderate_comment()'s substring match
--    (`normalized like '%word%'`). Substring matching is deliberately
--    loose there to catch a banned word glued onto other text, but tested
--    against real names it produces real false positives — "Hassan",
--    "Cassandra", and "assassin" all contain "ass" and would otherwise be
--    rejected outright (confirmed against a local Postgres instance before
--    writing this the tighter way). That looseness is an acceptable miss
--    for one comment among many; it's not acceptable for something that
--    can block a real person from registering under their own name.

CREATE OR REPLACE FUNCTION public.moderate_profile_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  banned_words text[] := array['nigger','nigga','faggot','fag','kike','spic','chink','gook',
    'wetback','towelhead','raghead','tranny','retard','retarded','cunt','motherfucker','motherfucking',
    'pedophile','pedo','pedofile'];
  review_words text[] := array['fuck','fucking','shit','bitch','asshole','bastard','dick',
    'pussy','cock','whore','slut','damn','ass','crap','piss','hell','idiot','moron','stupid',
    'dumb','loser','freak'];
  all_words text[];
  normalized_words text[];
begin
  all_words := banned_words || review_words;

  -- Only re-check a field that actually changed (and always check on
  -- INSERT) — same reasoning as moderate_comment()'s change-guard:
  -- without this, any unrelated profile update (avatar, country, an
  -- admin editing something else entirely) would re-run this check
  -- against text that was already accepted, for no reason.
  if (tg_op = 'INSERT' or new.first_name is distinct from old.first_name)
     and new.first_name is not null and length(trim(new.first_name)) > 0 then
    normalized_words := string_to_array(
      trim(regexp_replace(lower(regexp_replace(new.first_name, '[^a-z0-9\s]', '', 'g')), '\s+', ' ', 'g')),
      ' '
    );
    if normalized_words && all_words then
      raise exception 'That name contains language that isn''t allowed on senseUS. Please choose something else.';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.bio is distinct from old.bio)
     and new.bio is not null and length(trim(new.bio)) > 0 then
    normalized_words := string_to_array(
      trim(regexp_replace(lower(regexp_replace(new.bio, '[^a-z0-9\s]', '', 'g')), '\s+', ' ', 'g')),
      ' '
    );
    if normalized_words && all_words then
      raise exception 'That bio contains language that isn''t allowed on senseUS. Please choose something else.';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE TRIGGER moderate_profile_text_insert_update
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.moderate_profile_text();
