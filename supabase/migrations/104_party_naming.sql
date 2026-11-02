-- Let the host name the ?Party! itself, not just the underlying curated
-- list -- per Aidan's 2026-11-02 brainstorm ask for a personalization
-- touch. Optional at creation (nullif(trim(...), '') normalizes a blank
-- entry to NULL); no rename-after-creation flow in this pass -- a minor
-- follow-up if Aidan wants it, same shape as party_lists' own rename.
--
-- All five touched functions carry forward their full current bodies
-- VERBATIM -- four from migration 098_party_lists_capacity_submission.sql
-- (confirmed via grep that nothing since has redefined them), and
-- get_party_results() from migration 102_party_exclamation_point.sql
-- instead (today's earlier "?Party!" rename), since sourcing it from 098
-- would silently revert that rename the moment this migration runs --
-- exactly the stale-copy bug class this project has been bitten by
-- before. Four of the five add a column to a RETURNS TABLE function,
-- which CREATE OR REPLACE can't do (098's own precedent) -- DROP +
-- CREATE instead, with GRANT/REVOKE restated after each since a fresh
-- CREATE (unlike CREATE OR REPLACE) does reset them.

ALTER TABLE public.question_parties
  ADD COLUMN IF NOT EXISTS party_name text;

-- ---------- create_party(): optional party name at creation ----------

DROP FUNCTION IF EXISTS public.create_party(uuid, integer);

