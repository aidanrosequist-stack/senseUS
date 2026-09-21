-- senseUS: word-boundary matching for comment auto-moderation, plus a
-- silent case-folding bug in the same normalization step.
--
-- CONTEXT (Aidan, 2026-09-21): a completely benign comment from a
-- middle-school teacher describing the school's no-phone policy got
-- auto-flagged for review with no obvious reason. Traced to
-- moderate_comment() (000_functions.sql): its review_words list
-- includes "ass", and the match was a bare substring check --
-- `normalized like '%ass%'` -- which matches "ass" anywhere in the
-- text, not just as its own word. The comment's "...during passing or
-- lunch" contains "ass" inside "p-ASS-ing", which is what tripped it.
-- Classic "Scunthorpe problem" -- same shape of bug as a town's name
-- getting blocked because it contains a slur as a substring.
--
-- This wasn't a one-off: several other words on the same list collide
-- with ordinary words the same way -- "hell" inside "hello", "ass"
-- inside "assignment"/"assembly"/"class" (all common in a school-
-- related comment, like this one), "crap" inside "scrapbook", "cock"
-- inside "cockpit"/"peacock". Any of these would have silently
-- flagged an innocent comment the same way.
--
-- FIX 1 -- match whole words only, not substrings. `~ ('\y' || w ||
-- '\y')` (Postgres's word-boundary regex anchor) matches "ass" as its
-- own word ("what an ass move") but not inside "passing" or
-- "assignment", the same way it still matches "hell" in "go to hell"
-- but not inside "hello". Applied to both banned_words (blocks the
-- comment outright) and review_words (flags for review), since both
-- loops had the identical substring bug.
--
-- FIX 2 -- while rewriting the normalization step, found a second,
-- separate bug in it: `lower(regexp_replace(new.body, '[^a-z0-9\s]',
-- '', 'g'))` strips non-matching characters BEFORE lowercasing, and
-- the character class only recognizes *lowercase* a-z -- so every
-- uppercase letter was being deleted outright instead of case-folded.
-- "IDIOT" (all caps) normalized to an empty string, completely
-- bypassing the filter it was supposed to be caught by; "FUCK" the
-- same. Lowercasing first fixes this: `lower(new.body)` then strip.
--
-- FIX 3 -- the normalization also used to strip punctuation (hyphens,
-- apostrophes, etc.) to nothing rather than replacing it with a space,
-- which silently glued adjacent words together -- "bull-shit" became
-- "bullshit" with no boundary between "bull" and "shit". That's
-- harmless for the old substring check, but would have let hyphenated
-- profanity slip past the new word-boundary check undetected.
-- Replacing runs of non-alphanumeric characters with a single space
-- (instead of deleting them) keeps words properly separated, so
-- "bull-shit" normalizes to "bull shit" and still matches "shit" as
-- its own word. This also folds the old two-step normalize-then-
-- collapse-whitespace into one regexp_replace call.
--
-- Verified against a local Postgres 16 instance with the real
-- banned_words/review_words arrays and word-boundary logic:
--   - the actual flagged comment (school phone-policy text) no longer
--     flags, and neither does "passing", "hello", "grasshopper",
--     "assignment", or "assembly" alone
--   - "bull-shit" (hyphenated) still correctly flags via "shit"
--   - "IDIOT"/"RETARD" (all caps) now correctly flag/block instead of
--     being silently stripped to nothing
--   - genuine standalone matches still work: "go to hell" flags on
--     "hell", "what an ass move" flags on "ass"
-- ============================================================

CREATE OR REPLACE FUNCTION public.moderate_comment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  banned_words text[] := array['nigger','nigga','faggot','fag','kike','spic','chink','gook',
    'wetback','towelhead','raghead','tranny','retard','retarded','cunt','motherfucker','motherfucking',
    'pedophile','pedo','pedofile'];
  review_words text[] := array['fuck','fucking','shit','bitch','asshole','bastard','dick',
    'pussy','cock','whore','slut','damn','ass','crap','piss','hell','idiot','moron','stupid',
    'dumb','loser','freak'];
  normalized text;
  w text;
begin
  -- Only re-run the moderation check when the actual comment text changes.
  -- Without this, any update at all (like an admin clearing a flag) would
  -- silently re-flag the comment right back based on its unchanged text.
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if new.body is null or length(trim(new.body)) = 0 then
    raise exception 'Comment cannot be empty.';
  end if;

  if length(trim(new.body)) < 2 then
    raise exception 'Comment is too short.';
  end if;

  if length(new.body) > 1000 then
    raise exception 'Comment must be under 1000 characters.';
  end if;

  -- Lowercase FIRST, then replace every run of non-alphanumeric
  -- characters with a single space (see FIX 2 / FIX 3 above) -- one
  -- pass now does what used to be a strip-then-separately-collapse-
  -- whitespace pair, and it's what keeps words separated by hyphens/
  -- apostrophes/punctuation from getting glued together.
  normalized := trim(regexp_replace(lower(new.body), '[^a-z0-9]+', ' ', 'g'));

  foreach w in array banned_words loop
    if normalized ~ ('\y' || w || '\y') then
      raise exception 'Your comment contains language that isn''t allowed on senseUS. Please revise and try again.';
    end if;
  end loop;

  new.is_flagged := false;
  foreach w in array review_words loop
    if normalized ~ ('\y' || w || '\y') then
      new.is_flagged := true;
      exit;
    end if;
  end loop;

  return new;
end;
$function$;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the live function picked up the word-boundary check:
--    select pg_get_functiondef('public.moderate_comment()'::regprocedure) like '%\y%';
--    -> should be true
--
-- 2. Re-run moderation on the comment that started this by touching
--    its body (the trigger only re-checks when body actually changes
--    -- see the UPDATE guard above -- so a no-op update won't
--    re-trigger it; append and then remove a trailing space, or ask
--    the admin to lightly edit it):
--    update comments set body = body || ' ' where id = '<that comment's id>';
--    update comments set body = trim(body) where id = '<that comment's id>';
--    -- is_flagged should end up false, assuming nothing else in the
--    -- comment matches a real word.
--
-- 3. Confirm real matches still work as expected:
--    select 'go to hell' ~ '\yhell\y';               -- true
--    select 'well hello there' ~ '\yhell\y';          -- false
--    select 'what an ass move' ~ '\yass\y';           -- true
--    select 'were just passing by' ~ '\yass\y';       -- false
-- ============================================================
