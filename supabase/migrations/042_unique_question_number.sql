-- senseUS: prevent duplicate question_number values at the database level
--
-- PROBLEM: questions.question_number had no uniqueness requirement --
-- only a plain index (idx_questions_question_number), which speeds up
-- lookups but does nothing to stop a duplicate. That gap let a real one
-- through silently: a sequence desync (questions_question_number_seq
-- was stuck at 318 while the table's real max was already 362 -- almost
-- certainly from a bulk import that set explicit numbers without
-- advancing the sequence to match) meant the next admin-added question
-- was handed 318 again, creating two rows with the same number. It sat
-- undiscovered until an admin happened to notice while sourcing articles
-- for the new one. Fixed for that specific case on 2026-08-24 (the
-- duplicate renumbered, the sequence resynced), but nothing stopped it
-- from happening again the same way -- migration 027 already narrowed
-- who can manipulate the sequence directly, but that doesn't cover a
-- legitimate manual insert (a future bulk import, a SQL-editor fix) that
-- supplies an explicit question_number instead of leaving it to the
-- column default.
--
-- FIX: a real UNIQUE constraint. Doesn't prevent someone from attempting
-- a colliding insert, but turns it from a silent duplicate into an
-- immediate, loud constraint-violation error at insert time -- the same
-- "surface it, don't hide it" pattern used throughout this project
-- (the admin review queue, Mark All As Read, Vote.jsx's hide-question
-- write, and others).
-- ============================================================

ALTER TABLE public.questions
  ADD CONSTRAINT questions_question_number_key UNIQUE (question_number);

-- The UNIQUE constraint above creates its own backing index over the
-- same column -- the original plain index now duplicates it (same
-- lookups, maintained twice on every insert/update for no benefit).
DROP INDEX IF EXISTS public.idx_questions_question_number;
