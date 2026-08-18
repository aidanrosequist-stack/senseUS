-- migration: 015_add_deletion_requested_at_to_writable_columns.sql
--
-- profiles.deletion_requested_at (the self-service "delete my account"
-- feature) was never classified by migration 013's column-protection
-- check as either client-writable or admin-locked -- it just fell
-- through the cracks, since it was added to profiles after 013 was
-- written. supabase/ci/security_checks.sql (check 3) caught this the
-- first time it ever ran against a complete copy of the profiles table
-- (see migration 0000_core_tables.sql) -- exactly what that check is
-- for.
--
-- Confirmed with Aidan 2026-08-18: this column is meant to be set by
-- the user themselves when they request account deletion, so it belongs
-- on the client-writable allowlist, not locked in protect_admin_columns().
--
-- Not editing migration 013 directly -- it's already applied to
-- production, so editing it in place wouldn't do anything on `db push`
-- (Supabase only re-runs migrations it hasn't seen before). A new
-- migration that adds the one missing row is the correct way to extend
-- an already-shipped allowlist.

insert into public.profiles_client_writable_columns (column_name) values
  ('deletion_requested_at')
on conflict (column_name) do nothing;
