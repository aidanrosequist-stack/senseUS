-- migration: 067_add_question_snapshots_read_policy.sql
--
-- CONTEXT (Aidan, 2026-09-02): found while reviewing the Security
-- Advisor's 7 "Info" suggestions, all "RLS Enabled No Policy". Six of
-- the seven flagged tables (authorized_admins,
-- intentionally_public_functions, intentionally_public_views,
-- profiles_client_writable_columns, protected_trigger_coverage,
-- question_categories) are internal-only -- nothing in src/ queries
-- them directly, they're only touched by SECURITY DEFINER functions
-- running as postgres (which owns the tables and bypasses RLS
-- entirely), so having zero policies is the deliberate locked-down
-- state and correct as-is.
--
-- question_snapshots is the exception, and a real bug: RLS has been
-- enabled on it since migration 000 but no policy was ever added, and
-- Activity.jsx's fetchHistory() queries it directly from the client
-- (`supabase.from('question_snapshots').select(...)`) to build the
-- 7-day trend indicator on the Shifts tab. With no policy, every one of
-- those queries silently returns zero rows for every user -- not an
-- error, just empty -- so the trend indicator has been rendering as
-- flat/no-data regardless of the real snapshot data underneath. This
-- matches the still-unchecked item on the app walkthrough checklist:
-- "7-day trend indicator reflects real snapshot data, not always flat."
--
-- Fix: a plain read policy for signed-in users. The data itself is
-- non-sensitive -- per-question aggregate yes/no percentages and vote
-- counts by date, no user-level information at all -- so this is the
-- same "public aggregate, read-only" shape as
-- transparency_stats_cache's policy (migration 024), scoped to
-- `authenticated` only since question_snapshots is only ever read from
-- Activity.jsx, a signed-in-only page (unlike Transparency.jsx, which
-- is public/unauthenticated).
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read question snapshots" ON public.question_snapshots;
CREATE POLICY "Authenticated users can read question snapshots"
  ON public.question_snapshots FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the policy exists:
--    select policyname, cmd, roles from pg_policies
--    where tablename = 'question_snapshots';
--    -> should return exactly one row, cmd = 'SELECT', roles = '{authenticated}'.
--
-- 2. Confirm real data is now reachable (as a normal authenticated
--    query would see it -- run in the SQL Editor as postgres won't
--    prove this on its own, since postgres bypasses RLS as table
--    owner; the real check is in the app -- open Activity > Shifts for
--    an account with vote history and confirm the 7-day trend is no
--    longer always flat).
-- ============================================================
