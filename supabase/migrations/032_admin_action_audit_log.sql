-- senseUS: admin action audit log
--
-- PROBLEM (found in the 2026-08-22 hardening audit):
-- anomaly_log exists and works well, but it only ever records automated
-- fraud/abuse *detection* (registration spikes, vote manipulation,
-- coordinated signups, unauthorized admin grants). There is no record
-- anywhere of deliberate admin actions themselves — who broadcast
-- breaking news and when, who activated a sponsored question, who
-- cleared a flagged comment, who deleted or unpublished a question. For
-- a solo-admin app today that's low-stakes, but it's exactly the kind
-- of gap that matters the moment there's a second admin, or if admin
-- credentials were ever compromised — right now there'd be no trace of
-- what an attacker did with that access beyond what the automated
-- checks happen to already catch.
--
-- FIX: a straightforward admin_actions table, admin-readable only, plus
-- a generic log_admin_action() RPC for client-driven admin actions
-- (Admin.jsx does most of its own moderation/publishing directly via
-- table updates, not RPCs — converting every one of those into a full
-- RPC is a bigger refactor than this pass covers, so this gives
-- equivalent audit coverage without that). The two existing
-- SECURITY DEFINER admin RPCs (broadcast_breaking_news,
-- activate_sponsored_question) log themselves directly instead, since
-- they already have everything they need in scope.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.profiles(id),
  action_type text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON public.admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON public.admin_actions (admin_id);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Admin-readable only. No INSERT/UPDATE/DELETE policy at all for any
-- client role — every write goes through log_admin_action() or the two
-- RPCs below, both SECURITY DEFINER and both already admin-gated, so
-- there's no legitimate direct-client write path to this table and none
-- is being opened.
DROP POLICY IF EXISTS "Admins can view admin actions" ON public.admin_actions;
CREATE POLICY "Admins can view admin actions"
  ON public.admin_actions FOR SELECT
  TO authenticated
  USING (is_admin_user());

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type text,
  p_target_type text DEFAULT NULL,
  p_target_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, details)
  values (auth.uid(), p_action_type, p_target_type, p_target_id, p_details);
end;
$function$;

grant execute on function public.log_admin_action(text, text, uuid, jsonb) to authenticated;

-- Without this, run_security_checks() (013) would fire a
-- security_check_failed alert the next time it runs, since this
-- function now has an authenticated EXECUTE grant that isn't yet on the
-- allowlist it checks against.
insert into public.intentionally_public_functions (function_name, note) values
  ('log_admin_action', 'Client RPC (Admin.jsx) — self-checks is_admin_user() before writing, records an audit trail entry for direct-client admin actions that do not already go through their own logging RPC')
on conflict (function_name) do nothing;

-- broadcast_breaking_news — log who pushed what, and how many people
-- were actually notified.
CREATE OR REPLACE FUNCTION public.broadcast_breaking_news(p_question_id uuid)
 RETURNS TABLE(notified_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_question_text text;
  v_expires_at timestamptz := now() + interval '48 hours';
  v_notified bigint;
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  select text into v_question_text from public.questions where id = p_question_id;
  if v_question_text is null then
    raise exception 'Question not found.';
  end if;

  update public.questions
  set is_priority = true, priority_expires_at = v_expires_at
  where id = p_question_id;

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  select
    p.id, 'breaking_question', 'high',
    'We want your thoughts on a new question that was just added',
    v_question_text,
    '/vote?question=' || p_question_id
  from public.profiles p;

  get diagnostics v_notified = row_count;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, details)
  values (auth.uid(), 'broadcast_breaking_news', 'question', p_question_id,
    jsonb_build_object('question_text', v_question_text, 'notified_count', v_notified));

  return query select v_notified;
end;
$function$;

-- activate_sponsored_question — log who activated which sponsorship,
-- for which sponsor. Body otherwise unchanged from migration 014; only
-- the audit-log insert is new.
CREATE OR REPLACE FUNCTION public.activate_sponsored_question(p_sponsored_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_question_id uuid;
  v_sponsor_name text;
  v_domain text;
  v_duration_days integer;
  v_live_political_count integer;
begin
  if not is_admin_user() then
    raise exception 'Unauthorized.';
  end if;

  select sq.question_id, sq.sponsor_name, sq.duration_days, q.domain
  into v_question_id, v_sponsor_name, v_duration_days, v_domain
  from sponsored_questions sq
  join questions q on q.id = sq.question_id
  where sq.id = p_sponsored_id;

  if v_domain = 'politics & policy' then
    select count(*) into v_live_political_count
    from sponsored_questions sq2
    join questions q2 on q2.id = sq2.question_id
    where q2.domain = 'politics & policy' and sq2.status = 'live';

    if v_live_political_count >= 2 then
      raise exception 'Both political sponsorship slots are currently full.';
    end if;

    if exists (
      select 1 from sponsored_questions sq3
      join questions q3 on q3.id = sq3.question_id
      where sq3.sponsor_name = v_sponsor_name
        and q3.domain = 'politics & policy'
        and sq3.archived_at is not null
        and sq3.archived_at > now() - interval '90 days'
    ) then
      raise exception 'This sponsor is in cooldown and cannot activate another political sponsorship yet.';
    end if;

    if exists (
      select 1 from sponsored_questions sq4
      join questions q4 on q4.id = sq4.question_id
      where sq4.sponsor_name = v_sponsor_name
        and q4.domain = 'politics & policy'
        and sq4.status = 'live'
    ) then
      raise exception 'This sponsor already has a live political sponsorship.';
    end if;
  end if;

  update sponsored_questions
  set status = 'live', live_at = now()
  where id = p_sponsored_id;

  update questions
  set is_sponsored = true,
      sponsor_id = p_sponsored_id,
      published_at = coalesce(published_at, now()),
      archive_at = now() + (v_duration_days || ' days')::interval
  where id = v_question_id;

  insert into public.admin_actions (admin_id, action_type, target_type, target_id, details)
  values (auth.uid(), 'activate_sponsored_question', 'sponsored_question', p_sponsored_id,
    jsonb_build_object('question_id', v_question_id, 'sponsor_name', v_sponsor_name, 'domain', v_domain));
end;
$function$;
