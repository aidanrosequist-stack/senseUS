# senseUS Audit Notes

This document records intentional design decisions in the voting and integrity systems
for transparency and auditability purposes. Last updated: July 2026.

---

## Voting Math

### Percentage Formula — Canonical Decision (2026-07-27)
The canonical percentage formula for user-facing displays is
**weighted-over-weighted**: `(yes_weighted + ly_weighted) / (yes_weighted + ly_weighted + ln_weighted + no_weighted)`.

This is what ResultsCard and Vote.jsx display to users.

Internal screens (Activity Shifts, AdminReports) use raw counts for their
own calculations but do not display percentages to users, so no
user-facing inconsistency exists. This was confirmed during the 2026-07-27
audit.


### Vote Tallying (`get_vote_tally`, `get_vote_tallies_batch`)

Vote counts for yes/ly/ln/no are **integrity-weighted** — each vote is multiplied by
the voter's `integrity_weight_at_vote` (the weight at the time they cast their vote,
range 1.0000–1.0050). This means a more engaged user's vote counts very slightly more.

The `total` field is a **raw unweighted count** of distinct humans who answered.
This is intentional — "X verified humans answered" should reflect actual headcount,
not a weighted sum.

**Verification:** `yes_weighted + ly_weighted + ln_weighted + no_weighted` will not
equal `total` exactly due to weighting. This is expected and correct.

**Audit check:**
```sql
select
  count(*) as raw_total,
  sum(integrity_weight_at_vote) as weighted_total
from votes
where question_id = '<question_id>';
```

---

## Integrity Weight System

### Design Principles
- Range: 1.0000 (baseline) to 1.0050 (maximum)
- **Upward only** — weight can never decrease. Enforced by the `greatest()` ratchet
  in `calculate_all_integrity_weights()`
- All-time counts — uses total lifetime votes and comments, not a rolling window
- Runs nightly via pg_cron at 3am UTC

### Weight Thresholds
| Activity | Bonus |
|----------|-------|
| 10+ lifetime votes | +0.0005 |
| 25+ lifetime votes | +0.0010 |
| 50+ lifetime votes | +0.0020 |
| 5+ lifetime comments | +0.0005 |
| 10+ lifetime comments | +0.0005 |
| 7+ day streak | +0.0005 |
| **Maximum** | **1.0050** |

### The Ratchet
```sql
set integrity_weight = greatest(p.integrity_weight, nw.calculated_weight)
```
This guarantees monotonicity regardless of future formula changes. A user who earned
1.0045 will never drop below 1.0045, even if they stop voting entirely.

### `integrity_weight_at_vote`
Stored at vote time — captures the voter's weight when they cast their vote.
Changing your vote does not update this field; it reflects the weight at first vote.

### VOIP Detection & Weight Withholding (added 2026-07-27, migration 010)
Right after phone verification succeeds (before profile details are even
filled in), the `check-line-type` Edge Function looks up the verified
number via Twilio Lookup v2 (`line_type_intelligence`). If the number is
**non-fixed VOIP** (Google Voice, TextNow, and similar — the type phone
farms overwhelmingly use to generate burner numbers cheaply), it:

1. Logs an `integrity_events` row (`event_type = 'voip_detected'`,
   `action_taken = 'flagged'`) for admin visibility
2. Sets `profiles.voip_flagged_at`

`calculate_all_integrity_weights()` now withholds weight growth for a
flagged account until **both** 30 days have passed since flagging **and**
the account has cast 20+ votes — either alone is gameable (a farm account
could sit idle to wait out a pure time window, or vote rapidly to beat a
pure vote-count window). During the withholding window the account's
weight is held at exactly 1.0000; it is never blocked, reduced, or
prevented from voting/commenting normally.

**Deliberately NOT flagged:** fixed VOIP (a real home/business
line-replacement service like Ooma or Vonage) — it isn't what farms use,
and flagging it would only punish legitimate users. Registration itself
is never blocked on a VOIP result, and a Twilio Lookup failure fails open
(skips flagging) rather than blocking registration.

**Verification:**
```sql
-- See who's currently in the withholding window
select id, voip_flagged_at, integrity_weight
from profiles
where voip_flagged_at is not null
  and (
    now() < voip_flagged_at + interval '30 days'
    or (select count(*) from votes where votes.user_id = profiles.id) < 20
  );

-- Full VOIP detection log
select * from integrity_events where event_type = 'voip_detected' order by created_at desc;
```

