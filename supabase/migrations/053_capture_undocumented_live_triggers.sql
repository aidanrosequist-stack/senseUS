-- senseUS: capture five triggers that exist live but were never written into
-- any migration file — found 2026-08-28 during the first-ever full
-- structural diff between production (via `supabase db dump --linked
-- --schema public`) and a from-scratch replay of the entire migration
-- history (000 through 052) on a local Postgres 16 instance.
--
-- CONTEXT: this is the exact bug class this project has hit twice before
-- (public_votes/public_profiles in migration 049; is_admin_user and a
-- handful of RLS policies documented as "fixed live, never in git" in
-- earlier migrations) -- something set up by hand in Supabase Studio,
-- working correctly in production, invisible to every file-based review,
-- and silently absent from any fresh build (CI, local dev, a
-- disaster-recovery restore, or a future migration to a new Supabase
-- project). The difference this time: instead of finding it via a
-- secondhand comment or a handful of manual SQL queries, this is the
-- first time the *entire* schema was diffed structurally end-to-end --
-- tables, columns, indexes, constraints, views + security_invoker,
-- function signatures + search_path, RLS policies, and grants all came
-- back with zero drift. Triggers were the only category with any gap,
-- and it was a clean, complete list: exactly 5 live triggers with no
-- matching CREATE TRIGGER anywhere in git, nothing else.
--
-- Four of these are real, currently-load-bearing protections with no
-- fallback if this migration didn't exist:
--
--   1. comments.moderate_comment_trigger (BEFORE INSERT OR UPDATE,
--      -> moderate_comment()) -- this is what actually sets is_flagged
--      on a new or edited comment. Without it, a fresh environment built
--      from migrations alone would accept every comment unflagged,
--      regardless of content -- the automated moderation this project
--      depends on simply wouldn't run.
--   2. comments.set_updated_at (BEFORE UPDATE -> handle_updated_at())
--   3. question_articles.set_updated_at (BEFORE UPDATE ->
--      handle_updated_at()) -- both cosmetic/data-integrity only
--      (updated_at wouldn't auto-refresh on edit), not a security gap.
--   4. votes.block_archived_votes (BEFORE INSERT OR UPDATE ->
--      block_archived_question_votes()) -- this is the one that actually
--      enforces "voting is closed once a question is archived" at the
--      database level. Without it, a fresh environment (or, in the worst
--      case, production itself if this trigger were ever accidentally
--      dropped, since nothing in git or in run_security_checks() would
--      catch that) would silently accept votes on archived questions
--      indefinitely. This is the highest-severity item in this
--      migration -- functionally equivalent in kind (not enforced
--      anywhere except a hand-created trigger no one else can see) to
--      what the public_votes/public_profiles bug was structurally.
--
-- The 5th, profiles.protect_admin_columns_trigger (BEFORE UPDATE ->
-- protect_admin_columns()), is NOT an additional protection -- it's a
-- pure subset of profiles.protect_admin_columns_insert_update (BEFORE
-- INSERT OR UPDATE, same function), which migration 029 added to close
-- the critical admin-escalation-via-INSERT bug documented in
-- senseUS-deep-security-review-findings.md. Best guess: this is the
-- original migration-011-era trigger that 029 was supposed to replace,
-- left in place by hand instead of dropped when the INSERT-covering one
-- was added. Its only live effect is running protect_admin_columns()
-- twice on every UPDATE to profiles -- harmless (the function is
-- idempotent), just redundant. Captured here as-is rather than silently
-- dropped, matching this project's established "don't remove a live
-- behavior without an explicit decision" pattern (the same reasoning
-- migration 051 used to leave public_votes defined-but-ungranted rather
-- than dropping it) -- if you'd rather it just go away, that's a
-- one-line follow-up migration (`DROP TRIGGER
-- protect_admin_columns_trigger ON public.profiles;`) once you've
-- confirmed you don't want it kept for any reason.
--
-- Nothing else was found. Every table's RLS flag, every view's
-- security_invoker setting, every function's signature/security
-- definer-or-invoker/search_path, every RLS policy's exact qual/with_check
-- text, every table/view/function/sequence grant to anon/authenticated/
-- PUBLIC, every column, and every index matched exactly between the
-- from-scratch migration replay and the live production dump. (Two
-- expected, non-issue mismatches during the diff, noted for the record:
-- the replay's test harness only simulates 4 of Supabase's real 7
-- default per-table grant privileges to anon/authenticated -- TRUNCATE/
-- REFERENCES/TRIGGER are also granted by Supabase's actual bootstrap,
-- same already-accepted "RLS is the real gate, PostgREST doesn't expose
-- TRUNCATE" design noted in senseUS-security-hardening-handoff.md; and
-- pg_cron/pg_net didn't appear in the live dump only because `--schema
-- public` doesn't capture extensions installed in Supabase's `extensions`
-- schema, not because they're actually missing from production.)
--
-- Applying this migration changes NOTHING about production's live
-- behavior -- every one of these triggers already exists and is already
-- running there. It only makes them visible to git, CI, and any future
-- fresh build, the same way migrations 049-052 already did for views and
-- function grants.
-- ============================================================

DROP TRIGGER IF EXISTS moderate_comment_trigger ON public.comments;
CREATE TRIGGER moderate_comment_trigger
  BEFORE INSERT OR UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.moderate_comment();

DROP TRIGGER IF EXISTS set_updated_at ON public.comments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.question_articles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.question_articles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS block_archived_votes ON public.votes;
CREATE TRIGGER block_archived_votes
  BEFORE INSERT OR UPDATE ON public.votes
  FOR EACH ROW EXECUTE FUNCTION public.block_archived_question_votes();

-- Captured as-is, redundant-but-harmless -- see note above.
DROP TRIGGER IF EXISTS protect_admin_columns_trigger ON public.profiles;
CREATE TRIGGER protect_admin_columns_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_admin_columns();

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- All 5 should already exist and be unaffected by this migration (it
-- only reapplies what's already live) -- confirm with:
--
--   select tgname, tgrelid::regclass, pg_get_triggerdef(oid)
--   from pg_trigger
--   where tgname in ('moderate_comment_trigger','set_updated_at',
--                     'block_archived_votes','protect_admin_columns_trigger')
--     and not tgisinternal
--   order by tgrelid::regclass::text, tgname;
--   -> 5 rows, definitions matching exactly what's in this file.
-- ============================================================
