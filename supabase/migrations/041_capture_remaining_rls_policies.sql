-- senseUS: capture the remaining RLS policies that were created by hand
-- and never made it into a migration file.
--
-- Same root cause documented throughout this history (0000/000's table
-- merge, is_admin_user() in 000_functions.sql, the two views in the same
-- file): objects created directly in the Dashboard are invisible to
-- `supabase db pull` until they're captured somewhere, and were invisible
-- to a plain grep of this directory before that.
--
-- Pulled 2026-08-24 via:
--   select tablename, policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, policyname;
--
-- That returned 50 policies live. 8 of them already have a matching
-- CREATE POLICY somewhere in this history (anomaly_log x2 in 001/013,
-- integrity_events x2 in 010, admin_actions/function_heartbeats/
-- policy_snapshot in 032/033/034, transparency_stats_cache in 024) and
-- are deliberately NOT repeated here to avoid a "policy already exists"
-- error when this replays after those migrations. The 42 below are
-- everything else -- every RLS policy in the live database with no
-- migration-file counterpart at all, on the 15 core tables that have
-- existed since before this project's migration history started.
--
-- Every qual/with_check expression below is copied verbatim from the
-- live pg_policies output -- nothing rewritten, nothing "improved."
-- This migration's only job is to make the migration history an
-- accurate record of what's actually enforced in production, the same
-- narrow scope every other capture-the-hand-created-thing migration in
-- this project has stuck to.
--
-- CORRECTION: the first version of this file shipped without the DROP
-- POLICY IF EXISTS lines below, and `supabase db push` failed
-- immediately -- "policy already exists" on the very first statement.
-- Obvious in hindsight: unlike the tables/function/views this history
-- has captured with CREATE OR REPLACE, CREATE POLICY has no such
-- variant, and these 42 policies already exist for real in production
-- (that's the entire reason they're being captured). A plain
-- `db push` doesn't just update version-tracking metadata here the way
-- it does for 000_functions.sql -- it actually executes this file's
-- SQL against the live database, since version 041 was never applied
-- before. Fixed using the same drop-then-recreate pattern migration 013
-- already established for exactly this situation: each policy is
-- dropped (a no-op if it doesn't exist, e.g. on a fresh/CI database)
-- immediately before being recreated with the identical definition
-- pulled from production, so this is now safe to run against either.
-- ============================================================

-- ---------- app_settings ----------

DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;
CREATE POLICY "Admins can update settings"
  ON public.app_settings FOR UPDATE
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Anyone can view settings" ON public.app_settings;
CREATE POLICY "Anyone can view settings"
  ON public.app_settings FOR SELECT
  TO public
  USING (true);

-- ---------- article_views ----------

DROP POLICY IF EXISTS "Users can insert own article views" ON public.article_views;
CREATE POLICY "Users can insert own article views"
  ON public.article_views FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own article views" ON public.article_views;
CREATE POLICY "Users can view own article views"
  ON public.article_views FOR SELECT
  TO public
  USING ((SELECT auth.uid()) = user_id);

-- ---------- comment_flags ----------

DROP POLICY IF EXISTS "Admins can view all flags" ON public.comment_flags;
CREATE POLICY "Admins can view all flags"
  ON public.comment_flags FOR SELECT
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Users can flag comments" ON public.comment_flags;
CREATE POLICY "Users can flag comments"
  ON public.comment_flags FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own flags" ON public.comment_flags;
CREATE POLICY "Users can view own flags"
  ON public.comment_flags FOR SELECT
  TO public
  USING (auth.uid() = user_id);

-- ---------- comment_resonances ----------

DROP POLICY IF EXISTS "Authenticated users can view resonances" ON public.comment_resonances;
CREATE POLICY "Authenticated users can view resonances"
  ON public.comment_resonances FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can delete own resonances" ON public.comment_resonances;
CREATE POLICY "Users can delete own resonances"
  ON public.comment_resonances FOR DELETE
  TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own resonances" ON public.comment_resonances;
CREATE POLICY "Users can insert own resonances"
  ON public.comment_resonances FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.comments
      WHERE comments.id = comment_resonances.comment_id
        AND comments.user_id <> auth.uid()
    )
  );

-- ---------- comments ----------

DROP POLICY IF EXISTS "Admins can update any comment" ON public.comments;
CREATE POLICY "Admins can update any comment"
  ON public.comments FOR UPDATE
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Authenticated users can view comments" ON public.comments;
CREATE POLICY "Authenticated users can view comments"
  ON public.comments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can insert own comments" ON public.comments;
CREATE POLICY "Users can insert own comments"
  ON public.comments FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON public.comments;
CREATE POLICY "Users can update own comments"
  ON public.comments FOR UPDATE
  TO public
  USING ((SELECT auth.uid()) = user_id);