---

## Comment Moderation

Two independent layers:

1. **JavaScript (`src/lib/moderation.js`)** — client-side pre-submit check
2. **Database trigger (`moderate_comment()`)** — server-side enforcement on INSERT/UPDATE

Both layers maintain a banned word list (hard block) and a review word list (flag for
human review). The word lists should be kept in sync between both layers.

The database trigger is the authoritative layer — even if the JavaScript check is
bypassed, the database will reject or flag the comment.

**Important:** The trigger only re-runs moderation when `body` changes. Admin actions
that update other fields (e.g. clearing a flag) will not re-trigger moderation.

---

## Vote Changes

Users can change their vote at any time. Every change is logged in `vote_changes`
with `previous_choice`, `new_choice`, and `changed_at`.

- `answers_count` on profiles is incremented **only on first vote**, not on changes
- The `votes` table uses upsert with `onConflict: 'user_id,question_id'`
- `integrity_weight_at_vote` is set at first vote and not updated on changes

---

## Trigger Inventory (as of 2026-07-27)

Two issues were identified and fixed during a voting-math audit:

### Fix 1 — vote_changes population (migration 004)
Prior to 2026-07-27, no trigger wrote to `vote_changes`. The table existed and
`check_vote_manipulation()` read from it, but nothing populated it — meaning
vote-change logging and vote-manipulation anomaly detection were both silently
inactive.

Fixed by adding `on_vote_change_log` trigger (BEFORE UPDATE on votes, fires only
when `old.choice IS DISTINCT FROM new.choice`). Now every vote change is logged
with `previous_choice`, `new_choice`, `changed_at`, and `change_count` is incremented.

### Fix 2 — update_streak fires on INSERT only (migration 004)
Prior to 2026-07-27, `update_streak_on_vote` fired on both INSERT and UPDATE of
the `votes` table (tgtype 21). Because `votes` uses upsert, changing an existing
vote re-fired `update_streak()`, which could increment `streak_days` — and
therefore the 7-day integrity_weight bonus — without the user answering any new
question. Real integrity gap.

Fixed by dropping and recreating `update_streak_on_vote` as INSERT-only.
A vote change is not new activity and must not move the streak.

**Verification:**
```sql
-- Confirm INSERT-only
select tgname,
  case when tgtype & 16 > 0 then 'fires on UPDATE (bad)' else 'INSERT only (good)' end as status
from pg_trigger where tgname = 'update_streak_on_vote';

-- Confirm vote_changes populates on vote change
select * from vote_changes order by changed_at desc limit 5;
```

### Full trigger inventory
| Table | Trigger | Event | Function |
|-------|---------|-------|----------|
| votes | update_streak_on_vote | INSERT | update_streak() |
| votes | on_vote_change_log | UPDATE (choice change only) | log_vote_change() |
| votes | secure_vote_fields_trigger | INSERT, UPDATE | secure_vote_fields() |
| vote_changes | on_vote_manipulation_check | INSERT | check_vote_manipulation() |
| profiles | on_coordinated_signup_check | INSERT | check_coordinated_signup() |
| profiles | on_registration_spike_check | INSERT | check_registration_spike() |
| profiles | protect_admin_columns_trigger | UPDATE | protect_admin_columns() |
| questions | on_flagged_question_check | UPDATE | check_flagged_question() |
| comments | moderate_comment_trigger | INSERT, UPDATE | moderate_comment() |
| comments | set_updated_at | UPDATE | handle_updated_at() |
| question_articles | set_updated_at | UPDATE | handle_updated_at() |
| transparency_events | on_new_transparency_event | INSERT | check_new_transparency_event() |

Corrected 2026-07-27: the `vote_changes` trigger is actually named
`on_vote_manipulation_check`, not `on_vote_change_check` as earlier
documentation here said — confirmed against a live trigger inventory
query. Also added rows for `secure_vote_fields_trigger`,
`protect_admin_columns_trigger`, `moderate_comment_trigger`, and both
`set_updated_at` triggers, none of which had a `CREATE TRIGGER`
statement anywhere in git — see "Schema/RLS Not Fully in Git" below.

