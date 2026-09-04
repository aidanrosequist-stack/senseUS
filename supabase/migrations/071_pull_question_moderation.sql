-- senseUS: a real "pull this question" mechanism, actually enforced
--
-- CONTEXT (Aidan, 2026-09-04): flagged question #210 (British monarchy) for
-- human moderation via a direct SQL update, then noticed he could still
-- open its vote card from the Activity Revisit tab shortly afterward, and
-- asked: "if a question is published and then flagged afterward, shouldn't
-- it be pulled so that no one sees it anymore?" -- yes, and auditing the
-- actual code confirmed there was no real mechanism for that at all:
--
-- - The only lever admin ever had over an already-*live* question was
--   unpublishing it (published_at = null, Admin.jsx's togglePublish). RLS
--   does enforce that one column (migration 041) -- but only that column.
-- - `human_moderation_required` (the column that actually exists for this)
--   is wired up as a pre-*publish* review gate only -- Admin's Review Queue
--   only ever shows *unpublished* flagged rows (`is('published_at', null)`
--   in loadFlaggedQuestions()), and there's no admin action anywhere that
--   sets it true on an already-published question. RLS doesn't reference
--   it at all, so even if it had been set on a live row, every non-admin
--   read path would still show the question.
-- - Several read paths (Conversation.jsx's single-question fetch,
--   Vote.jsx's ?question=<id> deep-link fetch) apply *no* status filter of
--   their own at all -- they rely entirely on RLS. Fine for `published_at`
--   (RLS covers it), but nothing at all stood between a flagged question
--   and a fresh visit via a shared link, a deep link, or a stale cached
--   feed's question ID.
-- - Worst of all: cast_vote() -- the actual vote-recording RPC -- never
--   read `questions` at all. It only requires the caller be authenticated
--   and the question ID to exist as a foreign key target. A flagged,
--   unpublished, or archived question's ID reaching the client through ANY
--   of the above gaps would have let a real vote land on it regardless.
--
-- FIX: a new, single-purpose `pulled_at` column, distinct from both
-- `published_at` (draft vs. live, a normal pre-launch state) and
-- `archived_at` (a question's normal end-of-life, still meant to be
-- visible in someone's own past history/conversation). "Pulled" means
-- something found to be a real problem after the fact -- Aidan's call
-- (2026-09-04): once pulled, a question and its conversation become
-- invisible to *everyone* who isn't an admin, including people who already
-- voted or commented on it before it was pulled. Enforced at the RLS layer
-- (so every read path is covered at once, including the two that apply no
-- client-side filter of their own) and inside cast_vote() itself (so a
-- question ID reaching the client through any gap still can't collect a
-- new vote).
--
-- Existing votes/comments on a pulled question are left in place (not
-- deleted) -- this hides the question from view rather than erasing the
-- record, consistent with how the app already treats archived questions
-- and soft-deleted comments elsewhere.
-- ============================================================

ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS pulled_at timestamptz;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS pulled_reason text;

-- ---------- questions RLS: the actual enforcement point ----------
-- Admins keep the existing "FOR ALL ... USING (is_admin)" policy untouched
-- (migration 041) -- they need to see pulled questions to manage them, and
-- Postgres RLS is permissive (any matching policy grants access), so
-- adding pulled_at to these two SELECT policies only narrows what
-- non-admins can see; it doesn't need to be repeated on the admin policy.

DROP POLICY IF EXISTS "Authenticated users can view published questions" ON public.questions;
CREATE POLICY "Authenticated users can view published questions"
  ON public.questions FOR SELECT
  TO authenticated
  USING (published_at IS NOT NULL AND published_at <= now() AND pulled_at IS NULL);

DROP POLICY IF EXISTS "Public can view published questions" ON public.questions;
CREATE POLICY "Public can view published questions"
  ON public.questions FOR SELECT
  TO public
  USING (published_at IS NOT NULL AND published_at <= now() AND pulled_at IS NULL);

-- ---------- comments RLS: defense in depth ----------
-- "Authenticated users can view comments" was previously USING (true) --
-- unconditional. Conversation.jsx wouldn't normally surface a pulled
-- question's comments (it can no longer even load the question row to
-- render the page), but a client calling
-- `supabase.from('comments').select(...).eq('question_id', ...)` directly
-- would have bypassed that entirely, since this policy never looked at the
-- parent question at all. Same story for inserting a brand new comment
-- onto a pulled question via a direct API call.
--
-- Important: unlike `questions`, `comments` has NO separate admin "FOR ALL"
-- policy -- admins have always relied on this same SELECT policy (it used
-- to be unconditional `USING (true)`, so it worked for everyone including
-- admins). Admin.jsx's Flagged Comments queue (loadFlaggedComments) queries
-- `comments` directly with no question-status filter of its own, relying
-- entirely on this policy. Tightening it to `pulled_at IS NULL` alone would
-- have hidden a pulled question's comments from admins too -- breaking
-- their ability to review the very comments that may have gotten it pulled
-- in the first place. `OR is_admin_user()` keeps admins seeing every
-- comment regardless of pulled_at, same as they already can for questions.
DROP POLICY IF EXISTS "Authenticated users can view comments" ON public.comments;
CREATE POLICY "Authenticated users can view comments"
  ON public.comments FOR SELECT
  TO authenticated
  USING (
    public.is_admin_user()
    OR EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = comments.question_id AND q.pulled_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can insert own comments" ON public.comments;
CREATE POLICY "Users can insert own comments"
  ON public.comments FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = comments.question_id AND q.pulled_at IS NULL
    )
  );

-- ---------- cast_vote(): the vote-recording RPC itself ----------
-- CREATE OR REPLACE keeps the existing (uuid, text) signature and its
-- 6-column RETURNS TABLE (migration 055) unchanged, so no DROP/re-GRANT
-- needed this time -- only the cooldown-check body gains one more check
-- ahead of it, using the exact same "return normally with rejected_reason
-- set, don't raise" pattern migration 055 established (so a blocked
-- attempt still logs durably rather than rolling back its own log entry --
-- see that migration's own comment for why raising here would be wrong).

CREATE OR REPLACE FUNCTION public.cast_vote(p_question_id uuid, p_choice text)
 RETURNS TABLE(yes bigint, ly bigint, ln bigint, no bigint, total bigint, rejected_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_was_insert boolean;
  v_last_vote_at timestamptz;
  v_pulled_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Unauthorized: you must be signed in to vote.';
  end if;

  if p_choice not in ('yes','ly','ln','no','dec') then
    raise exception 'Invalid vote choice.';
  end if;

  select q.pulled_at into v_pulled_at from public.questions q where q.id = p_question_id;

  if v_pulled_at is not null then
    perform public.log_anomaly_only(
      'vote_on_pulled_question_blocked',
      'low',
      jsonb_build_object('user_id', v_user_id, 'question_id', p_question_id, 'attempted_choice', p_choice),
      p_question_id
    );

    return query
    select
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
      count(*) as total,
      'question_pulled'::text as rejected_reason
    from public.votes v
    where v.question_id = p_question_id;
    return;
  end if;

  select p.last_vote_at into v_last_vote_at from public.profiles p where p.id = v_user_id;

  if v_last_vote_at is not null and now() - v_last_vote_at < interval '1 second' then
    perform public.log_anomaly_only(
      'vote_cooldown_blocked',
      'low',
      jsonb_build_object(
        'user_id', v_user_id,
        'question_id', p_question_id,
        'attempted_choice', p_choice,
        'seconds_since_last_vote', extract(epoch from (now() - v_last_vote_at))
      ),
      p_question_id
    );

    return query
    select
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
      round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
      count(*) as total,
      'cooldown'::text as rejected_reason
    from public.votes v
    where v.question_id = p_question_id;
    return;
  end if;

  insert into public.votes (user_id, question_id, choice, updated_at)
  values (v_user_id, p_question_id, p_choice, now())
  on conflict (user_id, question_id)
  do update set choice = excluded.choice, updated_at = now()
  returning (xmax = 0) into v_was_insert;

  perform set_config('senseus.bypass_last_vote_at_protection', 'true', true);
  update public.profiles set last_vote_at = now() where id = v_user_id;

  if v_was_insert then
    perform set_config('senseus.bypass_answers_count_protection', 'true', true);
    update public.profiles
    set answers_count = answers_count + 1
    where id = v_user_id;
  end if;

  return query
  select
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'yes'), 0))::bigint as yes,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ly'), 0))::bigint as ly,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'ln'), 0))::bigint as ln,
    round(coalesce(sum(v.integrity_weight_at_vote) filter (where v.choice = 'no'), 0))::bigint as no,
    count(*) as total,
    null::text as rejected_reason
  from public.votes v
  where v.question_id = p_question_id;
end;
$function$;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Pull a real (test) question: `update questions set pulled_at = now(),
--    pulled_reason = 'test' where id = '<some question id>';` then, as a
--    NON-admin session: confirm `select * from questions where id =
--    '<id>'` returns zero rows, confirm `select * from comments where
--    question_id = '<id>'` returns zero rows even if comments existed
--    before, and confirm `select cast_vote('<id>', 'yes')` returns
--    normally with rejected_reason = 'question_pulled' and does NOT
--    change/insert a row in `votes` for that user+question.
--
-- 2. As an ADMIN session, confirm the same question still shows up
--    normally (RLS's admin "FOR ALL" policy is unaffected by this
--    migration).
--
-- 3. Unpull it (`update questions set pulled_at = null where id =
--    '<id>';`) and confirm it becomes visible/votable again for a
--    non-admin session, and that inserting a new comment as that user now
--    succeeds again.
--
-- 4. Confirm the blocked-vote attempt from test 1 is queryable:
--    `select * from anomaly_log where alert_type =
--    'vote_on_pulled_question_blocked' order by triggered_at desc limit
--    5;`
-- ============================================================
