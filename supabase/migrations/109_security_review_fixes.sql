-- senseUS: fixes from the 2026-11-07 security review
--
-- Four independent fixes, each in its own section below:
--
--   1. Display-name privacy: four client RPCs sent every user's real
--      first_name/last_initial to the browser regardless of their
--      display_preference, and relied on the frontend's getDisplayName()
--      to hide them. Anyone logged in could read an "anonymous"
--      commenter's real first name + last initial in devtools (and, since
--      migration 105, an "anonymous" award giver's -- including the giver
--      of a negative award). Now resolved server-side: first_name is null
--      for 'anon', last_initial is null for 'anon' and 'first_only'. The
--      ?Party functions and the 107 award notification already did this.
--      No frontend change needed -- every getDisplayName() only reads
--      anon_name for 'anon' and only first_name for 'first_only'.
--
--   2. Pulled questions: migration 071 hides a pulled question's thread
--      from everyone but admins via RLS on comments. These RPCs are
--      SECURITY DEFINER, which bypasses RLS, and never checked pulled_at,
--      so the thread stayed readable through the API by question id.
--      Each now applies the same rule the comments SELECT policy uses
--      (is_admin_user() OR question not pulled). give_comment_award() also
--      now refuses comments on pulled questions and removed comments.
--
--   3. calculate_all_integrity_weights(): migration 026 pinned its
--      search_path via ALTER FUNCTION, but CREATE OR REPLACE resets every
--      property the command doesn't restate, so 094/096/108 each silently
--      un-pinned it again. Pinned here with ALTER FUNCTION, which leaves
--      108's body untouched. Any future CREATE OR REPLACE of it must
--      include SET search_path TO 'public' in its header.
--
--   4. party_name (migration 104) had a 60-character limit only in the
--      browser and no content check. Adds a 60-character CHECK and rejects
--      the same banned (slur) list comments reject. The banned list moves
--      into one shared helper, text_contains_banned_word(), so comments
--      and party names can't drift apart; moderate_comment() is otherwise
--      carried forward unchanged from migration 087.
--
-- All function bodies below are carried forward from their most recent
-- CREATE (OR REPLACE): get_conversation_comments + get_comment_award_details
-- (105), get_pinned_comments (077), get_public_profiles (054),
-- give_comment_award (107), moderate_comment (087). CREATE OR REPLACE with
-- unchanged signatures keeps existing grants.

