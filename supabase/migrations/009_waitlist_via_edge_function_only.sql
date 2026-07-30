-- senseUS: Route waitlist signups through Turnstile-verified edge function
--
-- Previously `waitlist` had a permissive "Anyone can join the waitlist"
-- INSERT policy allowing any anon-key holder to insert directly — no
-- verification, trivially scriptable/spammable. The join-waitlist Edge
-- Function now verifies a Cloudflare Turnstile token server-side before
-- inserting via the service role (which bypasses RLS entirely). This
-- migration removes the direct-insert policy so the only way to add a
-- row is through that verified path — a spammer calling
-- supabase.from('waitlist').insert(...) directly with the anon key will
-- now correctly get a permission-denied error instead of succeeding.
-- ============================================================

drop policy if exists "Anyone can join the waitlist" on public.waitlist;

-- Admins can review the waitlist from the Admin panel (previously not
-- possible via the app at all — only through the SQL editor directly).
drop policy if exists "Admins can view waitlist" on public.waitlist;
create policy "Admins can view waitlist"
on public.waitlist
for select
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin = true
  )
);
