-- senseUS: let admins delete anomaly_log rows, so the Reports tab's
-- Anomaly Log panel can actually be cleaned up.
--
-- CONTEXT (Aidan, 2026-09-18): the Anomaly Log has gotten too long to
-- work with in the admin Reports tab -- asked for a delete option.
--
-- Migration 013 deliberately left this table with no INSERT/DELETE
-- policy at all ("Editing any of them should be a deliberate act" --
-- see that migration's comment): inserts only ever happen via
-- call_alert_function()/log_anomaly_only(), both SECURITY DEFINER and
-- therefore unaffected by RLS either way, and there was no admin UI
-- need for delete at the time. There is now.
--
-- FIX: one DELETE policy, same admin-check predicate already used by
-- this table's existing SELECT/UPDATE policies (migration 013) --
-- copied verbatim rather than switched to is_admin_user() so all three
-- policies stay textually identical on this table, matching that
-- migration's own stated reasoning for keeping things consistent.
-- ============================================================

drop policy if exists "Admins can delete anomaly log" on public.anomaly_log;
create policy "Admins can delete anomaly log"
on public.anomaly_log for delete
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. Confirm the policy exists:
--    select policyname, cmd, roles from pg_policies
--    where tablename = 'anomaly_log' order by cmd;
--    -> should now show 3 rows: select, update, delete, all
--       admin-gated.
--
-- 2. As a non-admin, confirm delete is denied:
--    delete from anomaly_log where id = '<any real id>';
--    -> 0 rows affected (RLS silently filters, no error).
--
-- 3. As an admin, confirm delete works:
--    delete from anomaly_log where id = '<any real id>';
--    -> 1 row affected, gone from a subsequent select.
-- ============================================================
