-- migration: 095_question_parties.sql
--
-- CONTEXT (Aidan, 2026-10-27): the "? Party" feature. Up to 6 people total
-- (1 host + 5 invited guests, confirmed explicitly) curate a shared list of
-- up to 10 questions drawn from the existing catalog, then compare how they
-- each answered. Asynchronous — a 48-hour window, auto-completing early the
-- moment everyone has answered every curated question. Shareable as a
-- public link (social media included) the same way a comparison invite is.
--
-- DESIGN: this reuses REAL votes, not a new ephemeral answer type — the
-- cheaper of the two forks from the original scoping conversation (see
-- claude/senseUS-question-party-feature-notes.md). A party's "questions"
-- are a snapshot of the host's standing curated list (party_questions,
-- below) at creation time; a participant's "answer" to each one is simply
-- whatever is in `votes` for them already, or whatever they cast normally
-- (via the existing VoteCard/QuestionPreview flow — no new voting UI is
-- needed) after joining. This means completion is a computed fact (does
-- every (question, participant) pair have a votes row?), not a status flag
-- anything explicitly sets.
--
-- Four new tables:
--
--   party_questions — a user's own standing curation list ("questions I'd
--     want to compare with friends"), capped at 10 by a trigger. Exactly
--     pinned_questions' shape (migration 077) — carries no other user's
--     identity, so it keeps pinned_questions' same direct-RLS pattern
--     (client reads/writes it directly, scoped `auth.uid() = user_id`) —
--     NOT the lockdown-to-RPC-only pattern below.
--
--   question_parties — one row per party. invite_token reuses
--     generate_short_token() (074) exactly as comparison_tokens.token does.
--     Given migration 079's hard lesson on this exact class of table (a
--     bare `recipient_id IS NULL`-style RLS predicate on comparison_tokens
--     let anon list every pending invite — RLS cannot express "only if you
--     already supplied the token as a filter"), this table and the two
--     below start RLS-enabled with ZERO policies and ZERO grants from day
--     one — every access goes through a SECURITY DEFINER RPC that takes
--     the token as a function ARGUMENT, the only way to actually enforce
--     "you must already know it". No lockdown follow-up migration should
--     ever be needed for these three.
--
--   question_party_questions — the snapshot of curated question_ids for
--     one specific party, copied from the host's party_questions at
--     create_party() time so a party's question list is frozen even if the
--     host keeps curating afterward (resolves the "stale curated list"
--     open question from the planning notes).
--
--   question_party_participants — who's in a given party. is_host marks
--     the creator (auto-inserted by create_party()); everyone else arrives
--     via join_party(). Capacity (6 total) is enforced inside join_party()
--     under the same row-lock-the-party-row pattern accept_comparison_token
--     already uses for its own serialization — the lock makes "first come,
--     first served" an actual guarantee under concurrent joins from a
--     public social-media link, not just a hope.
--
-- RPCs (all SECURITY DEFINER, all client-facing unless noted):
--   create_party()                 — snapshot the caller's party_questions
--                                     into a new party, auto-join as host.
--   get_party_preview(p_token)      — minimal info for the pre-join invite
--                                     landing screen (host name, question
--                                     count, capacity, whether the caller
--                                     already joined) — deliberately does
--                                     NOT expose other participants or any
--                                     votes to someone who hasn't joined.
--   join_party(p_token)             — join an open, non-full, non-expired
--                                     party. Same rate-limit-the-mutating-
--                                     path-only choice migration 079 made
--                                     for comparison_tokens (get_*_token
--                                     reads aren't rate-limited; accept/
--                                     decline are) — new
--                                     profiles.last_party_attempt_at column,
--                                     protected the same way
--                                     last_comparison_attempt_at is.
--   get_party_results(p_token)      — the N-way generalization of
--                                     get_comparison(): one row per
--                                     (question, participant), restricted
--                                     to actual participants. Never sends
--                                     another participant's raw user_id —
--                                     only a stable per-party
--                                     participant_number (host is always 1)
--                                     and their resolved display name, same
--                                     privacy posture as get_pinned_comments
--                                     /get_comparison. Lazily flips the
--                                     party to 'completed' (and notifies
--                                     every participant) the moment it
--                                     detects every (question, participant)
--                                     pair has a vote — no cron needed, same
--                                     lazy-on-access philosophy already
--                                     established for comparison_tokens'
--                                     own expiry. Expiry itself is computed
--                                     for display in every read (open +
--                                     past expires_at reads as 'expired')
--                                     without writing anything — only
--                                     join_party() ever writes 'expired',
--                                     mirroring accept_comparison_token's
--                                     own read/write split.
--   get_my_parties()                — every party the caller hosts or has
--                                     joined, for the "? Party" tab's own
--                                     list view — without this, someone
--                                     would need to have saved their own
--                                     invite link to ever find their party
--                                     again.
-- ============================================================

