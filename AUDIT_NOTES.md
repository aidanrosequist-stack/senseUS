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
| vote_changes | on_vote_change_check | INSERT | check_vote_manipulation() |
| profiles | on_coordinated_signup_check | INSERT | check_coordinated_signup() |
| profiles | on_registration_spike_check | INSERT | check_registration_spike() |
| questions | on_flagged_question_check | UPDATE | check_flagged_question() |
| transparency_events | on_new_transparency_event | INSERT | check_new_transparency_event() |

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