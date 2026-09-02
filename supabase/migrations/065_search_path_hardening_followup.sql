-- migration: 065_search_path_hardening_followup.sql
--
-- CONTEXT (Aidan, 2026-09-02): Supabase's Security Advisor flagged three
-- functions as "Function Search Path Mutable" -- missing SET search_path,
-- the same class of issue migration 026 (2026-08-21) went through the
-- whole codebase to fix. These three simply weren't in that pass:
-- handle_updated_at, block_archived_question_votes, moderate_comment.
--
-- Lower severity than the functions 026 targeted: none of these three
-- declare SECURITY DEFINER (they're plain trigger functions -- see
-- moderate_comment_trigger / set_updated_at / the vote-block trigger,
-- migration 053), so they run with the privileges of whoever fires the
-- insert/update, not an elevated owner. The specific privilege-
-- escalation path 026 was written for needs SECURITY DEFINER to matter,
-- so it doesn't apply here the same way. Still worth closing -- same
-- zero-risk approach as 026, ALTER FUNCTION rather than CREATE OR
-- REPLACE, touches only this one attribute.
-- ============================================================

alter function public.handle_updated_at() set search_path to 'public';
alter function public.block_archived_question_votes() set search_path to 'public';
alter function public.moderate_comment() set search_path to 'public';