-- ---------- party_questions: standing per-user curation list ----------

CREATE TABLE public.party_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_questions_user_id_question_id_key UNIQUE (user_id, question_id)
);

CREATE INDEX idx_party_questions_user_id ON public.party_questions (user_id);

ALTER TABLE public.party_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own party questions"
  ON public.party_questions FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can curate party questions"
  ON public.party_questions FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can remove party questions"
  ON public.party_questions FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, DELETE ON public.party_questions TO authenticated;

-- Cap at 10 — a trigger, not just a client-side check, so the limit holds
-- even against a direct insert from the browser console.
CREATE OR REPLACE FUNCTION public.enforce_party_questions_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from public.party_questions where user_id = new.user_id) >= 10 then
    raise exception 'You can curate up to 10 questions for a party.';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS enforce_party_questions_cap_trigger ON public.party_questions;
CREATE TRIGGER enforce_party_questions_cap_trigger
  BEFORE INSERT ON public.party_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_party_questions_cap();

REVOKE EXECUTE ON FUNCTION public.enforce_party_questions_cap() FROM PUBLIC, anon, authenticated;

-- ---------- question_parties / question_party_questions / question_party_participants ----------
-- RPC-only from the start — see migration header. RLS enabled, zero
-- policies, zero grants: the same end state migration 079 had to migrate
-- comparison_tokens INTO after the fact.

CREATE TABLE public.question_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE DEFAULT public.generate_short_token(10),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  completed_at timestamptz
);

CREATE INDEX idx_question_parties_invite_token ON public.question_parties (invite_token);
CREATE INDEX idx_question_parties_host_id ON public.question_parties (host_id);

ALTER TABLE public.question_parties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_parties FROM PUBLIC, anon, authenticated;

CREATE TABLE public.question_party_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.question_parties(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_party_questions_party_id_question_id_key UNIQUE (party_id, question_id)
);

CREATE INDEX idx_question_party_questions_party_id ON public.question_party_questions (party_id);

ALTER TABLE public.question_party_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_party_questions FROM PUBLIC, anon, authenticated;

CREATE TABLE public.question_party_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.question_parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_host boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_party_participants_party_id_user_id_key UNIQUE (party_id, user_id)
);

CREATE INDEX idx_question_party_participants_party_id ON public.question_party_participants (party_id);
CREATE INDEX idx_question_party_participants_user_id ON public.question_party_participants (user_id);

ALTER TABLE public.question_party_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_party_participants FROM PUBLIC, anon, authenticated;

-- ---------- rate-limit plumbing for join_party(), mirroring 074/079's
-- last_comparison_attempt_at exactly (its own dedicated column, not a
-- shared one — each token-guessable action gets its own cooldown clock) ----------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_party_attempt_at timestamptz;

