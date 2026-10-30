-- migration: 097_hide_completed_parties.sql
--
-- Lets someone swipe a completed or expired "? Party" off their own
-- Activity tab list (SwipeToDelete.jsx, 2026-10-29) without touching what
-- any other participant sees.
--
-- Discussed directly with Aidan before building this: a true DELETE on
-- question_parties/question_party_questions/question_party_participants
-- would destroy the OTHER participants' results too (get_party_results()
-- reads all three), which he explicitly didn't want -- "just my own
-- list" was his own call. So this is a personal hide, not a shared
-- delete: a new hidden_at timestamp on the caller's own
-- question_party_participants row, filtered out of get_my_parties()
-- below. Nothing is ever actually removed from the three tables
-- themselves.
--
-- Scoped to completed/expired parties only (not 'open') -- matches
-- Aidan's own framing ("a party that's been completed"); hiding a still-
-- active party you might still want to track felt like the wrong default
-- to ship without being asked for it specifically. hide_party() honors
-- the same "effectively expired" rule get_my_parties() already displays
-- (an open party whose expires_at has passed reads as Expired there even
-- before anything writes that back to the status column), not just the
-- raw stored status.

ALTER TABLE public.question_party_participants
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- ---------- hide_party(): swipe-to-delete a completed/expired party off the caller's own list ----------

CREATE OR REPLACE FUNCTION public.hide_party(p_party_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_parties%rowtype;
  v_updated integer;
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
end;
$function$;

GRANT EXECUTE ON FUNCTION public.hide_party(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.hide_party(uuid) FROM PUBLIC, anon;

-- ---------- get_my_parties(): exclude whatever the caller has hidden ----------
-- Full body carried forward from migration 095, unchanged apart from the
-- added "and qpp.hidden_at is null" filter.

CREATE OR REPLACE FUNCTION public.get_my_parties()
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
    and qpp.hidden_at is null
  order by qp.created_at desc;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_parties() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_parties() FROM PUBLIC, anon;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('hide_party', 'Client RPC (the ? Party tab''s own list, swipe-to-delete) -- hides a completed/expired party from the caller''s own list only (sets hidden_at on their own question_party_participants row); never touches what any other participant sees or the underlying party/results data. Migration 097 (2026-10-29).')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As a participant in a completed party, call hide_party(<that
--    party's id>) -- succeeds, and get_my_parties() no longer returns
--    that party for you.
-- 2. As a DIFFERENT participant of that same party, call
--    get_my_parties() -- the party is still there for them (hidden_at is
--    per-row, not shared), and get_party_results(<its token>) still
--    returns full results for everyone, confirming nothing was deleted.
-- 3. As a participant in a still-open (not yet expired) party, call
--    hide_party(<that party's id>) -- rejected with "You can only remove
--    a party once it's completed or expired."
-- 4. As someone who was never a participant in a given party, call
--    hide_party(<its id>) -- rejected with "You are not a participant in
--    this party."
-- ============================================================