-- ---------- comparison_tokens ----------

DROP POLICY IF EXISTS "Accept or decline unclaimed tokens" ON public.comparison_tokens;
CREATE POLICY "Accept or decline unclaimed tokens"
  ON public.comparison_tokens FOR UPDATE
  TO public
  USING (recipient_id IS NULL AND expires_at > now())
  WITH CHECK ((status = 'accepted' AND auth.uid() = recipient_id) OR status = 'declined');

DROP POLICY IF EXISTS "Create own tokens" ON public.comparison_tokens;
CREATE POLICY "Create own tokens"
  ON public.comparison_tokens FOR INSERT
  TO public
  WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "View own or unclaimed tokens" ON public.comparison_tokens;
CREATE POLICY "View own or unclaimed tokens"
  ON public.comparison_tokens FOR SELECT
  TO public
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id OR recipient_id IS NULL);

-- ---------- exports ----------

DROP POLICY IF EXISTS "Users can request own exports" ON public.exports;
CREATE POLICY "Users can request own exports"
  ON public.exports FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own exports" ON public.exports;
CREATE POLICY "Users can view own exports"
  ON public.exports FOR SELECT
  TO public
  USING (auth.uid() = user_id);

-- ---------- notifications ----------

DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO public
  USING ((SELECT auth.uid()) = user_id);

-- ---------- profiles ----------

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO public
  USING (is_admin_user());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO public
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO public
  USING ((SELECT auth.uid()) = id);

-- ---------- question_articles ----------

DROP POLICY IF EXISTS "Admins can do everything on question_articles" ON public.question_articles;
CREATE POLICY "Admins can do everything on question_articles"
  ON public.question_articles FOR ALL
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Public can view active articles" ON public.question_articles;
CREATE POLICY "Public can view active articles"
  ON public.question_articles FOR SELECT
  TO public
  USING (is_active = true);

-- ---------- question_skips ----------

DROP POLICY IF EXISTS "Users can delete own skips" ON public.question_skips;
CREATE POLICY "Users can delete own skips"
  ON public.question_skips FOR DELETE
  TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own skips" ON public.question_skips;
CREATE POLICY "Users can insert own skips"
  ON public.question_skips FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own skips" ON public.question_skips;
CREATE POLICY "Users can view own skips"
  ON public.question_skips FOR SELECT
  TO public
  USING (auth.uid() = user_id);

-- ---------- questions ----------

DROP POLICY IF EXISTS "Admins can do everything on questions" ON public.questions;
CREATE POLICY "Admins can do everything on questions"
  ON public.questions FOR ALL
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Authenticated users can view published questions" ON public.questions;
CREATE POLICY "Authenticated users can view published questions"
  ON public.questions FOR SELECT
  TO authenticated
  USING (published_at IS NOT NULL AND published_at <= now());

DROP POLICY IF EXISTS "Public can view published questions" ON public.questions;
CREATE POLICY "Public can view published questions"
  ON public.questions FOR SELECT
  TO public
  USING (published_at IS NOT NULL AND published_at <= now());

-- ---------- sponsored_questions ----------

DROP POLICY IF EXISTS "Admins can manage sponsored questions" ON public.sponsored_questions;
CREATE POLICY "Admins can manage sponsored questions"
  ON public.sponsored_questions FOR ALL
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- ---------- transparency_events ----------

DROP POLICY IF EXISTS "Admins can manage transparency events" ON public.transparency_events;
CREATE POLICY "Admins can manage transparency events"
  ON public.transparency_events FOR ALL
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

DROP POLICY IF EXISTS "Anyone can view public transparency events" ON public.transparency_events;
CREATE POLICY "Anyone can view public transparency events"
  ON public.transparency_events FOR SELECT
  TO public
  USING (is_public = true);

-- ---------- vote_changes ----------

DROP POLICY IF EXISTS "Users can view own vote changes" ON public.vote_changes;
CREATE POLICY "Users can view own vote changes"
  ON public.vote_changes FOR SELECT
  TO public
  USING (auth.uid() = user_id);

-- ---------- votes ----------

DROP POLICY IF EXISTS "Admins can view all votes" ON public.votes;
CREATE POLICY "Admins can view all votes"
  ON public.votes FOR SELECT
  TO public
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

DROP POLICY IF EXISTS "Users can insert own votes" ON public.votes;
CREATE POLICY "Users can insert own votes"
  ON public.votes FOR INSERT
  TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own votes" ON public.votes;
CREATE POLICY "Users can update own votes"
  ON public.votes FOR UPDATE
  TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own votes" ON public.votes;
CREATE POLICY "Users can view own votes"
  ON public.votes FOR SELECT
  TO public
  USING ((SELECT auth.uid()) = user_id);