-- Full body carried forward from migration 094 (itself 085's body
-- verbatim plus referred_by) -- per 085's own post-mortem on 074's
-- regression, this MUST always be replaced from its current full body,
-- never a stale copy, or a column protected by an in-between version
-- silently loses that protection. Only addition here is
-- last_party_attempt_at, following the exact same bypass-flag shape as
-- last_comparison_attempt_at right next to it.
CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() != 'service_role' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.integrity_weight := 1.0000;
      new.answers_count := 0;
      new.resonance_score := 50;
      new.resonance_tier := 'Independent';
      new.streak_days := 0;
      new.longest_streak := 0;
      new.replies_count := 0;
      new.likes_received := 0;
      new.tier := 'newcomer';
      new.badges := '{}';
      new.voip_flagged_at := null;
      new.country_changed_at := null;
      new.created_at := now();
      new.last_vote_at := null;
      new.welcome_sms_sent_at := null;
      new.checked_line_type_at := null;
      new.last_comparison_attempt_at := null;
      new.last_party_attempt_at := null;
      new.referred_by := null;
    else
      if coalesce(current_setting('senseus.bypass_answers_count_protection', true), '') <> 'true' then
        new.answers_count := old.answers_count;
      end if;
      if coalesce(current_setting('senseus.bypass_last_vote_at_protection', true), '') <> 'true' then
        new.last_vote_at := old.last_vote_at;
      end if;
      if coalesce(current_setting('senseus.bypass_welcome_sms_sent_at_protection', true), '') <> 'true' then
        new.welcome_sms_sent_at := old.welcome_sms_sent_at;
      end if;
      if coalesce(current_setting('senseus.bypass_checked_line_type_at_protection', true), '') <> 'true' then
        new.checked_line_type_at := old.checked_line_type_at;
      end if;
      if coalesce(current_setting('senseus.bypass_comparison_attempt_protection', true), '') <> 'true' then
        new.last_comparison_attempt_at := old.last_comparison_attempt_at;
      end if;
      if coalesce(current_setting('senseus.bypass_party_attempt_protection', true), '') <> 'true' then
        new.last_party_attempt_at := old.last_party_attempt_at;
      end if;
      if coalesce(current_setting('senseus.bypass_referred_by_protection', true), '') <> 'true' then
        new.referred_by := old.referred_by;
      end if;
      new.is_admin := old.is_admin;
      new.integrity_weight := old.integrity_weight;
      new.resonance_score := old.resonance_score;
      new.resonance_tier := old.resonance_tier;
      new.streak_days := old.streak_days;
      new.longest_streak := old.longest_streak;
      new.replies_count := old.replies_count;
      new.likes_received := old.likes_received;
      new.tier := old.tier;
      new.badges := old.badges;
      new.voip_flagged_at := old.voip_flagged_at;
      new.country_changed_at := old.country_changed_at;
      new.created_at := old.created_at;
      new.id := old.id;
    end if;
  end if;

  return new;
end;
$function$;

-- ---------- create_party(): snapshot the caller's curation list into a new party ----------

CREATE FUNCTION public.create_party()
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

  select count(*) into v_question_count from public.party_questions where user_id = auth.uid();

  if v_question_count = 0 then
    raise exception 'Add at least one question to your party list first.';
  end if;

  insert into public.question_parties (host_id)
  values (auth.uid())
  returning id, question_parties.invite_token into v_party_id, v_token;

  insert into public.question_party_questions (party_id, question_id)
  select v_party_id, pq.question_id
  from public.party_questions pq
  where pq.user_id = auth.uid();

  insert into public.question_party_participants (party_id, user_id, is_host)
  values (v_party_id, auth.uid(), true);

  return query select v_party_id, v_token;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.create_party() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_party() FROM PUBLIC, anon;

-- ---------- get_party_preview(): pre-join landing-screen info only ----------
-- Deliberately thin — no question list, no participant list, no votes.
-- Someone who merely has the link (not yet joined) should see enough to
-- decide whether to join, not the content a join is meant to unlock.

CREATE FUNCTION public.get_party_preview(p_token text)
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
    6 as capacity,
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

-- ---------- join_party(): the mutating, rate-limited, capacity-checked path ----------
-- Same shape as accept_comparison_token (074/079/090): rate-limited via its
-- own last_party_attempt_at cooldown, row-locks the party FOR UPDATE so
-- concurrent joins from a public link are serialized (real first-come-
-- first-served under capacity, not just hopeful), returns rejected_reason
-- instead of raising so the rate-limit timestamp always commits even on a
-- bad-token guess. Re-joining a party you're already in (including the
-- host re-opening their own link) is a harmless no-op, not an error.

