-- senseUS: CRITICAL — close a self-admin-grant hole in the profiles
-- INSERT path
--
-- PROBLEM (found 2026-08-21, from a direct read of the live RLS policy
-- set Aidan pulled via pg_policies):
--
-- "Users can insert own profile" (INSERT, with_check: auth.uid() = id)
-- has no restriction on any OTHER column. protect_admin_columns() (011)
-- is what's supposed to stop a client from setting is_admin,
-- integrity_weight, and other computed/system columns directly — but
-- it's a BEFORE UPDATE trigger only (confirmed by migration 013's own
-- comment: "protect_admin_columns() ... is a BEFORE UPDATE trigger",
-- and independently provable: its body unconditionally reads OLD.*,
-- which doesn't exist during INSERT and would error every single
-- registration if it fired there — since registration works, it can't
-- be wired to INSERT).
--
-- check_unauthorized_admin_grant() (013) DOES fire on INSERT, but it's
-- an AFTER trigger that only sends an alert email — it cannot roll back
-- or block the row, which is already committed by the time it runs.
--
-- Net effect: any authenticated user could, via a single direct INSERT
-- to /rest/v1/profiles with their own id and is_admin: true (or
-- integrity_weight, tier, badges, resonance_score, etc. set to
-- whatever), actually become an admin the moment their account is
-- created — with the only consequence being a real-time alert email
-- Aidan would need to notice and manually revert. This bypasses the
-- entire security-hardening effort from the earlier session, which
-- assumed protect_admin_columns() covered "any authenticated user...
-- directly" without distinguishing INSERT from UPDATE.
--
-- This also means run_security_checks() (013) would NOT have caught
-- this: its column-protection check only confirms a column is either
-- client-writable or "actively zeroed-out in protect_admin_columns()"
-- by regex-matching the function body for `new.<column> :=` — it has
-- no concept of which trigger EVENT that assignment actually applies
-- to, so a function that only protects on UPDATE still reads as fully
-- protected to that check. Not fixing the check itself in this
-- migration (out of scope for a one-bug fix) but worth knowing this
-- class of gap can recur elsewhere and won't self-report.
--
-- FIX: protect_admin_columns() now branches on TG_OP. For INSERT there
-- is no OLD row to fall back to, so every protected column is instead
-- forced to the same safe default the table itself already declares in
-- 0000_core_tables.sql — the client can still insert its own
-- id/first_name/last_initial/birth_year/etc., just nothing that
-- confers privilege or fakes standing. Wired as its own
-- BEFORE INSERT OR UPDATE trigger with a distinct name, so it's safe to
-- run alongside whatever the live, never-migrated original trigger is
-- named — worst case they both fire on UPDATE (harmless, same
-- deterministic result twice), and only the new one fires on INSERT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- IMPORTANT: this must stay `!=`, matching migration 011's original
  -- structure, not a `= 'service_role'` early-return. auth.role() reads
  -- NULL (not the literal 'service_role') for any call with no PostgREST
  -- request context at all — pg_cron jobs, a direct psql/superuser
  -- session, a migration run. `NULL != 'service_role'` evaluates to NULL,
  -- which `if NULL then` treats as false, so those contexts correctly
  -- fall through this whole block untouched. A `= 'service_role'`
  -- early-return gets this backwards: NULL doesn't equal the literal
  -- either, so it would ALSO skip the early return and then walk
  -- straight into the protective block below, silently breaking every
  -- cron-driven write to profiles (calculate_all_integrity_weights,
  -- calculate_badges, archive_due_questions, reset_expired_streaks,
  -- take_question_snapshots) the moment this function is next invoked
  -- from one of them. Caught this while drafting migration 031 — worth
  -- documenting here since it's exactly the class of subtle mistake this
  -- whole function exists to avoid making twice.
  if auth.role() != 'service_role' then
    if tg_op = 'INSERT' then
      -- No OLD row exists yet. Force every computed/system column to its
      -- safe, intended value regardless of what the client's INSERT body
      -- contained — matches the DEFAULT each column already declares in
      -- 0000_core_tables.sql.
      new.is_admin := false;
      new.integrity_weight := 1.0000;
      new.answers_count := 0;
      new.resonance_score := 50;
      new.resonance_tier := 'Independent';
      new.streak_days := 0;
      new.longest_streak := 0;
      new.replies_count := 0;
      new.likes_received := 0;
      new.tier := 'newcomer';
      new.badges := '{}';
      new.voip_flagged_at := null;
      new.country_changed_at := null;
      new.created_at := now();
    else
      -- UPDATE — unchanged from migration 011: pin every computed/system
      -- column back to its prior value.
      new.is_admin := old.is_admin;
      new.integrity_weight := old.integrity_weight;
      new.answers_count := old.answers_count;
      new.resonance_score := old.resonance_score;
      new.resonance_tier := old.resonance_tier;
      new.streak_days := old.streak_days;
      new.longest_streak := old.longest_streak;
      new.replies_count := old.replies_count;
      new.likes_received := old.likes_received;
      new.tier := old.tier;
      new.badges := old.badges;
      new.voip_flagged_at := old.voip_flagged_at;
      new.country_changed_at := old.country_changed_at;
      new.created_at := old.created_at;
      new.id := old.id;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_admin_columns_insert_update on public.profiles;
create trigger protect_admin_columns_insert_update
  before insert or update on public.profiles
  for each row
  execute function public.protect_admin_columns();