---

## Daily Snapshots (`question_snapshots`)

A daily cron at 2am UTC snapshots the current vote tallies for every published
question. Used for 7-day trend indicators on the Profile page.

**Auditability checks:**
- `pct_yes + pct_no` should always equal 100
- `yes_votes + ly_votes + ln_votes + no_votes` should always equal `total_votes`

```sql
-- Verify snapshot integrity
select
  question_id,
  snapshot_date,
  pct_yes + pct_no as pct_sum,
  yes_votes + ly_votes + ln_votes + no_votes as vote_sum,
  total_votes
from question_snapshots
where pct_yes + pct_no != 100
   or yes_votes + ly_votes + ln_votes + no_votes != total_votes;
```

A result with zero rows means all snapshots are mathematically consistent.

**Note (2026-07-27):** Fixed rounding invariant — `pct_no` is now derived as
`100 - pct_yes` rather than a second `round()` call, guaranteeing
`pct_yes + pct_no = 100` always. No bad data was found in existing snapshots
before the fix was applied.

---

## Anomaly Detection Thresholds

| Alert | Threshold | Window |
|-------|-----------|--------|
| Registration spike | 100+ new registrations | 24 hours |
| Coordinated signup | 20+ from same country | 1 hour |
| Vote manipulation | 50+ vote changes on one question | 1 hour |

Alerts are logged to `anomaly_log` and trigger email notifications via the
`send-alert-email` Edge Function.

**Design decision (confirmed 2026-07-27):** These triggers are alert-only —
they log and notify but never block a signup or a vote change themselves.
This is intentional, not a gap to close: automated blocking of "coordinated"
signups or vote changes risks false-positive lockouts of real users (e.g. a
school or workplace signing up together, or someone genuinely reconsidering
several votes). Anomalies are meant to be reviewed by a human via the Admin
Reports tab, not auto-enforced.

---

## Security Fixes — 2026-07-27 Audit

A security review of the full repo (frontend, DB functions, Edge Functions)
surfaced two direct data-manipulation vulnerabilities, both fixed in
migration `007_secure_vote_fields.sql`:

**1. Vote integrity fields were entirely client-supplied.** `Vote.jsx`
previously computed `integrity_weight_at_vote`, `pct_yes_at_vote`, and
`pct_no_at_vote` in the browser and sent them directly in the upsert.
Nothing server-side validated or recomputed them, and `get_vote_tally()`
sums `integrity_weight_at_vote` straight from the stored row — so anyone
who intercepted or scripted the request could set their own vote's weight
to any value, defeating the integrity-weighting system entirely.

Fixed with a `BEFORE INSERT OR UPDATE` trigger (`secure_vote_fields_trigger`
/ `secure_vote_fields()`) that overwrites all three fields server-side on
every write, ignoring whatever the client sends. `integrity_weight_at_vote`
is pulled from `profiles.integrity_weight` at first vote only (preserved
as-is on vote changes, matching existing documented behavior above). The
pct fields are recomputed from the live weighted tally. A `CHECK` constraint
(`integrity_weight_at_vote between 1.0000 and 1.0050`) backstops the trigger
independently, along with a `valid_choice` constraint restricting `choice`
to `yes/ly/ln/no/dec`.

**2. `increment_answers_count(user_id)` had no ownership check.** Any
authenticated user could call the RPC directly with someone else's UUID and
inflate their `answers_count`, which feeds badges and profile stats. Fixed
by adding `if auth.uid() != user_id then raise exception` at the top of the
function.

**3. `send-export-email` Edge Function removed entirely.** It accepted
`{ email, name, downloadUrl }` from the raw request body with no ownership
check, and — because Supabase's default `verify_jwt = true` is satisfied by
the public anon key — was reachable by anyone on the internet. It could have
been used to send phishing emails from `hello@senseus.app` to arbitrary
addresses with an attacker-chosen link. It was also unwired scaffolding: the
actual export pipeline was never built (`Settings.jsx` inserts a `pending`
row into `exports` and nothing ever processes it). Removed rather than
hardened since nothing currently depends on it — see "Export Pipeline Not
Yet Built" below. If/when the pipeline is built, any new version of this
function must look up a real `exports` row owned by `auth.uid()` with
`status = 'completed'` and pull `download_url` from that row — never from
the request body.

