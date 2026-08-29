# senseUS Audit Notes

This document records intentional design decisions in the voting and integrity systems
for transparency and auditability purposes. Last updated: 2026-08-29.

---

## Voting Math

### Percentage Formula — Canonical Decision (2026-07-27)
The canonical percentage formula for user-facing displays is
**weighted-over-weighted**: `(yes_weighted + ly_weighted) / (yes_weighted + ly_weighted + ln_weighted + no_weighted)`.

This is what ResultsCard and Vote.jsx display to users.

Activity Shifts also displays percentages to users (the "you voted, now
X% agree" comparison) — an earlier version of this note incorrectly
stated it didn't. A real bug existed here: pctYes was computed by
dividing the weighted yes/ly sum by the raw, unweighted vote count,
rather than by the weighted total (yes+ly+ln+no), producing incorrect
percentages once any voter's integrity_weight rose above 1.0. Fixed
2026-08-05 to derive the denominator from the weighted buckets
themselves, matching ResultsCard's approach.

AdminReports uses raw counts for its own internal calculations and does
not display percentages to users, so no user-facing inconsistency exists
there. This was confirmed during the 2026-07-27 audit and remains true.

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

### Full trigger inventory (as of migration 057, 2026-08-29)
| Table | Trigger | Event | Function |
|-------|---------|-------|----------|
| votes | update_streak_on_vote | INSERT | update_streak() |
| votes | on_vote_change_log | UPDATE (choice change only) | log_vote_change() |
| votes | secure_vote_fields_trigger | INSERT, UPDATE | secure_vote_fields() |
| votes | block_archived_votes | INSERT, UPDATE | block_archived_question_votes() |
| vote_changes | on_vote_manipulation_check | INSERT | check_vote_manipulation() |
| profiles | on_coordinated_signup_check | INSERT | check_coordinated_signup() |
| profiles | on_registration_spike_check | INSERT | check_registration_spike() |
| profiles | on_admin_grant_check | INSERT, UPDATE | check_unauthorized_admin_grant() |
| profiles | protect_admin_columns_insert_update | INSERT, UPDATE | protect_admin_columns() |
| questions | on_flagged_question_check | UPDATE | check_flagged_question() |
| comments | moderate_comment_trigger | INSERT, UPDATE | moderate_comment() |
| comments | protect_comment_computed_columns_trigger | INSERT, UPDATE | protect_comment_computed_columns() |
| comments | set_updated_at | UPDATE | handle_updated_at() |
| question_articles | set_updated_at | UPDATE | handle_updated_at() |
| transparency_events | on_new_transparency_event | INSERT | check_new_transparency_event() |
| admin_actions | on_admin_action_volume_check | INSERT | check_admin_action_volume() |
| exports | require_recovery_email_for_export_trigger | INSERT | require_recovery_email_for_export() |

Corrected 2026-07-27: the `vote_changes` trigger is actually named
`on_vote_manipulation_check`, not `on_vote_change_check` as earlier
documentation here said — confirmed against a live trigger inventory
query. Also added rows for `secure_vote_fields_trigger`,
`protect_admin_columns_trigger`, `moderate_comment_trigger`, and both
`set_updated_at` triggers, none of which had a `CREATE TRIGGER`
statement anywhere in git — see "Schema/RLS Not Fully in Git" below.

**Updated 2026-08-29** — this table was stale (last refreshed
2026-07-27, predating migrations 013/029/053/056 and several others
that changed the actual trigger set). Refreshed against a full
`pg_trigger` query against production. Notable changes since the last
version of this table:

- `profiles.protect_admin_columns_trigger` (UPDATE-only) is **gone** —
  it was a redundant duplicate of `protect_admin_columns_insert_update`
  (added by migration 029 to close an admin-escalation-via-INSERT bug;
  see migration 053/056 below), dropped for good in migration 056.
- `votes.block_archived_votes`, `comments.set_updated_at`,
  `question_articles.set_updated_at`, and `comments.moderate_comment_trigger`
  itself were all live in production but had no `CREATE TRIGGER`
  anywhere in git until migration 053 (2026-08-28) captured them —
  same "set up by hand, never committed" gap this document has flagged
  before, just never previously found for *triggers* specifically. See
  the migration 053 writeup below for how this was finally caught.
- `profiles.on_admin_grant_check`, `admin_actions.on_admin_action_volume_check`,
  and `exports.require_recovery_email_for_export_trigger` were added
  by migrations 013 and 012 respectively and are documented in their
  own sections further down, but were never reflected in this table
  until now.

**Verification** (confirm this table still matches production):
```sql
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

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
- ~~Whether Supabase Auth's own built-in OTP rate limiting is turned
  on~~ — confirmed 2026-07-27, see "Supabase Auth Rate Limits" below.

---

## Supabase Auth Rate Limits (confirmed 2026-07-27)

Checked via the Management API rather than eyeballing the dashboard:

```powershell
$headers = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" }
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/gckjlshfesyxualwxurj/config/auth" -Headers $headers -Method Get
```

| Setting | Value | Scope |
|---|---|---|
| `rate_limit_sms_sent` | 30 | per hour, per IP |
| `rate_limit_otp` | 30 | per hour, per IP |
| `rate_limit_verify` | 30 | per hour, per IP |
| `rate_limit_token_refresh` | 150 | per hour, per IP |
| `rate_limit_anonymous_users` | 30 | per hour, per IP — unused, senseUS has no anonymous auth |
| `rate_limit_email_sent` | 2 | per hour, per IP — unused, senseUS is phone-only |

These are Supabase's stock defaults — nobody had customized them, and
they were never disabled. `sms_sent`/`otp`/`verify` at 30/hour/IP are
the ones that matter: they're the actual backstop against SMS-bombing
and OTP brute-forcing, and they're active. Judged reasonable for
friends-and-family scale — tight enough to block abuse, loose enough
that normal testing shouldn't hit them. Revisit upward only if real
growth causes legitimate signups to get throttled (most likely
scenario: many people registering from behind one shared IP, e.g. a
campus or office network, since these limits are per-IP, not
per-phone-number or per-account).

There is a known, currently-open Supabase issue (`supabase/auth#2333`)
where the *separate* "rate limit for sign-ups and sign-ins" setting
doesn't fully enforce as configured. That setting is distinct from
`sms_sent`/`otp`/`verify` above and doesn't appear to affect them —
noted here in case it resurfaces or the bug's scope turns out to be
broader than currently understood.

Turnstile CAPTCHA on the registration OTP-send step (added in the
Round 2 fixes above) is the primary defense against scripted
phone-farm registration; these IP-based rate limits are a secondary
backstop.

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

## Export Pipeline (built, migration 012)

Corrected 2026-08-15: this section previously said the export pipeline
wasn't built yet. It is — this was just stale documentation; migration
012 shipped it. Recorded here for real now:

`Settings.jsx` → "Export my data" inserts a row into `exports`. Before
the insert succeeds, `require_recovery_email_for_export_trigger`
(migration 012) enforces server-side that the requesting profile has a
`recovery_email` on file — a client-side-only check would've been
bypassable the same way everything else in this audit was.

The `process-pending-exports` Edge Function runs on a cron every 15
minutes (migration 012), authenticated by requiring the real
service-role key in its `Authorization` header (same pattern as the
other hardened functions from the 2026-07-27 audit). For each pending
row it: marks it `processing`, builds a JSON export of that user's own
data (profile fields, votes, vote changes, comments, comment
resonances given — looked up by the row's own `user_id`, never from
request input), uploads it to the private `user-exports` storage
bucket (no public access, no client-facing RLS policy — only the
service role ever reads/writes it directly), generates a 7-day signed
URL, sets `status = 'completed'` with `download_url` and `expires_at`,
and emails the signed link to the user's `recovery_email` via Resend.
Any failure along the way sets `status = 'failed'` with an
`error_message` rather than leaving the row stuck at `pending` or
`processing` forever.

`Privacy.jsx`'s 48-hour delivery promise is backed by working code —
in practice, since the cron runs every 15 minutes, most requests
complete within minutes, not hours.

**Deploy note:** this function needs `RESEND_API_KEY` set
(`supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx`) —
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by
Supabase and don't need to be set manually.

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

---

## Automated Security Config Checks (migration 013, 2026-08-15)

Every security fix on this page so far (007–011) was found by a human
manually running the "Manual RLS/Schema Audit" queries above, after
the fact. Migration 013 turns those same checks into two automated,
always-on layers instead of a manual ritual:

**`run_security_checks()`** runs weekly (Sundays 6:30am UTC, 30
minutes after the integrity check) and, unlike
`run_integrity_checks()`, emails immediately via `call_alert_function`
when it finds something — these are exploitable the moment they
happen, not data-quality drift that can wait for a weekly glance.
Checks: every public table has RLS enabled; no function has
anon/authenticated `EXECUTE` outside the `intentionally_public_functions`
allowlist; every `profiles` column is either client-writable
(`profiles_client_writable_columns` allowlist) or actively locked in
`protect_admin_columns()`; every `is_admin = true` profile is in
`authorized_admins`.

**Real-time admin-escalation alert** (`on_admin_grant_check` trigger
on `profiles`) fires the instant any profile's `is_admin` becomes
`true` and that profile isn't in `authorized_admins` — doesn't wait
for the weekly sweep. Since `protect_admin_columns()` already blocks a
regular authenticated user from setting `is_admin` at all, what this
actually watches for is a direct service-role-key or SQL Editor
write — i.e. a leaked key, unauthorized dashboard access, or an
unexpected second admin. `authorized_admins` was seeded from whoever
had `is_admin = true` at migration time. Add any future admin there
*before* granting them `is_admin`, or you'll alert yourself.

**`anomaly_log` — versioning already-live protection, not fixing a live
gap.** First drafted as "RLS was never enabled on anomaly_log," based
on migration history alone (it fell outside migration 008's
five-table fix, and no later migration covered it either). Confirmed
against the live database on 2026-08-15 that this was wrong: RLS was
already enabled there with an admin-only SELECT/UPDATE policy already
in place, matching this migration's intent almost exactly. Nothing
was actually exposed — this was fixed by hand at some point and
simply never captured in a migration, the same "schema/RLS not fully
in git" gap already noted below. Migration 013 just gets it into git,
plus two small real tightenings found by diffing the two: the live
policies applied `to public` (every role, including anonymous
requests) rather than `to authenticated` — doesn't currently matter in
practice since an anonymous request has no `auth.uid()`, but it's
tighter and more standard — and the UPDATE policy is now named to
match what was already live so the migration replaces it cleanly
instead of leaving a duplicate.

**CI counterpart:** `supabase/ci/security_checks.sql` re-implements
the RLS/grants/column-protection checks (not the admin-allowlist one —
meaningless against a fresh unseeded database) as plain assertions
that fail a GitHub Actions job (`.github/workflows/db-security-checks.yml`)
against a scratch local Supabase instance whenever a migration is
pushed. Catches a bad migration before it reaches production instead
of up to a week later. Not auto-synced with `run_security_checks()` —
if one changes, update the other by hand.

**One-time setup after this migration is applied:** the function
allowlist was seeded with only the two RPCs confirmed elsewhere in
this document (`increment_answers_count`, `increment_flag_count`).
Run the function-grants query in "Manual RLS/Schema Audit" above,
decide which other anon/authenticated grants are intentional, and
either add them to `intentionally_public_functions` or revoke them.
Expect the first real run of `run_security_checks()` to email
something because of this — that's the check surfacing real existing
grants that were never audited, not new breakage.

---

## Function Grant Cleanup + Two Authorization Bugs (migration 014, 2026-08-15)

The first real run of `run_security_checks()` flagged 29 functions.
Investigated each individually (function body, frontend call sites,
RLS policy dependencies) rather than guessing from names. Three real
findings, one false alarm in the check itself:

**Migration 008's function lockdown never fully worked.** It only ran
`revoke ... from public`. Supabase grants EXECUTE on every new
function directly to `anon`/`authenticated` by default, separate from
the `PUBLIC` pseudo-role — revoking from `PUBLIC` never touched those.
Confirmed directly: `run_security_checks()`, revoked-from-`public` in
migration 013 minutes earlier, was flagged too. Not new drift —
`call_alert_function`, `calculate_all_integrity_weights`,
`calculate_badges`, `check_pending_alert_emails`,
`reset_expired_streaks`, `run_integrity_checks`, `log_anomaly_only`,
`archive_due_questions`, and `take_question_snapshots` have likely
been callable by any logged-in user (some — `call_alert_function`,
which can send an arbitrary alert email — by literally anyone with the
anon key) since migration 008 shipped, despite that migration
believing it had locked them down. Fixed by revoking from `public`,
`anon`, **and** `authenticated` explicitly, everywhere.

**`activate_sponsored_question` had no admin check at all.** Called
from `Admin.jsx` via `supabase.rpc()`, using the logged-in admin's own
session — but the function itself never verified the caller was an
admin. Any authenticated user could call it directly and activate any
pending sponsorship themselves. Fixed with the same `is_admin_user()`
check used elsewhere; verified an admin can still activate normally
and a non-admin gets `Unauthorized.` with the sponsorship correctly
left `pending`.

**`get_candidate_questions` trusted the caller's `p_user_id`.** Called
from `useQuestions.js` with no check that the ID matched the actual
caller. Any authenticated user could pass another user's ID and see
which specific questions that person has or hasn't answered/skipped
yet — not vote choices, but still behavioral data about a named
individual. Fixed by folding `p_user_id = auth.uid()` into the query
itself — a mismatched call now returns zero rows rather than raising
an error, matching the silent-denial approach `protect_admin_columns()`
already uses (migration 011) so a spoofed call can't even tell whether
the ID it guessed was real.

**The check itself had a bug: it never accounted for trigger
functions.** `check_unauthorized_admin_grant()` (migration 013's own
trigger function) got flagged on the very first run for the same
harmless reason migration 008 already established for
`moderate_comment`/`protect_admin_columns` — Postgres refuses to
invoke a trigger function outside a real trigger context, so a grant
on one is never actually exploitable. Rather than allowlist every
trigger function one at a time forever, `run_security_checks()` (and
`supabase/ci/security_checks.sql`, kept in sync by hand) now excludes
anything with `data_type = 'trigger'` structurally — the actual reason
it's safe, not a maintained list.

**Confirmed legitimate and added to the allowlist:** `get_vote_tally`,
`get_vote_tallies_batch` (read-only tallies, no sensitive data),
`activate_sponsored_question` and `get_candidate_questions` (now
ownership-checked, see above), and `is_admin_user` — not a client RPC,
but it must stay callable by `authenticated`: it's used inside the
`"Admins can view all profiles"` RLS policy on `profiles`, so revoking
it would break profile lookups for every logged-in user, not just
non-admins. This was confirmed by checking `pg_policies` before
touching it, not assumed.

---

## Note: migrations 015–048 not individually documented here

This document jumps from migration 014 (2026-08-15) to the
2026-08-18 CI fix and migration 049 (2026-08-28) below. Migrations
015–048 shipped real work in that gap — the 2026-08-21 deep security
review (026–031), badge/sponsorship features, and others — but most of
it isn't about the voting/integrity authorization model this document
specifically tracks, and some of it (the deep security review) is
already written up in full elsewhere in this repo/project. Not
backfilled here; flagged so a reader doesn't assume nothing happened
in between.

---

## CI Schema-Capture Blocker Resolved (2026-08-18)

`db-security-checks.yml` (see "Automated Security Config Checks" above)
couldn't run from an empty database until this date — `supabase start`
replays every migration file from scratch, and 20 core tables
(`votes`, `profiles`, `questions`, and others) had only ever been
created by hand in the Supabase dashboard, with no `CREATE TABLE`
anywhere in git.

**Fix**: captured those 20 tables' structure (columns, constraints,
indexes, the `questions_question_number_seq` sequence) via a one-off
schema dump and merged them into the top of `000_functions.sql` —
same migration version (`000`) production already has recorded as
applied, so `db push` continues to skip it there (no re-execution, no
drift risk) while `supabase start`/CI now build tables-then-functions
from empty. A first attempt shipped this as a separate `0000_core_tables.sql`
file instead and hit a real Supabase CLI bug
([supabase/cli#6036](https://github.com/supabase/cli/issues/6036)) —
local migration ordering and remote-tracked ordering disagree on
`"000"` vs `"0000"` — reverted before it could do any actual schema
damage (only the CLI's own tracking table was affected).

**Result**: `db-security-checks.yml` passed end-to-end for the first
time. Two smaller things fixed along the way: `015_add_deletion_requested_at_to_writable_columns.sql`
had been applied to production via `db push` but never committed to
git (caught by CI itself failing on exactly this gap); and
`supabase/.temp/*` (the CLI's own local cache from `link`/`start`) was
added to `.gitignore` and untracked.

**Still open from this pass**: `supabase/functions/send-daily-report/index.ts`
showed as locally modified partway through this work, after it had
earlier been confirmed finished and pushed. Never investigated — not
touched by any commit since. Worth checking what actually changed
before it gets committed either way.

---

## `public_votes` / `public_profiles` Exposure, and the Full View/Function/Trigger Lockdown (migrations 049–053, 2026-08-28)

The most severe authorization bug found in this project's history,
surfaced by a secondhand report that "any signed-in user can see any
other signed-in user's votes and profile." The actual live grants were
worse than reported: `anon` — no login, no account, just the public
API key — had full `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on
both `public_votes` and `public_profiles`. Any unauthenticated request
could read every user's name/avatar/bio and every vote ever cast, and
write to either view directly.

**Root cause**: both views had `security_invoker = false` (the
Postgres default), meaning each runs as its *owner* — bypassing RLS on
the underlying `votes`/`profiles` tables entirely for whatever role
the view is granted to. Both had also been created by hand at some
point and never captured in any migration — the same "set up in
Supabase Studio, invisible to every file-based review" pattern this
document has now hit for views, and (see migration 053 below)
triggers.

**Fix — migration 049**: recreated both views explicitly (first time
either existed in git), revoked all `anon` access, left `authenticated`
with `SELECT` only (that "any signed-in user can see this curated
slice" tradeoff itself was a separate, already-accepted design
decision — not what this fix touched; see migration 054 below for
where that was later revisited).

**Fix — migration 050**: a systematic re-audit (all views +
`security_invoker`; all `anon` grants on tables/views; all `anon`
grants on functions) turned up one more hand-created, uncommitted
view — `public_sponsors` (lower severity: 2 non-sensitive columns,
already `SELECT`-only for `anon`, and its only two call sites both sit
behind login anyway) — and confirmed `anon` had `EXECUTE` on ~35
functions via Supabase's default per-function grant, including
sensitive-sounding ones (`cast_vote`, `admin_search_questions`,
`broadcast_admin_notification`). Every one of those ~35 was read
before concluding anything: all had their own internal guard
(`is_admin_user()`, an `auth.uid() is null` check, or a query that
silently returns nothing for a null caller), so actual live risk was
low — a clean denial, not a data leak, unlike the views case. Fixed by
locking `public_sponsors` (same pattern as 049), explicitly revoking
the default `anon` grant on 15 authenticated/admin-only functions, and
adding **check #6** to `run_security_checks()`: any view granted to
`anon`/`authenticated` with `security_invoker = false` and not on a
new `intentionally_public_views` allowlist now fires the same alert
check #2 fires for functions — the mechanism that would have caught
the original bug automatically instead of needing a secondhand report.

**Fix — migration 051**: a related but distinct privacy question —
"comments color-coded by the commenter's vote, without exposing anyone's
full vote history" — turned out to have the same root cause as 049:
`Conversation.jsx` only ever asked for the current page's commenters on
the current question, but the underlying `public_votes` grant let
anyone bypass the app and pull every vote by every user directly.
Added `get_commenter_vote_choices(p_question_id, p_user_ids)`, a
`SECURITY DEFINER` RPC that can only ever return "these people's choice
on this question" — never a broader read — and revoked `authenticated`'s
direct `SELECT` on `public_votes` entirely (0 grants remain on that
view for any client role). Honest caveat: this closes the
"one query, dump everything" exposure, not a determined actor scripting
repeated single-question calls to reconstruct one target's history over
time — the same already-accepted risk `get_comparison`'s "theirs" side
carries.

**Fix — migration 052**: while testing 051,
`has_function_privilege('anon', 'cast_vote(uuid,text)', 'EXECUTE')`
returned `true` despite migration 050 supposedly revoking it. Root
cause: Postgres grants `EXECUTE` to the `PUBLIC` pseudo-role on every
`CREATE FUNCTION` unconditionally, entirely separate from the
`anon`/`authenticated`-specific default-privileges rule Supabase's
bootstrap sets up — and `anon` (like every role) automatically has
whatever `PUBLIC` has, regardless of `anon`'s own grant being revoked.
Migration 050's revoke was real on paper but had zero actual effect,
because its own test suite checked `information_schema.routine_privileges`
filtered to `grantee = 'anon'` — a distinct row from the `PUBLIC` row —
rather than actual effective access. **Lesson, worth repeating**:
`has_function_privilege(role, function, 'EXECUTE')` reflects real
access; a filtered `information_schema` row check does not, since
Postgres has more than one path to the same effective privilege.
Fixed with an explicit `revoke ... from public` on the same 16
functions (plus 051's new one), and check #2 in `run_security_checks()`
updated to also watch the `PUBLIC` grantee, with a structural exclusion
for extension-owned functions (pgcrypto) so it doesn't false-alarm on
those.

**Fix — migration 053**: with `db dump --linked --schema public`
finally working (see the CI section above for the earlier `db pull`
blocker), this was the first time the *entire* live schema could be
diffed structurally against a from-scratch replay of every migration
file — not just the targeted view/grant queries that caught 049–052.
Result: zero drift on tables, columns, indexes, constraints, function
signatures/security/search_path, and all RLS policies. The only gap
was 5 live triggers with no `CREATE TRIGGER` anywhere in git — four
real, load-bearing protections (`moderate_comment_trigger`, both
`set_updated_at` triggers, and `block_archived_votes`, which is the
actual database-level enforcement of "voting closes once a question is
archived") and one harmless redundant duplicate
(`protect_admin_columns_trigger`, a strict subset of
`protect_admin_columns_insert_update` from migration 029 — see
migration 056 below for where this was finally dropped). Captured
as-is rather than silently dropped, matching this project's "don't
remove a live behavior without an explicit decision" pattern.

**Verification, all of the above** (re-run any time to spot the same
bug class again):
```sql
-- Views granted to anon/authenticated with security_invoker off and
-- not allowlisted -- should return zero rows
select c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and coalesce((select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') = 'false'
  and c.relname not in (select view_name from public.intentionally_public_views)
  and exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public' and tp.table_name = c.relname
      and tp.grantee in ('anon', 'authenticated')
  );

-- Effective EXECUTE access (not row-existence!) for a specific function
select has_function_privilege('anon', 'public.cast_vote(uuid,text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.cast_vote(uuid,text)', 'EXECUTE');

-- Full trigger inventory, to compare against the table above
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers where trigger_schema = 'public'
order by event_object_table, trigger_name;
```

---

## `public_profiles` Narrowed, Vote-Speed Cooldown, Redundant Trigger Dropped, Welcome-SMS Guard (migrations 054–057, 2026-08-29)

Four follow-on decisions, closing out items the 049–053 work above had
left open.

**Migration 054 — `public_profiles` narrowed.** Same shape as
`public_votes` (051): any signed-in user could bulk-read every other
user's name/avatar/bio/badges via a direct, unscoped
`public_profiles` query — `Conversation.jsx` and `Compare.jsx` (the
only two call sites in the app) always scoped to specific user ids,
but the GRANT never did. Added `get_public_profiles(p_user_ids uuid[])`,
same `SECURITY DEFINER`-scoped-RPC pattern as 051, and revoked
`authenticated`'s `SELECT` on `public_profiles` entirely.

**Migration 055 — a 1-second minimum gap between votes, same account,
any question.** Registration is gated by real phone OTP verification
and VOIP-registered numbers already get down-weighted (see "VOIP
Detection" above), so bulk fake-account creation isn't the easy
attack. The real soft spot: nothing stopped a script holding one
genuinely-verified session from calling `cast_vote()` across every open
question at machine speed — something no human tapping through the
real UI could do. `check_vote_manipulation()` (see "Anomaly Detection
Thresholds" above) doesn't cover this either — it watches for 50+
*changes on one question* within an hour, a different signature from
one account voting fast across *many different* questions.

Added `profiles.last_vote_at` (protected the same way `answers_count`
is — a client can't reset it directly and defeat the cooldown) and a
check in `cast_vote()`: a vote less than 1 second after the same
user's last one is rejected. Every rejection is logged to
`anomaly_log` (`alert_type = 'vote_cooldown_blocked'`, silent — no
email, same low-signal path the cron integrity checks use) so a report
like this can distinguish a rare misclick from a script tripping it
repeatedly:
```sql
select user_id, count(*)
from anomaly_log
where alert_type = 'vote_cooldown_blocked'
  and triggered_at > now() - interval '7 days'
group by user_id
order by 2 desc;
```

**Design note worth keeping**: a cooldown-blocked vote does **not**
raise a Postgres exception. An unhandled `raise exception` rolls back
the *entire* enclosing transaction, including any table write earlier
in that same function call — so logging the block and then raising
would have silently discarded the very `anomaly_log` row the report
above depends on, every single time the cooldown actually fired.
Instead, `cast_vote()`'s `RETURNS TABLE` carries a `rejected_reason`
column (`null` normally, `'cooldown'` when blocked); the transaction —
log insert included — commits either way. The two guards that already
existed (unauthenticated caller, invalid choice value) are unaffected
and still raise normally, since neither needs a durable trail.

**Migration 056 — dropped the redundant `protect_admin_columns_trigger`**
captured as-is by migration 053 (see above) — a pure, harmless
duplicate of `protect_admin_columns_insert_update` (migration 029).
`profiles` keeps the identical protection either way; this just stops
running the same trigger function twice per `UPDATE`.

**Migration 057 — welcome SMS "already sent" guard.**
`send-welcome-sms/index.ts` sends the welcome text via Twilio with no
check at all for whether the account already received one, and
`useRegistration.js` calls it fire-and-forget with only a silent
`.catch()` — a retried or duplicated client call would trigger a
second billed send. Added `profiles.welcome_sms_sent_at` (protected
the same way) and `claim_welcome_sms_send()`, a `SECURITY DEFINER` RPC
using an atomic `update ... where welcome_sms_sent_at is null
returning true` — genuinely race-safe (two concurrent calls for the
same user serialize on the row; the second sees a committed non-null
value and matches nothing), not a check-then-act that merely usually
works. The edge function now calls this before contacting Twilio and
fails closed on either an RPC error or a `false` result.

**Verification, all four**:
```sql
-- get_public_profiles is properly scoped, and public_profiles has no
-- remaining client grant
select grantee, privilege_type from information_schema.table_privileges
where table_schema = 'public' and table_name = 'public_profiles';
-- -> zero rows for anon/authenticated

-- cast_vote cooldown: two calls under 1s apart as the same user, then
-- confirm the block was logged and the vote wasn't changed
-- (see the migration 055 file header for the full sequence)

-- exactly one trigger left running protect_admin_columns()
select tgname from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal
  and tgfoid = 'public.protect_admin_columns()'::regprocedure;
-- -> protect_admin_columns_insert_update only

-- welcome-SMS claim is one-shot
select public.claim_welcome_sms_send(); -- true the first time, false after
```

**Full audit close-out (2026-08-29)**: all four migrations were tested
against a full local Postgres 16 replay before being applied, then
production was re-dumped and diffed against the replay one more time
after `supabase db push` — zero drift on tables, columns, indexes,
constraints, views, function signatures/security/search_path/grants
(via `has_function_privilege`, not row-existence), triggers, and all
53 RLS policies. The only difference found was the same
already-accepted one this document has noted before: the local test
harness only simulates 4 of Supabase's real 7 default per-table
grants to `anon`/`authenticated` (`TRUNCATE`/`REFERENCES`/`TRIGGER`
are also part of Supabase's real bootstrap grant) — not a real gap,
since RLS is the actual enforcement layer and PostgREST doesn't expose
`TRUNCATE` as an operation anyway.