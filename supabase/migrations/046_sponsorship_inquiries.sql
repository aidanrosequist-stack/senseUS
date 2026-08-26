-- senseUS: sponsorship_inquiries -- lightweight intake for the public
-- sponsorship pricing page's "get in touch" form.
--
-- CONTEXT: the pricing page (2026-08-26) is a marketing/pricing page
-- meant to be shown to potential sponsors now, ahead of the payment +
-- e-signature pipeline (Stripe deposit charge, DocuSign contract,
-- webhook-driven balance collection), which is being deliberately held
-- off for a later pass. This table is the low-commitment "I'm
-- interested, contact me" capture for that page -- explicitly NOT the
-- $150-deposit application/payment flow described for that later pass.
-- No card is collected here; nothing here charges anyone. When the full
-- pipeline is built, applications that convert from an inquiry will
-- live in sponsored_questions as they do today, not in this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsorship_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  tier text NOT NULL,
  region text,
  country_code character(2),
  category text,
  wants_custom_content boolean NOT NULL DEFAULT false,
  message text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_inquiries_tier_check CHECK (tier IN ('region', 'country', 'global')),
  CONSTRAINT sponsorship_inquiries_region_check CHECK (region IS NULL OR region IN ('Northeast', 'Midwest', 'South', 'West')),
  CONSTRAINT sponsorship_inquiries_status_check CHECK (status IN ('new', 'contacted', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_inquiries_status_created
  ON public.sponsorship_inquiries (status, created_at DESC);

ALTER TABLE public.sponsorship_inquiries ENABLE ROW LEVEL SECURITY;

-- Public form, no login wall -- anyone can submit an inquiry, but only
-- ever as a fresh 'new' row. They can't set status themselves, and
-- can't read or edit anything (their own submission included) after
-- the fact -- matches how a plain contact form should behave.
CREATE POLICY "Anyone can submit a sponsorship inquiry"
  ON public.sponsorship_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'new');

CREATE POLICY "Admins can view sponsorship inquiries"
  ON public.sponsorship_inquiries FOR SELECT
  TO authenticated
  USING (is_admin_user());

CREATE POLICY "Admins can update sponsorship inquiries"
  ON public.sponsorship_inquiries FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

REVOKE ALL ON public.sponsorship_inquiries FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.sponsorship_inquiries TO anon, authenticated;
GRANT SELECT, UPDATE ON public.sponsorship_inquiries TO authenticated;
