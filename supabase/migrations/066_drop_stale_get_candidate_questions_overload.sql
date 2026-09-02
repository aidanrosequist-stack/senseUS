-- migration: 066_drop_stale_get_candidate_questions_overload.sql
--
-- CONTEXT (Aidan, 2026-09-02): found via a full pass through Supabase's
-- Security Advisor. Migration 045 added a p_region parameter to
-- get_candidate_questions using CREATE OR REPLACE -- but since that
-- changed the parameter signature, Postgres created a brand new
-- overload instead of replacing the original one. The old 3-argument
-- version (from migration 044, before region matching existed) was
-- never dropped and is still live.
--
-- Nothing in the app calls it anymore -- useQuestions.js always passes
-- p_region now, which PostgREST resolves to the 4-argument version --
-- but the old one is still callable directly. Not exploitable (both
-- versions still self-check p_user_id = auth.uid()), just stale: it
-- carries migration 044's sponsored-question guarantee but not 045's
-- region-matching logic, so calling it directly would silently produce
-- older, inconsistent candidate selection instead of erroring.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_candidate_questions(uuid, text, integer);

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
--   select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc
--   where proname = 'get_candidate_questions';
--
-- -> should return exactly one row, with all four arguments
--    (p_user_id uuid, p_country_code text, p_limit integer, p_region text).
