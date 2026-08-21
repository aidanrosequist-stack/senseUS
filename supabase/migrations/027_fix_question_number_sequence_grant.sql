-- senseUS: narrow the questions_question_number_seq grant
--
-- PROBLEM (flagged 2026-08-18 in the security-hardening session, from a
-- live schema dump, never fixed): the live database has
-- `GRANT ALL ON SEQUENCE questions_question_number_seq TO anon, authenticated`.
-- ALL on a sequence includes USAGE, SELECT, and UPDATE — UPDATE is what
-- lets a role call setval() directly, meaning any authenticated user (or
-- even anon, with just the public anon key) could manually rewind or
-- fast-forward the sequence that assigns questions.question_number,
-- corrupting future inserts or colliding numbers, independent of any
-- RLS policy on the questions table itself.
--
-- FIX: confirmed via a grep of the frontend that `questions` rows are
-- only ever inserted from Admin.jsx, as the calling admin's own
-- `authenticated` session (relying on questions' own INSERT policy to
-- gate that to admins) — never via `anon`, and never via a
-- SECURITY DEFINER RPC that would insert as a different role. That
-- INSERT uses the column default `nextval(...)`, which needs the
-- inserting role to hold USAGE on the sequence — so `authenticated`
-- still needs *something* here, just not the full ALL grant. `anon`
-- never inserts into `questions` at all and needs nothing.
-- ============================================================

revoke all on sequence public.questions_question_number_seq from anon, authenticated;
grant usage on sequence public.questions_question_number_seq to authenticated;