-- =====================================================================
-- 1 + 2. Comment-thread RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_conversation_comments(p_question_id uuid)
 RETURNS TABLE(
   id uuid,
   body text,
   resonance_count integer,
   created_at timestamp with time zone,
   parent_id uuid,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   vote_choice text,
   original_body text,
   original_vote_choice text,
   previous_body text,
   previous_vote_choice text,
   edit_count integer,
   award_counts jsonb
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.body,
    c.resonance_count,
    c.created_at,
    c.parent_id,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    case when p.display_preference = 'anon' then null else p.first_name end as first_name,
    case when p.display_preference in ('anon', 'first_only') then null else p.last_initial end as last_initial,
    p.display_preference,
    p.anon_name,
    c.vote_choice_at_comment as vote_choice,
    c.original_body,
    c.original_vote_choice,
    c.previous_body,
    c.previous_vote_choice,
    c.edit_count,
    (
      select jsonb_object_agg(ca.award_type, ca.cnt)
      from (
        select award_type, count(*) as cnt
        from public.comment_awards
        where comment_id = c.id
        group by award_type
      ) ca
    ) as award_counts
  from public.comments c
  left join public.profiles p on p.id = c.user_id
  where c.question_id = p_question_id
    and c.is_deleted = false
    -- Same visibility rule as the comments SELECT policy (migration 071).
    and (
      (select public.is_admin_user())
      or exists (
        select 1 from public.questions q
        where q.id = c.question_id and q.pulled_at is null
      )
    )
  order by c.resonance_count desc
  limit 500;
$function$;

CREATE OR REPLACE FUNCTION public.get_comment_award_details(p_comment_id uuid)
 RETURNS TABLE(
   award_type text,
   given_at timestamp with time zone,
   is_own boolean,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    ca.award_type,
    ca.created_at as given_at,
    (ca.giver_id = auth.uid()) as is_own,
    case when p.display_preference = 'anon' then null else p.first_name end as first_name,
    case when p.display_preference in ('anon', 'first_only') then null else p.last_initial end as last_initial,
    p.display_preference,
    p.anon_name
  from public.comment_awards ca
  join public.profiles p on p.id = ca.giver_id
  join public.comments c on c.id = ca.comment_id
  join public.questions q on q.id = c.question_id
  where ca.comment_id = p_comment_id
    and c.is_deleted = false
    and (q.pulled_at is null or (select public.is_admin_user()))
  order by ca.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_pinned_comments()
 RETURNS TABLE(
   comment_id uuid,
   pinned_at timestamp with time zone,
   body text,
   created_at timestamp with time zone,
   edited_at timestamp with time zone,
   is_removed boolean,
   is_own boolean,
   question_id uuid,
   question_text text,
   question_number integer,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   vote_choice text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id as comment_id,
    pc.created_at as pinned_at,
    c.body,
    c.created_at,
    c.edited_at,
    c.is_removed,
    (c.user_id = auth.uid()) as is_own,
    q.id as question_id,
    q.text as question_text,
    q.question_number,
    case when p.display_preference = 'anon' then null else p.first_name end as first_name,
    case when p.display_preference in ('anon', 'first_only') then null else p.last_initial end as last_initial,
    p.display_preference,
    p.anon_name,
    c.vote_choice_at_comment as vote_choice
  from public.pinned_comments pc
  join public.comments c on c.id = pc.comment_id
  join public.questions q on q.id = c.question_id
  left join public.profiles p on p.id = c.user_id
  where pc.user_id = auth.uid()
    and c.is_deleted = false
    -- Pins on a pulled question are hidden, not deleted: they reappear if
    -- the question is ever un-pulled.
    and (q.pulled_at is null or (select public.is_admin_user()))
  order by pc.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_profiles(p_user_ids uuid[])
 RETURNS TABLE(
   id uuid,
   first_name text,
   last_initial character(1),
   display_preference text,
   anon_name text,
   avatar text,
   bio text,
   resonance_tier text,
   badges text[]
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id,
         case when p.display_preference = 'anon' then null else p.first_name end,
         case when p.display_preference in ('anon', 'first_only') then null else p.last_initial end,
         p.display_preference,
         p.anon_name, p.avatar, p.bio, p.resonance_tier, p.badges
  from public.profiles p
  where p.id = any(p_user_ids)
    and array_length(p_user_ids, 1) <= 500;
$function$;

CREATE OR REPLACE FUNCTION public.give_comment_award(p_comment_id uuid, p_award_type text)
 RETURNS smallint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_cost smallint;
  v_comment_owner uuid;
  v_question_id uuid;
  v_current_month date := date_trunc('month', now())::date;
  v_remaining smallint;
  v_giver_name text;
  v_award_label text;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  select cost into v_cost
  from public.award_types
  where id = p_award_type;

  if v_cost is null then
    raise exception 'Unknown award type: %', p_award_type;
  end if;

  -- 109: also excludes removed comments and comments on pulled questions.
  select c.user_id, c.question_id into v_comment_owner, v_question_id
  from public.comments c
  join public.questions q on q.id = c.question_id
  where c.id = p_comment_id
    and c.is_deleted = false
    and c.is_removed = false
    and q.pulled_at is null;

  if v_comment_owner is null then
    raise exception 'Comment not found.';
  end if;

  if v_comment_owner = v_user_id then
    raise exception 'You can''t give an award to your own comment.';
  end if;

  if exists (
    select 1 from public.comment_awards
    where giver_id = v_user_id and comment_id = p_comment_id and award_type = p_award_type
  ) then
    raise exception 'You''ve already given this award to this comment.';
  end if;

  perform set_config('senseus.bypass_award_points_protection', 'true', true);

  update public.profiles
  set award_points_remaining = 5,
      award_points_reset_month = v_current_month
  where id = v_user_id
    and award_points_reset_month < v_current_month;

  update public.profiles
  set award_points_remaining = award_points_remaining - v_cost
  where id = v_user_id
    and award_points_remaining >= v_cost
  returning award_points_remaining into v_remaining;

  if v_remaining is null then
    raise exception 'Not enough awards remaining this month.';
  end if;

  insert into public.comment_awards (comment_id, giver_id, award_type)
  values (p_comment_id, v_user_id, p_award_type);

  select
    case
      when p.display_preference = 'anon' then coalesce(p.anon_name, 'Someone')
      when p.display_preference = 'first_only' then coalesce(p.first_name, 'Someone')
      else coalesce(p.first_name || ' ' || p.last_initial || '.', 'Someone')
    end
  into v_giver_name
  from public.profiles p
  where p.id = v_user_id;

  v_award_label := case p_award_type
    when 'gold-star' then 'Gold Star'
    when 'needs-work' then 'Needs Work'
    when 'well-argued' then 'Well-Argued'
    when 'changed-my-mind' then 'Changed My Mind'
    when 'brought-receipts' then 'Brought Receipts'
    when 'made-me-laugh' then 'Made Me Laugh'
    when 'fair-and-balanced' then 'Fair & Balanced'
    when 'good-faith-disagreement' then 'Good-Faith Disagreement'
    when 'taught-me-something' then 'Taught Me Something'
    when 'needs-a-source' then 'Needs a Source'
    when 'off-topic' then 'Off-Topic'
    when 'spelling-grammar' then 'Spelling & Grammar'
    else p_award_type
  end;

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  values (
    v_comment_owner,
    'comment_awarded',
    'normal',
    '🏷️ ' || v_giver_name || ' gave your comment "' || v_award_label || '"',
    'See it on your comment.',
    '/conversation/' || v_question_id || '#comment-' || p_comment_id
  );

  return v_remaining;
end;
$function$;

-- =====================================================================
-- 3. Re-pin calculate_all_integrity_weights()'s search_path
-- =====================================================================

ALTER FUNCTION public.calculate_all_integrity_weights() SET search_path TO 'public';

-- =====================================================================
-- 4. party_name: length cap + banned-word check
-- =====================================================================

-- Shared banned (slur) list, previously inline in moderate_comment().
-- Same normalization and word-boundary matching as migration 087.
CREATE OR REPLACE FUNCTION public.text_contains_banned_word(p_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  banned_words text[] := array['nigger','nigga','faggot','fag','kike','spic','chink','gook',
    'wetback','towelhead','raghead','tranny','retard','retarded','cunt','motherfucker','motherfucking',
    'pedophile','pedo','pedofile'];
  normalized text;
  w text;
begin
  if p_text is null then
    return false;
  end if;

  normalized := trim(regexp_replace(lower(p_text), '[^a-z0-9]+', ' ', 'g'));

  foreach w in array banned_words loop
    if normalized ~ ('\y' || w || '\y') then
      return true;
    end if;
  end loop;

  return false;
end;
$function$;

-- moderate_comment() is an ordinary (invoker) trigger, so the commenting
-- user needs EXECUTE on the helper.
GRANT EXECUTE ON FUNCTION public.text_contains_banned_word(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.text_contains_banned_word(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.text_contains_banned_word(text) FROM anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('text_contains_banned_word', 'Shared banned-word check used by moderate_comment() (comments) and enforce_party_name_rules() (party names). Granted to authenticated because moderate_comment() is an invoker trigger that runs as the commenting user. Pure function of its argument: reads no tables, exposes nothing but whether the given text matches the list. Migration 109 (2026-11-07).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- Carried forward from 087 unchanged, except the banned-word loop now
-- calls the shared helper.
CREATE OR REPLACE FUNCTION public.moderate_comment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  review_words text[] := array['fuck','fucking','shit','bitch','asshole','bastard','dick',
    'pussy','cock','whore','slut','damn','ass','crap','piss','hell','idiot','moron','stupid',
    'dumb','loser','freak'];
  normalized text;
  w text;
begin
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

  normalized := trim(regexp_replace(lower(new.body), '[^a-z0-9]+', ' ', 'g'));

  if public.text_contains_banned_word(new.body) then
    raise exception 'Your comment contains language that isn''t allowed on senseUS. Please revise and try again.';
  end if;

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

-- Length cap. NOT VALID so this can't fail on any existing row (the
-- browser has always capped at 60, so there shouldn't be any); it is
-- still enforced on every new insert and update.
ALTER TABLE public.question_parties
  ADD CONSTRAINT question_parties_party_name_length
  CHECK (party_name IS NULL OR char_length(party_name) <= 60) NOT VALID;

-- Banned-word check, as a trigger so the error message is readable
-- (a CHECK violation would surface as a raw constraint name).
CREATE OR REPLACE FUNCTION public.enforce_party_name_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.party_name is not null and public.text_contains_banned_word(new.party_name) then
    raise exception 'That party name contains language that isn''t allowed on senseUS. Please choose another.';
  end if;
  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.enforce_party_name_rules() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_party_name_rules() FROM anon;

DROP TRIGGER IF EXISTS enforce_party_name_rules ON public.question_parties;
CREATE TRIGGER enforce_party_name_rules
  BEFORE INSERT OR UPDATE OF party_name ON public.question_parties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_party_name_rules();
