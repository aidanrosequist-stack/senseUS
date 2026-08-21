-- senseUS: SET search_path on SECURITY DEFINER functions that were
-- missing it
--
-- PROBLEM (found in the 2026-08-21 deep security review):
-- Every function in this codebase is SECURITY DEFINER (runs with the
-- privileges of the function's owner, not the caller), which is why
-- self-checking auth everywhere is mandatory here — RLS is never a
-- backstop. A SECURITY DEFINER function that doesn't pin its own
-- search_path is vulnerable to a classic Postgres privilege-escalation
-- pattern: if an attacker can get an object of their own choosing (e.g.
-- a same-named function or table) earlier in the resolved search_path
-- than the intended `public` schema, the function can end up calling
-- the attacker's object instead of the real one, with the function
-- owner's privileges.
--
-- None of the functions below were found to be exploitable via the
-- separate "trusts a client-supplied user id" pattern this same review
-- swept for (that check came back clean) — this is a narrower, lower-
-- likelihood hardening pass, not a response to a confirmed live
-- exploit. Using ALTER FUNCTION ... SET search_path here instead of
-- CREATE OR REPLACE, specifically to touch only this one attribute and
-- carry zero risk of accidentally changing any function's actual logic.
-- ============================================================

alter function public.activate_sponsored_question(p_sponsored_id uuid) set search_path to 'public';
alter function public.archive_due_questions() set search_path to 'public';
alter function public.calculate_all_integrity_weights() set search_path to 'public';
alter function public.calculate_badges() set search_path to 'public';
alter function public.protect_admin_columns() set search_path to 'public';
alter function public.reset_expired_streaks() set search_path to 'public';
alter function public.take_question_snapshots() set search_path to 'public';
alter function public.update_streak() set search_path to 'public';
alter function public.get_candidate_questions(p_user_id uuid, p_country_code text, p_limit integer) set search_path to 'public';
