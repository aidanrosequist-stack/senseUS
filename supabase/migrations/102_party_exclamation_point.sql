-- Rename "?Party" to "?Party!" in the two user-facing notification titles
-- that reference the feature by name. Per Aidan (2026-11-02): purely a
-- branding/fun tweak, no behavior change -- "?Party!" reads as more
-- inviting than the bare "?Party".
--
-- Both functions are CREATE OR REPLACE with their full current bodies
-- carried forward VERBATIM from migration 098_party_lists_capacity_submission.sql
-- (confirmed via grep that 099/100/101 never touched either function, so
-- 098's bodies are still the live ones) -- only the notification title
-- string itself changes in each, per this project's own standing rule
-- that a replace must never drop an unrelated in-between fix by working
-- from a stale copy (see migration 085's postmortem on 074, and this
-- round's own 101 fixing exactly that class of bug elsewhere).

CREATE OR REPLACE FUNCTION public.join_party(p_token text)
 RETURNS TABLE(rejected_reason text, party_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_parties%rowtype;
  v_last_attempt_at timestamptz;
  v_participant_count integer;
  v_joiner_name text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select p.last_party_attempt_at into v_last_attempt_at
  from public.profiles p where p.id = auth.uid();

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '1 second' then
    perform public.log_anomaly_only(
      'party_token_guess_blocked',
      'low',
      jsonb_build_object('user_id', auth.uid(), 'attempted_token', p_token),
      null
    );

    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  perform set_config('senseus.bypass_party_attempt_protection', 'true', true);
  update public.profiles set last_party_attempt_at = now() where id = auth.uid();

  select * into v_row from public.question_parties where invite_token = p_token for update;

  if v_row.id is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if exists(select 1 from public.question_party_participants qpp where qpp.party_id = v_row.id and qpp.user_id = auth.uid()) then
    return query select null::text, v_row.id;
    return;
  end if;

  if v_row.status <> 'open' then
    return query select 'already_closed'::text, v_row.id;
    return;
  end if;

  if v_row.expires_at <= now() then
    update public.question_parties set status = 'expired' where id = v_row.id;
    return query select 'expired'::text, v_row.id;
    return;
  end if;

  select count(*) into v_participant_count
  from public.question_party_participants qpp where qpp.party_id = v_row.id;

  if v_participant_count >= v_row.capacity then
    return query select 'party_full'::text, v_row.id;
    return;
  end if;

  insert into public.question_party_participants (party_id, user_id, is_host)
  values (v_row.id, auth.uid(), false);

  select
    case
      when pr.display_preference = 'anon' then coalesce(pr.anon_name, 'Someone')
      when pr.display_preference = 'first_only' then coalesce(pr.first_name, 'Someone')
      else coalesce(pr.first_name || ' ' || pr.last_initial || '.', 'Someone')
    end
  into v_joiner_name
  from public.profiles pr
  where pr.id = auth.uid();

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  values (
    v_row.host_id,
    'party_joined',
    'normal',
    '🎉 ' || v_joiner_name || ' joined your ?Party!',
    'See who else has joined and what they''ve answered so far.',
    '/party/' || p_token
  );

  return query select null::text, v_row.id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.join_party(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.join_party(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_party_results(p_token text)
 RETURNS TABLE(
   party_id uuid,
   party_status text,
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