**Still open from the same audit (not yet fixed):**
- No RLS policies, table schema, or several existing triggers are
  committed to git — the authorization layer is unversioned and can't
  be diffed or audited from the repo alone. `supabase db dump` needs
  Docker, which isn't available in every environment we work from;
  deferred to the pre-launch audit session where Docker will be up
  anyway for the function-checksum comparison. In the meantime, the
  manual SQL-Editor queries in "Manual RLS/Schema Audit" below are the
  substitute — not committed as a live snapshot, just used ad hoc each
  time.
- Whether Supabase Auth's own built-in OTP rate limiting (distinct
  from the Turnstile CAPTCHA added below) is actually turned on in the
  dashboard has not been explicitly confirmed. Worth checking
  Authentication → Rate Limits before soft launch.

---

## Security Fixes — 2026-07-27 Audit, Round 2 (migrations 008–011)

A manual RLS/grants audit (Docker unavailable for the full `db dump`
workflow — see queries below) surfaced a second, more severe round of
findings than round 1. Fixed across four migrations:

### Migration 008 — RLS enable + function grant lockdown

**RLS was completely disabled** (not just permissively configured — off
entirely, meaning every policy on the table was inert) on five tables:
`comments`, `comment_resonances`, `exports`, `transparency_events`,
`vote_changes`. Anyone with the public anon key could read, insert,
update, or delete any row in these tables directly. `vote_changes` was
the most serious instance — it's the audit trail
`check_vote_manipulation()` relies on, so an attacker could both
manipulate votes and erase or fabricate the evidence trail meant to
catch it. Fixed: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on all
five.

**Every function had `EXECUTE` granted to `anon`/`authenticated` via
`PUBLIC`**, including several meant to be cron/service-role-only:
`call_alert_function` (fires a real alert email with fully
attacker-controlled type/severity/message), `log_anomaly_only` (lets
anyone insert fabricated `anomaly_log` rows), `calculate_all_integrity_weights`,
`calculate_badges`, `reset_expired_streaks`, `run_integrity_checks`,
`check_pending_alert_emails`. Fixed: revoked from `PUBLIC`, re-granted
only to `postgres`/`service_role`. Trigger functions (`moderate_comment`,
`protect_admin_columns`, etc.) were left alone despite loose grants —
Postgres refuses to execute a trigger function outside an actual trigger
context, so the broad grant isn't exploitable via RPC.

**`increment_flag_count(comment_id)` had no ownership check** — any
authenticated user could call it on any comment with no corresponding
flag filed. Fixed: now requires a real `comment_flags` row from the
caller for that comment first.

### Migration 009 — Waitlist via verified Edge Function only

`Home.jsx`'s waitlist form previously inserted directly into `waitlist`
with the anon key — no verification, trivially scriptable/spammable.
Added Cloudflare Turnstile (Managed mode — no image puzzles, runs
invisibly in the background for the vast majority of visitors) verified
server-side by a new `join-waitlist` Edge Function before it inserts via
the service role. The direct-insert RLS policy was dropped so a spammer
calling the table directly with the anon key now correctly gets denied.

### Edge Function auth hardening (deployed alongside, not a migration)

`calculate-integrity`, `send-daily-report`, `send-weekly-report`, and
`send-alert-email` now all require the real service-role key in the
`Authorization` header — previously they either had no check at all
(`calculate-integrity`, `verify_jwt = false`) or relied on Supabase's
default `verify_jwt = true`, which is satisfied by the public anon key
and therefore checked nothing meaningful. `send-alert-email` also now
HTML-escapes `message`/`details` before building the alert email.
`og-preview` now HTML-escapes question text before interpolating it into
meta tags — low risk today since only admins add questions, but would
matter the moment any user-suggested-question feature ships.

Registration's phone-verification step also now requires a Turnstile
token, passed as `options.captchaToken` to `supabase.auth.signInWithOtp`.
This requires CAPTCHA protection to be enabled in the Supabase Auth
dashboard (Authentication → Settings → Bot and Abuse Protection →
Turnstile, using the same secret key) — sending a token from the client
does nothing unless Supabase is told to verify it.

### Migration 010 — VOIP detection & weight withholding

See "VOIP Detection & Weight Withholding" above.

