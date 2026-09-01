-- migration: 059_question_articles_url_scheme_check.sql
--
-- question_articles.url had no scheme validation anywhere - not in
-- Admin.jsx's addArticle() (only checks non-empty), not as a DB
-- constraint. These URLs render straight to every end user viewing
-- Make Up My Mind (MakeUpMyMind.jsx: <a href={article.url} target="_blank"
-- rel="noopener noreferrer">) - rel is already correctly set on all three
-- target="_blank" spots in the app, but nothing stopped `url` from being
-- a javascript: or data:text/html,... URI instead of a real link. Gated
-- behind admin-only write access today (question_articles' RLS only
-- grants ALL to is_admin_user(), migration 041), so not exploitable by
-- an ordinary user right now - but an admin typo, a compromised admin
-- session, or a bad paste from a CMS-y workflow would otherwise be able
-- to get arbitrary-JS-on-your-real-origin content in front of every
-- reader who clicks that article link. Matches this project's own
-- standing pattern: the client-side check is UX, the DB constraint is
-- the actual enforcement.
--
-- IMPORTANT before running `supabase db push`: this will fail to apply
-- if any existing row already has a non-http(s) url. Worth running this
-- against production first to confirm it's safe:
--
--   select id, url from question_articles where url !~* '^https?://';
--
-- If that returns any rows, fix or remove them before pushing this
-- migration, or the ADD CONSTRAINT below will error out.

ALTER TABLE public.question_articles
  ADD CONSTRAINT question_articles_url_scheme_check
  CHECK (url ~* '^https?://');