CREATE FUNCTION public.join_party(p_token text)
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

  -- Already in (host included, who was auto-joined by create_party()) —
  -- a harmless no-op so revisiting your own link never errors.
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

  if v_participant_count >= 6 then
    return query select 'party_full'::text, v_row.id;
    return;
  end if;

  insert into public.question_party_participants (party_id, user_id, is_host)
  values (v_row.id, auth.uid(), false);

  -- Let the host know someone joined — same reasoning as 090's
  -- comparison_accepted notification (the joiner already sees they joined
  -- immediately in the app, this is for the host, who wouldn't otherwise
  -- know until they happen to reopen the party).
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
    '🎉 ' || v_joiner_name || ' joined your ? Party',
    'See who else has joined and what they''ve answered so far.',
    '/party/' || p_token
  );

  return query select null::text, v_row.id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.join_party(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.join_party(text) FROM PUBLIC, anon;

-- ---------- get_party_results(): the N-way get_comparison() generalization ----------
-- One row per (question, participant). Restricted to actual participants —
-- raises if the caller hasn't joined (get_party_preview is the pre-join
-- screen; this is post-join only). Never sends another participant's raw
-- user_id — only a stable participant_number (host is always 1, everyone
-- else in join order) and their resolved display name, matching
-- get_pinned_comments'/get_comparison's existing privacy posture.
--
-- Lazily flips the party to 'completed' (and notifies every participant,
-- once) the instant it detects every (question, participant) pair already
-- has a votes row — no cron, same lazy-on-access philosophy
-- accept_comparison_token already uses for its own expiry. Status for
-- display otherwise reads 'expired' once past expires_at without writing
-- anything (only join_party() ever persists 'expired') — the same read/
-- write split migration 074/079 established.

CREATE FUNCTION public.get_party_results(p_token text)
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

  -- Lazy completion check — only matters while still nominally open; an
  -- already-completed or already-expired party can't un-complete.
  if v_row.status = 'open' then
    select not exists(
      select 1
      from public.question_party_questions qpq
      cross join public.question_party_participants qpp
      where qpq.party_id = v_row.id
        and qpp.party_id = v_row.id
        and not exists(
          select 1 from public.votes v
          where v.question_id = qpq.question_id and v.user_id = qpp.user_id
        )
    ) into v_all_answered;

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
        '🎊 Your ? Party results are in',
        'Everyone has answered — see how your group compares.',
        '/party/' || p_token
      from public.question_party_participants qpp
      where qpp.party_id = v_row.id;
    end if;
  end if;

  return query
    select
      v_row.id as party_id,
      case when v_row.status = 'open' and now() >= v_row.expires_at then 'expired' else v_row.status end as party_status,
      v_row.expires_at,
      v_row.completed_at,
      (row_number() over (order by qpp.is_host desc, qpp.joined_at asc))::integer as participant_number,
      case
        when p.display_preference = 'anon' then coalesce(p.anon_name, 'Someone')
        when p.display_preference = 'first_only' then coalesce(p.first_name, 'Someone')
        else coalesce(p.first_name || ' ' || p.last_initial || '.', 'Someone')
      end as display_name,
      qpp.is_host,
      (qpp.user_id = auth.uid()) as is_mine,
      q.id as question_id,
      q.question_number,
      q.text as question_text,
      q.category as question_category,
      v.choice
    from public.question_party_participants qpp
    join public.profiles p on p.id = qpp.user_id
    cross join public.question_party_questions qpq
    join public.questions q on q.id = qpq.question_id
    left join public.votes v on v.question_id = qpq.question_id and v.user_id = qpp.user_id
    where qpp.party_id = v_row.id and qpq.party_id = v_row.id
    order by q.question_number, participant_number;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_results(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_party_results(text) FROM PUBLIC, anon;

-- ---------- get_my_parties(): the "? Party" tab's own list ----------
-- Without this, someone would need to have separately saved their own
-- invite link to ever find a party again after leaving the page.

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
   participant_count integer
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
    (select count(*)::integer from public.question_party_participants qpp2 where qpp2.party_id = qp.id) as participant_count
  from public.question_party_participants qpp
  join public.question_parties qp on qp.id = qpp.party_id
  where qpp.user_id = auth.uid()
  order by qp.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_parties() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_parties() FROM PUBLIC, anon;

-- ---------- notifications: register the two new types ----------

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'badge_earned'::text,
    'new_tracking_question'::text,
    'system_message'::text,
    'milestone'::text,
    'admin_broadcast'::text,
    'welcome'::text,
    'urgent'::text,
    'breaking_question'::text,
    'comparison_accepted'::text,
    'party_joined'::text,
    'party_completed'::text
  ]));