CREATE FUNCTION public.create_party(p_list_id uuid, p_headcount integer, p_name text DEFAULT NULL)
 RETURNS TABLE(party_id uuid, invite_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_party_id uuid;
  v_token text;
  v_question_count integer;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  if p_headcount < 2 or p_headcount > 6 then
    raise exception 'A party needs between 2 and 6 people, including you.';
  end if;

  if not exists(select 1 from public.party_lists where id = p_list_id and user_id = auth.uid()) then
    raise exception 'List not found.';
  end if;

  select count(*) into v_question_count from public.party_list_questions where list_id = p_list_id;

  if v_question_count = 0 then
    raise exception 'Add at least one question to this list first.';
  end if;

  insert into public.question_parties (host_id, capacity, party_name)
  values (auth.uid(), p_headcount, nullif(trim(p_name), ''))
  returning id, question_parties.invite_token into v_party_id, v_token;

  insert into public.question_party_questions (party_id, question_id)
  select v_party_id, plq.question_id
  from public.party_list_questions plq
  where plq.list_id = p_list_id;

  insert into public.question_party_participants (party_id, user_id, is_host)
  values (v_party_id, auth.uid(), true);

  return query select v_party_id, v_token;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_party(uuid, integer, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_party(uuid, integer, text) FROM PUBLIC, anon;

-- ---------- get_party_preview(): now also returns party_name ----------

DROP FUNCTION IF EXISTS public.get_party_preview(text);

CREATE OR REPLACE FUNCTION public.get_party_preview(p_token text)
 RETURNS TABLE(
   party_id uuid,
   status text,
   host_display_name text,
   party_name text,
   question_count integer,
   participant_count integer,
   capacity integer,
   expires_at timestamptz,
   already_joined boolean
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    qp.id as party_id,
    case when qp.status = 'open' and now() >= qp.expires_at then 'expired' else qp.status end as status,
    case
      when hp.display_preference = 'anon' then coalesce(hp.anon_name, 'Someone')
      when hp.display_preference = 'first_only' then coalesce(hp.first_name, 'Someone')
      else coalesce(hp.first_name || ' ' || hp.last_initial || '.', 'Someone')
    end as host_display_name,
    qp.party_name,
    (select count(*)::integer from public.question_party_questions qpq where qpq.party_id = qp.id) as question_count,
    (select count(*)::integer from public.question_party_participants qpp where qpp.party_id = qp.id) as participant_count,
    qp.capacity,
    qp.expires_at,
    exists(
      select 1 from public.question_party_participants qpp
      where qpp.party_id = qp.id and qpp.user_id = auth.uid()
    ) as already_joined
  from public.question_parties qp
  join public.profiles hp on hp.id = qp.host_id
  where qp.invite_token = p_token;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_preview(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_party_preview(text) FROM PUBLIC, anon;

-- ---------- get_party_voting_state(): now also returns party_name ----------

DROP FUNCTION IF EXISTS public.get_party_voting_state(uuid);

CREATE FUNCTION public.get_party_voting_state(p_party_id uuid)
 RETURNS TABLE(
   party_status text,
   party_name text,
   capacity integer,
   participant_count integer,
   expires_at timestamptz,
   already_submitted boolean,
   question_id uuid,
   question_number integer,
   question_text text,
   question_category text,
   my_choice text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_parties%rowtype;
  v_submitted_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select * into v_row from public.question_parties where id = p_party_id;

  if v_row.id is null then
    raise exception 'Party not found.';
  end if;

  select qpp.submitted_at into v_submitted_at
  from public.question_party_participants qpp
  where qpp.party_id = p_party_id and qpp.user_id = auth.uid();

  if v_submitted_at is null and not exists(
    select 1 from public.question_party_participants
    where question_party_participants.party_id = p_party_id and user_id = auth.uid()
  ) then
    raise exception 'You have not joined this party.';
  end if;

  return query
    select
      case when v_row.status = 'open' and now() >= v_row.expires_at then 'expired' else v_row.status end,
      v_row.party_name,
      v_row.capacity,
      (select count(*)::integer from public.question_party_participants where question_party_participants.party_id = p_party_id),
      v_row.expires_at,
      (v_submitted_at is not null),
      q.id,
      q.question_number,
      q.text,
      q.category,
      v.choice
    from public.question_party_questions qpq
    join public.questions q on q.id = qpq.question_id
    left join public.votes v on v.question_id = qpq.question_id and v.user_id = auth.uid()
    where qpq.party_id = p_party_id
    order by q.question_number;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_voting_state(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_party_voting_state(uuid) FROM PUBLIC, anon;

-- ---------- get_party_results(): now also returns party_name ----------

DROP FUNCTION IF EXISTS public.get_party_results(text);

CREATE OR REPLACE FUNCTION public.get_party_results(p_token text)
 RETURNS TABLE(
   party_id uuid,
   party_status text,
   party_name text,
   expires_at timestamptz,
   completed_at timestamptz,
   participant_number integer,
   display_name text,
   is_host boolean,
   is_mine boolean,
   question_id uuid,
   question_number integer,
   question_text text,
   question_category text,
   choice text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_parties%rowtype;
  v_all_answered boolean;
  v_effective_status text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select * into v_row from public.question_parties where invite_token = p_token;

  if v_row.id is null then
    raise exception 'Party not found.';
  end if;

  if not exists(
    select 1 from public.question_party_participants
    where question_party_participants.party_id = v_row.id and user_id = auth.uid()
  ) then
    raise exception 'You have not joined this party.';
  end if;

  -- Lazy completion check -- only matters while still nominally open; an
  -- already-completed or already-expired party can't un-complete.
  if v_row.status = 'open' then
    select
      (select count(*) from public.question_party_participants qpp3 where qpp3.party_id = v_row.id) >= v_row.capacity
      and not exists(
        select 1 from public.question_party_participants qpp
        where qpp.party_id = v_row.id and qpp.submitted_at is null
      )
    into v_all_answered;

    if v_all_answered then
      update public.question_parties
      set status = 'completed', completed_at = now()
      where id = v_row.id
      returning * into v_row;

      insert into public.notifications (user_id, type, priority, title, body, action_url)
      select
        qpp.user_id,
        'party_completed',
        'normal',
        '🎊 Your ?Party! results are in',
        'Everyone has answered — see how your group compares.',
        '/party/' || p_token
      from public.question_party_participants qpp
      where qpp.party_id = v_row.id;
    end if;
  end if;

  v_effective_status := case when v_row.status = 'open' and now() >= v_row.expires_at then 'expired' else v_row.status end;

  -- Still genuinely in progress -- withhold the question-level breakdown
  -- entirely rather than trust the caller not to ask early.
  if v_effective_status = 'open' then
    return query
      select
        v_row.id,
        v_effective_status,
        v_row.party_name,
        v_row.expires_at,
        v_row.completed_at,
        null::integer,
        null::text,
        null::boolean,
        null::boolean,
        null::uuid,
        null::integer,
        null::text,
        null::text,
        null::text;
    return;
  end if;

  return query
    with ranked_participants as (
      select
        qpp.user_id,
        qpp.is_host,
        (row_number() over (order by qpp.is_host desc, qpp.joined_at asc))::integer as participant_number
      from public.question_party_participants qpp
      where qpp.party_id = v_row.id
    )
    select
      v_row.id as party_id,
      v_effective_status as party_status,
      v_row.party_name,
      v_row.expires_at,
      v_row.completed_at,
      rp.participant_number,
      case
        when p.display_preference = 'anon' then coalesce(p.anon_name, 'Someone')
        when p.display_preference = 'first_only' then coalesce(p.first_name, 'Someone')
        else coalesce(p.first_name || ' ' || p.last_initial || '.', 'Someone')
      end as display_name,
      rp.is_host,
      (rp.user_id = auth.uid()) as is_mine,
      q.id as question_id,
      q.question_number,
      q.text as question_text,
      q.category as question_category,
      v.choice
    from ranked_participants rp
    join public.profiles p on p.id = rp.user_id
    cross join public.question_party_questions qpq
    join public.questions q on q.id = qpq.question_id
    left join public.votes v on v.question_id = qpq.question_id and v.user_id = rp.user_id
    where qpq.party_id = v_row.id
    order by q.question_number, rp.participant_number;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_results(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_party_results(text) FROM PUBLIC, anon;

-- ---------- get_my_parties(): now also returns party_name ----------

DROP FUNCTION IF EXISTS public.get_my_parties();

CREATE FUNCTION public.get_my_parties()
 RETURNS TABLE(
   party_id uuid,
   invite_token text,
   party_name text,
   status text,
   is_host boolean,
   created_at timestamptz,
   expires_at timestamptz,
   completed_at timestamptz,
   question_count integer,
   participant_count integer,
   capacity integer
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    qp.id as party_id,
    qp.invite_token,
    qp.party_name,
    case when qp.status = 'open' and now() >= qp.expires_at then 'expired' else qp.status end as status,
    qpp.is_host,
    qp.created_at,
    qp.expires_at,
    qp.completed_at,
    (select count(*)::integer from public.question_party_questions qpq2 where qpq2.party_id = qp.id) as question_count,
    (select count(*)::integer from public.question_party_participants qpp2 where qpp2.party_id = qp.id) as participant_count,
    qp.capacity
  from public.question_party_participants qpp
  join public.question_parties qp on qp.id = qpp.party_id
  where qpp.user_id = auth.uid()
    and qpp.hidden_at is null
  order by qp.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_parties() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_parties() FROM PUBLIC, anon;