### Migration 011 — Comprehensive profile column protection

`protect_admin_columns` previously only protected `is_admin` and
`integrity_weight`. But "Users can update own profile" has no
per-column restriction, so any authenticated user could call
`supabase.from('profiles').update({ answers_count: 99999 })` directly —
completely bypassing every RPC-level fix, including the
`increment_answers_count` ownership check from round 1. Confirmed
against actual client call sites (`Settings.jsx`, `useRegistration.js`)
that the only columns a client legitimately writes are: `first_name`,
`last_initial`, `anon_name`, `birth_year`, `country_code`,
`display_preference`, `avatar`, `bio`, `recovery_email`, `region`.
Every other column (`answers_count`, `resonance_score`,
`resonance_tier`, `streak_days`, `longest_streak`, `replies_count`,
`likes_received`, `tier`, `badges`, `voip_flagged_at`,
`country_changed_at`, plus the two from round 1) is now locked to
whatever it already was unless the caller is `service_role`. A direct
client update attempt on a protected column returns success but
silently doesn't change the value — deliberate: an error response would
leak more information to an attacker about what's protected than a
silent no-op does.

### Manual RLS/Schema Audit

Substitute for the Docker-dependent `supabase db dump` workflow — run
these in the SQL Editor to spot-check RLS/grants without Docker:

```sql
-- Which tables have RLS enabled at all
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- Full policy list
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- Trigger inventory (cross-check against the table above)
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- Check constraints
select conrelid::regclass, conname, pg_get_constraintdef(oid)
from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace
order by 1, 2;

-- Function grants
select routine_name, grantee, privilege_type
from information_schema.routine_privileges where routine_schema = 'public'
order by routine_name, grantee;
```

---

## Export Pipeline Not Yet Built

`Settings.jsx` → "Export my data" inserts a row into `exports` with
`user_id` and default `status = 'pending'`. Nothing currently watches that
table, generates the actual export file, flips `status` to `completed`, or
sends an email. `Privacy.jsx` promises delivery within 48 hours — that
promise is not yet backed by working code. Needs: a process (cron or
trigger-invoked function) that picks up pending exports, generates the
file, uploads it somewhere the user can retrieve it, sets `download_url`
and `status = 'completed'`, and only then notifies the user — with the
notification function looking up the export row itself rather than trusting
any input about what to send or where.

---

## No IP Addresses

senseUS does not log IP addresses anywhere in the application database. This is
a deliberate, non-negotiable privacy decision. Standard Supabase infrastructure
logs may retain IPs at the network level per Supabase's own privacy policy.

---

## Phone Number Handling

Phone numbers are stored by Supabase Auth for login purposes only. They are not
stored in the application database (`profiles` table). After SMS verification via
Twilio, the message log is deleted from Twilio's servers via their API.

See Privacy Policy at senseus.app/privacy for full details.

---

## Pre-Launch Data Integrity Checks

Run these before wiping test data and before soft launch to confirm
the voting pipeline is clean:

```sql
-- 1. answers_count matches actual votes
select p.id, p.answers_count, count(v.id) as actual, 
  p.answers_count - count(v.id) as discrepancy
from profiles p left join votes v on v.user_id = p.id
group by p.id, p.answers_count
having p.answers_count != count(v.id);

-- 2. No invalid choice values
select choice, count(*) from votes 
where choice not in ('yes','ly','ln','no','dec') group by choice;

-- 3. No duplicate votes
select user_id, question_id, count(*) from votes 
group by user_id, question_id having count(*) > 1;

-- 4. pct_yes + pct_no = 100
select id, pct_yes_at_vote, pct_no_at_vote
from votes where pct_yes_at_vote is not null
and pct_yes_at_vote + pct_no_at_vote != 100;

-- 5. No orphaned vote_changes
select vc.id from vote_changes vc
left join votes v on v.user_id = vc.user_id 
and v.question_id = vc.question_id
where v.id is null;
```

All five should return zero rows. Confirmed clean on 2026-07-27.

---

## Automated Weekly Integrity Checks

`run_integrity_checks()` runs every Sunday at 6am UTC via pg_cron.
Checks all five invariants documented above. Silent when clean —
failures are logged to `anomaly_log` as `integrity_check_failed`
with severity `critical`, visible in the Admin Reports tab.