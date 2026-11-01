-- migration: 098_party_lists_capacity_submission.sql
--
-- ALSO FIXES A PRE-EXISTING BUG found while verifying the above (not
-- something this migration's own changes caused): get_party_results()'s
-- participant_number was `row_number() over (order by is_host desc,
-- joined_at asc)` computed directly over the CROSS JOIN of participants x
-- questions, so with no PARTITION BY it numbered EVERY result row
-- 1..(participants*questions) instead of giving each participant one
-- stable number repeated across their own rows -- confirmed on a 3-
-- participant, 10-question party: the host's 10 rows carried 10 DIFFERENT
-- numbers, not "1" ten times. Fixed by computing participant_number once
-- per participant in a CTE, then joining that to the question rows.
--
-- CONTEXT (Aidan, 2026-11-01): the first chunk of the "? Party" revamp,
-- discussed at length before building anything (see
-- claude/senseUS-question-party-feature-notes.md). Three backend changes,
-- all agreed on directly with Aidan:
--
--   1. MULTIPLE NAMED LISTS. The old party_questions (one flat, unnamed,
--      per-user curation list, migration 095) is replaced by party_lists
--      (a user's named lists) + party_list_questions (each list's own
--      curated questions, capped at 10 -- "same cap, per list" was Aidan's
--      own call). Existing party_questions rows are folded into one
--      default "My List" per user who had any, then the old table is
--      dropped -- this is a full cutover, not an additive table, since the
--      frontend is being rebuilt around per-list pages in the same pass
--      (see the project doc's Round-2 frontend tasks).
--
--   2. HEADCOUNT-BASED CAPACITY. create_party() used to always reserve 6
--      slots (1 host + 5 guests) regardless of how many people the host
--      actually meant to invite, which is exactly why Aidan saw a
--      confusing "1/6 joined" after sending a link to one person.
--      create_party() now takes the host's own declared headcount
--      (2-6, including the host) and question_parties.capacity stores it;
--      join_party()'s capacity check and every "X/Y joined" read
--      (get_party_preview, get_my_parties) now use that real number
--      instead of a hardcoded 6. Per Aidan: no re-editing the headcount
--      after creation (cancel and resend if it's wrong), and a party still
--      completes normally at the 48-hour mark even if fewer than the
--      declared headcount ever joined, showing results for whoever's
--      actually in it.
--
--   3. SUBMIT-BASED COMPLETION, RESULTS HIDDEN UNTIL EVERYONE'S IN.
--      Completion used to be inferred purely from vote coverage (every
--      (question, participant) pair has a votes row) -- but the new
--      mini-card voting page explicitly allows leaving a question blank
--      (no forced skip; "notified if they left one unanswered" is a
--      frontend confirm-dialog, not a backend requirement), so vote
--      coverage can no longer stand in for "I'm done." New submitted_at on
--      question_party_participants, set by a new submit_party_answers()
--      RPC when someone hits Submit. A party now only early-completes once
--      every declared headcount slot is filled AND every one of those
--      participants has submitted_at set. Per Aidan ("results should stay
--      hidden until all parties of the ?party have hit submit"),
--      get_party_results() now WITHHOLDS its question-level rows -- not
--      just relies on the frontend not asking -- while the party is still
--      genuinely open, returning a single thin status row instead; once
--      completed OR expired it returns full rows as before (an expired
--      party still shows whatever people actually submitted, same
--      everyone-under-capacity-still-gets-results spirit as above). A new
--      get_party_voting_state() RPC backs the mini-card page itself --
--      the caller's own curated questions plus their own existing votes
--      only, completely separate from the results RPC's privacy posture.
--
-- NOT in this migration: the housekeeping fix discussed in the same
-- conversation (hide_party() cascade-deleting a party once every
-- participant has hidden it, so nothing orphans forever) -- kept as its
-- own clearly-separable change below, since it touches none of the above.
--
-- FRONTEND NOTE: party_questions' old direct-table writes (Explore.jsx's
-- and Activity.jsx's "Add/Remove from ? Party list" longpress actions,
-- togglePartyQuestion) need to move to party_list_questions scoped to a
-- specific list_id -- tracked as its own frontend task, not done here.
-- ============================================================

-- ---------- 1. party_lists / party_list_questions (replaces party_questions) ----------

CREATE TABLE public.party_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My List',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_party_lists_user_id ON public.party_lists (user_id);

ALTER TABLE public.party_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own party lists"
  ON public.party_lists FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create own party lists"
  ON public.party_lists FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can rename own party lists"
  ON public.party_lists FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own party lists"
  ON public.party_lists FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_lists TO authenticated;

CREATE TABLE public.party_list_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.party_lists(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_list_questions_list_id_question_id_key UNIQUE (list_id, question_id)
);

CREATE INDEX idx_party_list_questions_list_id ON public.party_list_questions (list_id);

ALTER TABLE public.party_list_questions ENABLE ROW LEVEL SECURITY;

-- Ownership is checked through the parent list (party_list_questions
-- carries no user_id of its own), same indirection pattern used wherever
-- this codebase scopes a child row by its parent's owner.
CREATE POLICY "Users can view own list questions"
  ON public.party_list_questions FOR SELECT
  TO authenticated
  USING (exists(
    select 1 from public.party_lists pl
    where pl.id = party_list_questions.list_id and pl.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can curate own list questions"
  ON public.party_list_questions FOR INSERT
  TO authenticated
  WITH CHECK (exists(
    select 1 from public.party_lists pl
    where pl.id = party_list_questions.list_id and pl.user_id = (select auth.uid())
  ));

CREATE POLICY "Users can remove own list questions"
  ON public.party_list_questions FOR DELETE
  TO authenticated
  USING (exists(
    select 1 from public.party_lists pl
    where pl.id = party_list_questions.list_id and pl.user_id = (select auth.uid())
  ));

GRANT SELECT, INSERT, DELETE ON public.party_list_questions TO authenticated;

-- Cap at 10 per list (not per user) -- a trigger, not just a client-side
-- check, same reasoning as migration 095's original enforce_party_questions_cap.
CREATE OR REPLACE FUNCTION public.enforce_party_list_questions_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from public.party_list_questions where list_id = new.list_id) >= 10 then
    raise exception 'You can curate up to 10 questions per list.';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS enforce_party_list_questions_cap_trigger ON public.party_list_questions;
CREATE TRIGGER enforce_party_list_questions_cap_trigger
  BEFORE INSERT ON public.party_list_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_party_list_questions_cap();

REVOKE EXECUTE ON FUNCTION public.enforce_party_list_questions_cap() FROM PUBLIC, anon, authenticated;

-- ---------- data migration: fold the old flat list into one default list per user ----------
-- party_lists is brand new, so at this point in the migration every user
-- gets at most one row here -- the join below can't double up.

INSERT INTO public.party_lists (user_id, name, created_at)
SELECT DISTINCT user_id, 'My List', now()
FROM public.party_questions;

INSERT INTO public.party_list_questions (list_id, question_id, created_at)
SELECT pl.id, pq.question_id, pq.created_at
FROM public.party_questions pq
JOIN public.party_lists pl ON pl.user_id = pq.user_id AND pl.name = 'My List';

-- Full cutover -- the frontend is being rebuilt around party_lists in the
-- same pass (see the FRONTEND NOTE above), so nothing should be left
-- pointing at the old table.
DROP TRIGGER IF EXISTS enforce_party_questions_cap_trigger ON public.party_questions;
DROP FUNCTION IF EXISTS public.enforce_party_questions_cap();
DROP TABLE IF EXISTS public.party_questions;

-- ---------- 2. headcount-based capacity ----------

ALTER TABLE public.question_parties
  ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 6 CHECK (capacity BETWEEN 2 AND 6);

-- ---------- 3. submit-based completion plumbing ----------

ALTER TABLE public.question_party_participants
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- ---------- create_party(): now takes the list to snapshot + the declared headcount ----------
-- Old zero-arg signature is a different overload entirely -- dropped
-- outright rather than left dangling, since the frontend call site is
-- being updated in the same pass.

DROP FUNCTION IF EXISTS public.create_party();

CREATE FUNCTION public.create_party(p_list_id uuid, p_headcount integer)
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

  insert into public.question_parties (host_id, capacity)
  values (auth.uid(), p_headcount)
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

GRANT EXECUTE ON FUNCTION public.create_party(uuid, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_party(uuid, integer) FROM PUBLIC, anon;

-- ---------- get_party_preview(): real capacity instead of a hardcoded 6 ----------
-- Same signature/columns as migration 095 -- CREATE OR REPLACE is safe.

CREATE OR REPLACE FUNCTION public.get_party_preview(p_token text)
 RETURNS TABLE(
   party_id uuid,
   status text,
   host_display_name text,
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

-- ---------- join_party(): capacity check now reads the party's own declared headcount ----------
-- Only the hardcoded ">= 6" line changes; everything else carried forward
-- verbatim from migration 095 (full body, per this codebase's own
-- standing rule about never replacing a function from a stale copy).

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
    '🎉 ' || v_joiner_name || ' joined your ?Party',
    'See who else has joined and what they''ve answered so far.',
    '/party/' || p_token
  );

  return query select null::text, v_row.id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.join_party(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.join_party(text) FROM PUBLIC, anon;

-- ---------- submit_party_answers(): the mini-card page's "I'm done" signal ----------
-- Decoupled from vote coverage on purpose -- leaving a question blank is
-- allowed by design, so "every question has a vote" can no longer stand
-- in for "I'm finished." Idempotent: hitting Submit again just re-stamps
-- the same timestamp, never an error.

CREATE FUNCTION public.submit_party_answers(p_party_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  update public.question_party_participants
  set submitted_at = now()
  where party_id = p_party_id and user_id = auth.uid();

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'You are not a participant in this party.';
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_party_answers(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_party_answers(uuid) FROM PUBLIC, anon;

-- ---------- get_party_voting_state(): backs the mini-card page itself ----------
-- Completely separate privacy posture from get_party_results() below --
-- this only ever exposes the CALLER's own existing votes, never another
-- participant's, so it's safe to call at any point in a party's
-- lifecycle (including to review your own answers read-only after you've
-- already submitted).

CREATE FUNCTION public.get_party_voting_state(p_party_id uuid)
 RETURNS TABLE(
   party_status text,
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

-- ---------- get_party_results(): submit-based completion + withheld until ready ----------
-- Same signature/columns as migration 095 -- CREATE OR REPLACE is safe.
-- Two changes from the original body: (1) the lazy-completion check is
-- now "every declared seat filled AND everyone who filled one has
-- submitted", not vote coverage; (2) while still genuinely open, this
-- returns a single thin row (status/expiry only, every question-level
-- field null) instead of real rows -- per Aidan, results stay hidden
-- until everyone's actually hit submit, and that has to be enforced here,
-- not just left to the frontend not asking yet.

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
        '🎊 Your ?Party results are in',
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

-- ---------- get_my_parties(): real capacity column added ----------
-- Adds a column to the output, which CREATE OR REPLACE can't do for a
-- RETURNS TABLE function -- dropped and recreated instead.

DROP FUNCTION IF EXISTS public.get_my_parties();

CREATE FUNCTION public.get_my_parties()
 RETURNS TABLE(
   party_id uuid,
   invite_token text,
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

-- ---------- 4. hide_party(): cascade-delete once the LAST participant hides it ----------
-- Separate concern from the above three -- the housekeeping gap Aidan
-- flagged ("5 years from now... that page would still be out there in
-- the ether"). hide_party() already only ever runs on a completed/expired
-- party (nothing active is ever at risk), so the moment it detects it was
-- the last remaining hidden_at-null participant, it deletes the whole
-- party right then -- question_party_questions and
-- question_party_participants both cascade via their existing
-- ON DELETE CASCADE on party_id, so one delete here is enough. No cron,
-- no fixed retention window: cleanup happens exactly when the last person
-- stops looking, never before and never long after.

CREATE OR REPLACE FUNCTION public.hide_party(p_party_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_parties%rowtype;
  v_updated integer;
  v_remaining integer;
begin
  select * into v_row from public.question_parties where id = p_party_id;

  if v_row.id is null then
    raise exception 'Party not found.';
  end if;

  if v_row.status = 'open' and now() < v_row.expires_at then
    raise exception 'You can only remove a party once it''s completed or expired.';
  end if;

  update public.question_party_participants
  set hidden_at = now()
  where party_id = p_party_id and user_id = auth.uid();

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'You are not a participant in this party.';
  end if;

  select count(*) into v_remaining
  from public.question_party_participants
  where party_id = p_party_id and hidden_at is null;

  if v_remaining = 0 then
    delete from public.question_parties where id = p_party_id;
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.hide_party(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hide_party(uuid) FROM PUBLIC, anon;

-- ---------- intentionally_public_functions ----------

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('create_party', 'Client RPC (a list''s own page, "Request a ?Party") -- now takes (p_list_id, p_headcount): snapshots that specific party_list_questions list into a new question_parties row at the host''s declared capacity (2-6, including the host) and auto-joins them as host. Migration 098 (2026-11-01); originally migration 095 as a zero-arg function against the single flat party_questions list.'),
  ('get_party_preview', 'Client RPC (the pre-join invite landing screen) -- host name, counts, the party''s REAL declared capacity (was hardcoded 6), already_joined, no question list or votes, for someone who has the link but has not joined yet. Requires the exact token as an argument, same anti-listability reasoning as get_comparison_token (079). Migration 098 (2026-11-01) for the capacity fix; originally migration 095.'),
  ('join_party', 'Client RPC -- joins an open, non-full, non-expired party. Rate-limited via its own last_party_attempt_at cooldown (same pattern as accept_comparison_token, 074/079), row-locks the party for real first-come-first-served capacity enforcement under concurrent joins from a public link; capacity check now reads the party''s own declared headcount instead of a hardcoded 6. Migration 098 (2026-11-01) for the capacity fix; originally migration 095.'),
  ('submit_party_answers', 'Client RPC (the ?Party mini-card voting page''s Submit button) -- sets the caller''s own submitted_at on their question_party_participants row; idempotent. Deliberately decoupled from vote coverage, since leaving a question blank is allowed by design. Migration 098 (2026-11-01).'),
  ('get_party_voting_state', 'Client RPC (the ?Party mini-card voting page) -- the caller''s own curated questions for a party plus their own existing votes only, at any point in the party''s lifecycle; a completely separate privacy posture from get_party_results, which is participant-wide. Migration 098 (2026-11-01).'),
  ('get_party_results', 'Client RPC (the party results view, post-join only) -- N-way generalization of get_comparison(): one row per question x participant. Never sends another participant''s raw user_id, only a stable participant_number and resolved display name, same privacy posture as get_pinned_comments/get_comparison. Completion is now submit-based (every declared seat filled and every participant has hit Submit, not vote coverage), and while still genuinely open this withholds all question-level data -- returns a single thin status row instead -- so results truly cannot be read early. Migration 098 (2026-11-01); originally migration 095.'),
  ('get_my_parties', 'Client RPC (the ?Party tab''s own list) -- every party the caller hosts or has joined, excluding ones they''ve personally hidden; now also returns each party''s real capacity instead of the frontend assuming 6. Migration 098 (2026-11-01); originally migration 095, hidden_at filter added in 097.'),
  ('hide_party', 'Client RPC (the ?Party tab''s own list, swipe-to-delete) -- hides a completed/expired party from the caller''s own list only; never touches what any other participant sees. Now also deletes the whole party outright the moment every participant has hidden it (nothing orphans forever) -- safe because this only ever runs on an already completed/expired party to begin with. Migration 098 (2026-11-01); originally migration 097.'),
  ('enforce_party_list_questions_cap', 'Not a client RPC -- BEFORE INSERT trigger on party_list_questions enforcing the 10-question-per-list curation cap server-side. Migration 098 (2026-11-01); replaces enforce_party_questions_cap (095), which was per-user rather than per-list.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Data migration: for a user who had rows in the old party_questions
--    before this ran, confirm they now have exactly one party_lists row
--    named "My List" whose party_list_questions exactly matches their old
--    party_questions set (same question_ids). A user who never curated
--    anything gets no party_lists row at all (not an empty one).
--
-- 2. Multi-list + per-list cap: create a second named list for the same
--    user. Curate 10 questions into it -- an 11th insert into THAT list
--    fails with the per-list cap message, while the first list (already
--    at whatever count it has) is unaffected. Confirm a user can't insert
--    into party_list_questions for a list_id they don't own (RLS).
--
-- 3. create_party(list_id, headcount): headcount of 1 and 7 both raise
--    the "between 2 and 6" error; headcount of 0-length list raises "add
--    at least one question"; a list_id belonging to a DIFFERENT user
--    raises "List not found." A valid call sets question_parties.capacity
--    to exactly the declared headcount.
--
-- 4. Capacity enforcement: create_party with headcount 3. join_party as
--    2 distinct guests -> both succeed (3 total incl. host). A 3rd
--    guest's join_party -> rejected_reason = 'party_full'. get_party_preview
--    and get_my_parties for this party both report capacity = 3, not 6.
--
-- 5. Submit-based completion: with headcount 3 and all 3 joined, have
--    only 2 of 3 call submit_party_answers(). get_party_results() for any
--    of them -> party_status still 'open', and the single returned row
--    has question_id = null (results withheld). The 3rd participant then
--    submits (regardless of how many of the party's questions they
--    actually voted on -- confirm a party with a deliberately-blank
--    question still completes once all three have submitted). The NEXT
--    get_party_results() call by anyone -> party_status 'completed',
--    full rows returned, the blank question shows choice = null for
--    whoever skipped it, and every participant gets a party_completed
--    notification exactly once.
--
-- 6. Results withheld while open: confirm directly (as a participant, in
--    the SQL editor) that calling get_party_results() on a party that is
--    still open and NOT yet fully submitted never returns a non-null
--    question_id in any row, under any circumstance.
--
-- 7. Expiry still shows partial results: manually expire a party where
--    only 2 of 3 declared seats ever joined and only 1 of those 2
--    submitted. get_party_results() -> party_status 'expired', full rows
--    returned (not withheld), the never-joined 3rd seat simply absent and
--    the non-submitter's unanswered questions showing choice = null.
--
-- 8. Cascade-delete on last hide: for a completed 3-participant party,
--    have participant A call hide_party() -- party still exists (a
--    direct select on question_parties as service_role still finds the
--    row), get_my_parties() for B and C still show it. B hides it next --
--    still exists. C (the last one) hides it -- question_parties,
--    question_party_questions and question_party_participants for that
--    party_id are now ALL gone (confirm via service_role selects on all
--    three). Re-running get_my_parties() for A or B (who already hid it
--    before the delete) shows nothing new breaks.
--
-- 9. hide_party() still rejects an open party, and still rejects a
--    non-participant, exactly as migration 097 verified.
-- ============================================================
