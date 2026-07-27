# senseUS Audit Notes

This document records intentional design decisions in the voting and integrity systems
for transparency and auditability purposes. Last updated: July 2026.

---

## Voting Math

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