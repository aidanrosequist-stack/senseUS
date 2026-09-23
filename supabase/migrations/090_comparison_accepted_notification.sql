-- migration: 090_comparison_accepted_notification.sql
--
-- CONTEXT (Aidan, 2026-09-23): "I used the compare feature last night, and
-- realized that there's no notification in the system that tells you when
-- the compare has been accepted." Confirmed: notification_preferences
-- (migration 075) already has a push_comparison_accepted column, default
-- on -- the preference was designed in ahead of time but nothing ever
-- actually inserted this notification. This migration wires it up.
--
-- Two parts:
--
-- 1. notifications.type's CHECK constraint gets a new allowed value,
--    'comparison_accepted' -- none of the existing eight values fit
--    (milestone/welcome are earmarked for streak/tier-milestone and
--    onboarding respectively, per the notification-preferences design
--    notes, so reusing either would be misleading in anyone's history).
--
-- 2. accept_comparison_token() (last touched in migration 074) now
--    inserts a notification for the ORIGINAL SENDER once an invite is
--    accepted -- not the accepter, who already sees the comparison
--    immediately in Compare.jsx. Only fires on the real success path
--    (the final `return query select null::text`), never on any of the
--    rejected_reason branches, so a bad-token guess or an
--    already-processed link never generates a spurious notification.
--
-- Display name handling deliberately mirrors getDisplayName() in
-- Compare.jsx / Conversation.jsx / the og-preview edge function (three
-- copies now, all kept in sync by hand -- there's no shared server-side
-- helper for this yet): an anonymous accepter is named by their assigned
-- anon_name, never their real name, exactly as anywhere else in the app
-- that shows who did something. This is the same information the sender
-- already gets access to on the very next screen (Compare.jsx shows the
-- accepter's chosen display name once the comparison itself loads) --
-- the notification isn't exposing anything new, just announcing it
-- sooner.
-- ============================================================

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
    'comparison_accepted'::text
  ]));

-- ---------- accept_comparison_token(): notify the sender on real acceptance ----------
--
-- Signature is unchanged (still RETURNS TABLE(rejected_reason text)), so
-- CREATE OR REPLACE is enough here -- unlike 074's own change to this
-- function, this doesn't need a DROP first.
CREATE OR REPLACE FUNCTION public.accept_comparison_token(p_token text)
 RETURNS TABLE(rejected_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.comparison_tokens%rowtype;
  v_last_attempt_at timestamptz;
  v_accepter_name text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  select p.last_comparison_attempt_at into v_last_attempt_at
  from public.profiles p where p.id = auth.uid();

  if v_last_attempt_at is not null and now() - v_last_attempt_at < interval '1 second' then
    -- Same "return normally, don't raise" reasoning as cast_vote's own
    -- cooldown (migration 055): a RAISE EXCEPTION here would roll back
    -- this same transaction's log_anomaly_only() insert right along
    -- with it, defeating the point of a durable trail.
    perform public.log_anomaly_only(
      'comparison_token_guess_blocked',
      'low',
      jsonb_build_object('user_id', auth.uid(), 'attempted_token', p_token),
      null
    );

    return query select 'rate_limited'::text as rejected_reason;
    return;
  end if;

  perform set_config('senseus.bypass_comparison_attempt_protection', 'true', true);
  update public.profiles set last_comparison_attempt_at = now() where id = auth.uid();

  select * into v_row from public.comparison_tokens where token = p_token for update;

  -- These four checks return normally instead of raising -- see 074's own
  -- comment for why (a raised exception here would roll back the
  -- last_comparison_attempt_at write just above, defeating the rate limit
  -- on a run of bad-token guesses). Unchanged by this migration.
  if v_row.id is null then
    return query select 'not_found'::text as rejected_reason;
    return;
  end if;

  if v_row.sender_id = auth.uid() then
    return query select 'self_accept'::text as rejected_reason;
    return;
  end if;

  if v_row.status <> 'pending' then
    return query select 'already_processed'::text as rejected_reason;
    return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    update public.comparison_tokens set status = 'expired' where id = v_row.id;
    return query select 'expired'::text as rejected_reason;
    return;
  end if;

  update public.comparison_tokens
  set status = 'accepted', recipient_id = auth.uid()
  where id = v_row.id;

  -- NEW (090): let the sender know their invite was accepted. Same
  -- display_preference/anon_name handling as everywhere else in the app --
  -- see the migration header comment above. action_url points back at the
  -- same /compare/:token link the sender originally shared: Compare.jsx's
  -- own load() already resolves "the other person" relative to whoever is
  -- viewing (sender vs recipient), so the sender revisiting this exact URL
  -- correctly shows the now-completed comparison, not the original pending
  -- invite screen.
  select
    case
      when p.display_preference = 'anon' then coalesce(p.anon_name, 'Someone')
      when p.display_preference = 'first_only' then coalesce(p.first_name, 'Someone')
      else coalesce(p.first_name || ' ' || p.last_initial || '.', 'Someone')
    end
  into v_accepter_name
  from public.profiles p
  where p.id = auth.uid();

  insert into public.notifications (user_id, type, priority, title, body, action_url)
  values (
    v_row.sender_id,
    'comparison_accepted',
    'normal',
    '🤝 ' || v_accepter_name || ' accepted your comparison invite',
    'See how your answers line up on senseUS.',
    '/compare/' || p_token
  );

  return query select null::text as rejected_reason;
end;
$function$;

grant execute on function public.accept_comparison_token(text) to authenticated;
revoke execute on function public.accept_comparison_token(text) from public;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('accept_comparison_token', 'Client RPC (Compare.jsx) — accepts a comparison invite; enforces expiry, prevents self-accept and double-accept server-side. Migration 074 (2026-09-05) added the 1-second rate limit and rejected_reason return shape. Migration 090 (2026-09-23) added: on real acceptance, inserts a comparison_accepted notification for the original sender, naming the accepter per their own display_preference/anon_name, pointing back at the same /compare/:token link.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Constraint accepts the new value:
--    insert into notifications (user_id, type, priority, title, body)
--    values ('<a real user id>', 'comparison_accepted', 'normal', 'test', 'test');
--    -> succeeds. delete it again afterward.
--
-- 2. Full flow: create a real comparison invite as account A
--    (select create_comparison_token()), accept it as account B
--    (select accept_comparison_token('<the token>')), then as account A:
--    select * from notifications where user_id = '<A's id>'
--    order by created_at desc limit 1;
--    -> type = 'comparison_accepted', title names B (or B's anon_name if
--    B's display_preference is 'anon'), action_url = '/compare/<token>'.
--
-- 3. Confirm it's sender-only, not recipient-facing: the same query
--    filtered to account B's id should NOT show a comparison_accepted row
--    from this acceptance -- B sees the result immediately in the app,
--    they don't need a notification about their own action.
--
-- 4. Confirm none of the rejection paths insert anything: attempt
--    accept_comparison_token() with a bogus token, an already-accepted
--    token, and your own token as sender -- notifications table row count
--    for the relevant user(s) should not change in any of the three cases.
--
-- 5. Re-run the existing 074 rate-limit verification (two calls under 1
--    second apart, even with bad tokens) -- should still behave exactly
--    as before; this migration didn't touch that logic.
