-- senseUS: length limits + edge-function-only writes for sponsorship_inquiries
--
-- sponsorship_inquiries (046) allowed anon/authenticated to INSERT
-- directly with no CAPTCHA, no rate limit, and no length bound on any
-- text field -- 20 rapid unauthenticated inserts all succeeded, and a
-- single insert with a 5MB message field was accepted without error.
-- Following the same pattern already used for the waitlist table (see
-- 009_waitlist_via_edge_function_only.sql): the new
-- submit-sponsorship-inquiry Edge Function verifies a Cloudflare
-- Turnstile token server-side before inserting via the service role,
-- and this migration removes the direct-insert policy so a spammer
-- calling supabase.from('sponsorship_inquiries').insert(...) directly
-- with the anon key now gets permission-denied instead of succeeding.
--
-- Length CHECK constraints are added independently of that -- even a
-- fully verified, non-bot submission shouldn't be able to store a
-- multi-megabyte field, and the edge function validates the same
-- limits itself first so a too-long submission gets a clean 400
-- instead of a raw Postgres constraint-violation message.
-- ============================================================

alter table public.sponsorship_inquiries
  add constraint sponsorship_inquiries_name_length_check check (length(name) <= 200),
  add constraint sponsorship_inquiries_email_length_check check (length(email) <= 320),
  add constraint sponsorship_inquiries_company_length_check check (company is null or length(company) <= 200),
  add constraint sponsorship_inquiries_message_length_check check (message is null or length(message) <= 5000);

drop policy if exists "Anyone can submit a sponsorship inquiry" on public.sponsorship_inquiries;
revoke insert on public.sponsorship_inquiries from anon, authenticated;
