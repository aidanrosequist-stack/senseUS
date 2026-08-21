-- senseUS: Cache Transparency.jsx's public stats instead of live-counting
--
-- PROBLEM (found in scaling audit, 2026-08-21, finding #15):
-- Transparency.jsx ran four `count: 'exact', head: true` queries (a full
-- scan under the hood) against profiles/questions/votes/comments,
-- uncached, on every visit to this public, unauthenticated page — plus
-- an unlimited select on transparency_events. votes is the largest,
-- fastest-growing table in the app, so this got linearly slower as it
-- grew, on a page with no rate limiting.
--
-- FIX (architecture confirmed with the user, 2026-08-21):
-- A scheduled function + a small cache table, refreshed daily via
-- pg_cron — the same pattern this codebase already uses for
-- take_question_snapshots, run_integrity_checks, etc. (rather than a
-- Postgres materialized view, which isn't a pattern used elsewhere
-- here). The user confirmed daily freshness is fine for a public "about
-- the numbers" page — it doesn't need to be exact-to-the-minute.
--
-- transparency_stats_cache is a deliberate singleton: the boolean
-- primary key with `check (id)` makes it physically impossible for more
-- than one row to exist, so the page never has to guess which row is
-- current.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transparency_stats_cache (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  user_count bigint NOT NULL DEFAULT 0,
  question_count bigint NOT NULL DEFAULT 0,
  vote_count bigint NOT NULL DEFAULT 0,
  comment_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transparency_stats_cache ENABLE ROW LEVEL SECURITY;

-- Read-only, aggregate-only counts with no PII — same public-read model
-- Transparency.jsx already relied on when it queried the live tables
-- directly with the anon key.
DROP POLICY IF EXISTS "Anyone can read transparency stats" ON public.transparency_stats_cache;
CREATE POLICY "Anyone can read transparency stats"
  ON public.transparency_stats_cache FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.refresh_transparency_stats()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.transparency_stats_cache (id, user_count, question_count, vote_count, comment_count, updated_at)
  values (
    true,
    (select count(*) from public.profiles),
    (select count(*) from public.questions where published_at is not null),
    (select count(*) from public.votes),
    (select count(*) from public.comments where is_deleted = false),
    now()
  )
  on conflict (id) do update set
    user_count = excluded.user_count,
    question_count = excluded.question_count,
    vote_count = excluded.vote_count,
    comment_count = excluded.comment_count,
    updated_at = excluded.updated_at;
end;
$function$;

-- Backend-only, same pattern as run_integrity_checks/take_question_snapshots
-- (migration 014): revoked from client roles, granted only to the roles
-- pg_cron actually runs as.
revoke execute on function public.refresh_transparency_stats() from public, anon, authenticated;
grant execute on function public.refresh_transparency_stats() to postgres, service_role;

-- Daily, clear of the 7am/8am report cron jobs (migration 002).
select cron.schedule(
  'refresh-transparency-stats',
  '0 5 * * *',
  $$select public.refresh_transparency_stats();$$
);

-- Seed the cache immediately so the page has real numbers right away
-- instead of waiting up to 24h for the first scheduled run.
select public.refresh_transparency_stats();
