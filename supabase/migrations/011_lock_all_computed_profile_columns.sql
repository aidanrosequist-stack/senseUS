-- senseUS: Comprehensive profile column protection
--
-- protect_admin_columns previously only guarded is_admin and
-- integrity_weight. But "Users can update own profile" has no
-- per-column restriction — so any authenticated user could call
-- supabase.from('profiles').update({ answers_count: 99999, ... })
-- directly and it would succeed, completely bypassing
-- increment_answers_count and every other RPC-level fix from this
-- audit. This closes that for every computed/system column, not just
-- the two that happened to be protected already.
--
-- Confirmed against actual client call sites (Settings.jsx,
-- useRegistration.js) — these are the ONLY columns a client
-- legitimately writes: first_name, last_initial, anon_name,
-- birth_year, country_code, display_preference, avatar, bio,
-- recovery_email, region. Everything else is computed/system and is
-- now locked to whatever it already was unless the caller is
-- service_role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if auth.role() != 'service_role' then
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
  return new;
end;
$function$;
