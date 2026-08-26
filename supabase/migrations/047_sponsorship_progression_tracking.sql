-- senseUS: track a sponsored question's progression through the real
-- pipeline (deposit -> review -> contract -> half balance -> live ->
-- results -> final balance), not just its current live/waitlisted state.
--
-- CONTEXT: sponsored_questions already exists and already tracks a few
-- milestones as individual timestamps (contract_signed_at, live_at,
-- archived_at) plus a coarse `status` (waitlisted/live/archived/rejected)
-- and `payment_status` (pending/deposit_received/paid_in_full). That's
-- real progress tracking, just not the full pipeline described when the
-- /sponsor page was built: submit + deposit -> admin review (approve, or
-- reject with one of two distinct reasons) -> contract sent -> contract
-- signed -> half of remaining balance collected -> question runs ->
-- results delivered -> final balance requested (collected manually for
-- now -- see migration history/conversation notes; nothing here can
-- force that last payment automatically).
--
-- FIX: add one timestamp per remaining milestone, following the exact
-- pattern this table already uses (contract_signed_at, live_at,
-- archived_at) rather than inventing a second, competing status enum
-- that could drift out of sync with these timestamps. "Where is this
-- sponsorship right now" is answered by which timestamps are set, the
-- same way it already is for contract-signed and live today.
--
-- The two rejection reasons get real columns too, not just a status
-- flip to 'rejected' -- rejection_reason distinguishes "doesn't fit,
-- refunded" from "rule violation, forfeited", and a CHECK constraint
-- requires rejection_rule_detail whenever the reason is a rule
-- violation, so an admin can't reject-and-forfeit without stating which
-- rule was broken.
--
-- sponsored_queue (the view Admin.jsx actually reads from) is recreated
-- with the new columns added -- its eligibility logic is untouched,
-- copied verbatim from the live definition captured in 000_functions.sql.
-- ============================================================

ALTER TABLE public.sponsored_questions
  ADD COLUMN IF NOT EXISTS deposit_amount_cents integer DEFAULT 15000,
  ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_forfeited_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejection_rule_detail text,
  ADD COLUMN IF NOT EXISTS contract_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS half_balance_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_balance_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_balance_paid_at timestamptz;

ALTER TABLE public.sponsored_questions
  DROP CONSTRAINT IF EXISTS sponsored_questions_rejection_reason_check;
ALTER TABLE public.sponsored_questions
  ADD CONSTRAINT sponsored_questions_rejection_reason_check
  CHECK (rejection_reason IS NULL OR rejection_reason IN ('doesnt_fit', 'rule_violation'));

ALTER TABLE public.sponsored_questions
  DROP CONSTRAINT IF EXISTS sponsored_questions_rejection_detail_required;
ALTER TABLE public.sponsored_questions
  ADD CONSTRAINT sponsored_questions_rejection_detail_required
  CHECK (rejection_reason IS DISTINCT FROM 'rule_violation' OR rejection_rule_detail IS NOT NULL);

-- IMPORTANT: CREATE OR REPLACE VIEW can only ever APPEND new output
-- columns at the end -- it errors if an existing column's name or
-- position shifts. The original 11 columns (through computed_eligibility)
-- are kept in their exact original order below; every new column this
-- migration adds is appended after computed_eligibility, not interleaved.
CREATE OR REPLACE VIEW public.sponsored_queue
WITH (security_invoker = true)
AS
 SELECT sq.id,
    sq.sponsor_name,
    sq.sponsor_category,
    sq.status,
    sq.created_at,
    sq.live_at,
    sq.archived_at,
    sq.duration_days,
    q.text AS question_text,
    q.domain,
        CASE
            WHEN q.domain = 'politics & policy'::text AND sq.status = 'waitlisted'::text THEN
            CASE
                WHEN (EXISTS ( SELECT 1
                   FROM sponsored_questions sq2
                     JOIN questions q2 ON q2.id = sq2.question_id
                  WHERE sq2.sponsor_name = sq.sponsor_name AND q2.domain = 'politics & policy'::text AND sq2.archived_at IS NOT NULL AND sq2.archived_at > (now() - '90 days'::interval))) THEN 'in_cooldown'::text
                WHEN (( SELECT count(*) AS count
                   FROM sponsored_questions sq3
                     JOIN questions q3 ON q3.id = sq3.question_id
                  WHERE q3.domain = 'politics & policy'::text AND sq3.status = 'live'::text)) >= 2 THEN 'slots_full'::text
                WHEN (EXISTS ( SELECT 1
                   FROM sponsored_questions sq4
                     JOIN questions q4 ON q4.id = sq4.question_id
                  WHERE sq4.sponsor_name = sq.sponsor_name AND q4.domain = 'politics & policy'::text AND sq4.status = 'live'::text)) THEN 'already_has_live_slot'::text
                ELSE 'eligible'::text
            END
            ELSE sq.status
        END AS computed_eligibility,
    -- Everything below is newly appended by this migration.
    sq.sponsor_contact,
    sq.payment_status,
    sq.amount_cents,
    sq.deposit_amount_cents,
    sq.deposit_paid_at,
    sq.deposit_refunded_at,
    sq.deposit_forfeited_at,
    sq.rejection_reason,
    sq.rejection_rule_detail,
    sq.contract_sent_at,
    sq.contract_signed_at,
    sq.half_balance_paid_at,
    sq.results_delivered_at,
    sq.final_balance_requested_at,
    sq.final_balance_paid_at
   FROM sponsored_questions sq
     JOIN questions q ON q.id = sq.question_id
  ORDER BY sq.created_at;

REVOKE ALL ON public.sponsored_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sponsored_queue TO authenticated;