-- ---------- notification_preferences: a column for future real push, matching 075's own pattern ----------
-- Matches 090's own precedent exactly: the comparison_accepted notification
-- insert above never checks this preferences table either — see 075's own
-- header comment, this table is forward-looking data for a real push-
-- sending step that doesn't exist yet, not a gate on today's in-app
-- notifications row.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_party_activity boolean NOT NULL DEFAULT true;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('create_party', 'Client RPC (Activity.jsx''s ? Party tab) — snapshots the caller''s party_questions curation list into a new question_parties row and auto-joins them as host. Migration 095 (2026-10-27).'),
  ('get_party_preview', 'Client RPC (the pre-join invite landing screen) — deliberately thin: host name, counts, capacity, already_joined, no question list or votes, for someone who has the link but has not joined yet. Requires the exact token as an argument, same anti-listability reasoning as get_comparison_token (079). Migration 095 (2026-10-27).'),
  ('join_party', 'Client RPC — joins an open, non-full, non-expired party. Rate-limited via its own last_party_attempt_at cooldown (same pattern as accept_comparison_token, 074/079), row-locks the party for real first-come-first-served capacity enforcement under concurrent joins from a public link. Migration 095 (2026-10-27).'),
  ('get_party_results', 'Client RPC (the party results view, post-join only) — N-way generalization of get_comparison(): one row per question x participant. Never sends another participant''s raw user_id, only a stable participant_number and resolved display name, same privacy posture as get_pinned_comments/get_comparison. Lazily flips the party to completed and notifies every participant once all (question, participant) pairs have a real vote. Migration 095 (2026-10-27).'),
  ('get_my_parties', 'Client RPC (the ? Party tab''s own list) — every party the caller hosts or has joined. Migration 095 (2026-10-27).'),
  ('enforce_party_questions_cap', 'Not a client RPC -- BEFORE INSERT trigger on party_questions enforcing the 10-question curation cap server-side. Migration 095 (2026-10-27).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Curate: as user A, insert 10 rows into party_questions (10 distinct
--    real question ids). An 11th insert should fail with the cap message.
--    Delete one, confirm a new 11th now succeeds (cap is a live count, not
--    a one-time flag).
--
-- 2. create_party() as A with a non-empty curation list -> succeeds,
--    returns a party_id + short invite_token; question_party_questions has
--    one row per curated question; question_party_participants has exactly
--    one row (A, is_host = true). Calling create_party() with an EMPTY
--    curation list raises the "add at least one question" error.
--
-- 3. get_party_preview(token) as a second user B who hasn't joined ->
--    returns host_display_name = A's name, question_count matching,
--    participant_count = 1, capacity = 6, already_joined = false. No
--    question text or votes anywhere in the result.
--
-- 4. join_party(token) as B -> rejected_reason null, party_id matches;
--    question_party_participants now has 2 rows. Re-calling join_party as B
--    again -> still rejected_reason null (harmless no-op), no duplicate
--    row (unique constraint + the already-in check both hold). A gets a
--    party_joined notification naming B.
--
-- 5. Capacity: join as 5 total distinct guests (6 total with host) ->
--    all succeed. A 7th distinct user's join_party -> rejected_reason =
--    'party_full'.
--
-- 6. Rate limit: two join_party calls under 1 second apart from the same
--    account, even with a bogus token -> second call returns
--    rejected_reason = 'rate_limited', not 'not_found' (same fix 074 made
--    for comparison tokens -- the first call's cooldown write must commit
--    even though the token was bad).
--
-- 7. Results/completion: have every participant vote on every curated
--    question. The NEXT get_party_results() call by any participant ->
--    party_status flips from 'open' to 'completed', completed_at set, and
--    every participant gets a party_completed notification (confirm row
--    count in notifications matches participant count, and it only
--    happens once -- call get_party_results() again, no duplicate
--    notifications).
--
-- 8. Expiry: manually set an open party's expires_at to the past. A pure
--    get_party_preview()/get_party_results() read shows status = 'expired'
--    WITHOUT writing it (confirm the stored row is still 'open' via a
--    direct select as service_role). join_party() against that same party
--    -> rejected_reason = 'expired', and NOW the stored row is actually
--    updated to 'expired'.
--
-- 9. Privacy: confirm get_party_results() never returns a raw user_id
--    column at all, and that a non-participant (has the token, never
--    joined) calling get_party_results() directly gets the "have not
--    joined" exception, not partial data.
--
-- 10. protect_admin_columns: as a non-admin, a direct
--     `update profiles set last_party_attempt_at = null where id = auth.uid()`
--     should silently have no effect (trigger reverts it) -- same
--     confirmation already done for last_comparison_attempt_at (074) and
--     referred_by (094).
-- ============================================================
