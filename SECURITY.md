# Security Policy

senseUS takes the security of its platform and its users' data seriously.
This is a phone-verified, one-human-one-account platform handling real
personal data (phone numbers, birth years, opinions, votes) — if you find
a vulnerability, please report it responsibly rather than opening a public
issue.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@senseus.app** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce it (proof-of-concept code or a request sequence is
  ideal, if you have one)
- Any affected URLs, endpoints, or files

We'll acknowledge your report as soon as we're able, and will follow up
with next steps or a resolution timeline once we've had a chance to
investigate. If you'd like credit for the finding once it's fixed and
disclosed, let us know in your report — otherwise we'll assume you'd
rather stay anonymous.

## Scope

This applies to the senseUS web application, its Supabase backend
(database functions, RLS policies, Edge Functions), and its Android
build. Things we're especially interested in:

- Authentication or authorization bypasses (including anything that lets
  one account act as, or see data belonging to, another)
- Ways to circumvent the one-account-per-human verification model
- SQL injection, privilege escalation, or `SECURITY DEFINER` function
  misuse
- Exposure of data that should be private (phone numbers, unverified
  vote data, admin-only records) to a user who shouldn't see it
- Anything that lets a non-admin account perform an admin-only action

## Security hardening history

We take an unusual approach to this document: rather than squashing or
tidying up senseUS's migration history before launch, we've deliberately
kept the full record — every `supabase/migrations/*.sql` file, in order,
going back to the app's first commit. If you're trying to judge whether
this platform takes security seriously, we'd rather you be able to check
our work yourself than take our word for it.

What follows is a curated summary, not a substitute for the migrations
themselves. Anyone is welcome to read `supabase/migrations/` directly,
along with `AUDIT_NOTES.md` at the repo root, which documents the
reasoning behind the app's data-integrity and fraud-detection design in
more technical depth than makes sense here.

**How we test security-relevant changes.** Every migration that touches
Row Level Security policies, function grants, or trigger behavior is
tested against a real local PostgreSQL 16 instance — loaded with a
from-scratch replay of the schema and a minimal harness simulating
Supabase's own role and grant defaults — before it ships. Fixes are
proven, not assumed: a change is shown to actually fail before the fix
and pass after, under the same session context (`auth.uid()`, role, RLS)
a real client request would have. Periodically, the entire live
production schema is dumped and diffed structurally — tables, columns,
indexes, constraints, views, functions, triggers, and every RLS policy —
against a full replay of the committed migration history, specifically to
catch anything ever configured by hand outside of version control.

**Automated, ongoing monitoring.** Beyond one-time fixes, the database
runs its own continuous security checks:

- A weekly check confirms Row Level Security is enabled on every table,
  that no function is callable by an unauthorized role, that every
  `profiles` column is either client-writable or actively protected, that
  every admin account is on an explicit allowlist, that protective
  triggers cover the write paths they're supposed to, and that no view
  bypasses RLS via `security_invoker = false`. Any finding emails an
  alert immediately.
- A second weekly check diffs every table's RLS policies against the
  prior week's snapshot and flags anything that changed, so it can be
  confirmed as intentional.
- Function heartbeat monitoring tracks every scheduled job — both
  cron-driven database functions and Edge Functions — and alerts if one
  goes quiet longer than its expected cadence. This is what originally
  caught a months-long silent failure in the account-deletion pipeline
  (see below).
- Real-time triggers fire immediately, not just on the weekly sweep, if
  any account is granted admin outside the allowlist, or if admin-action
  volume spikes in a way that looks more like a compromised session than
  normal moderation.
- CI runs the RLS, grant, column-protection, and view-grant checks as
  plain SQL assertions against a scratch database on every pull request
  that touches a migration, so a regression can't land even before it
  reaches production.

**Notable milestones**, for anyone auditing this codebase — migration
numbers point to the actual files in `supabase/migrations/`:

- **Migration 029** closed the most serious bug found in this project's
  history: a gap in an admin-column-protection trigger meant a
  newly-registered user could set `is_admin: true` on their own profile
  at signup and have it stick. Found during a dedicated RLS policy logic
  review, proven against a real database before and after the fix.
- **Migrations 049–052** closed an unauthenticated data-exposure bug: two
  database views were readable — and, worse, writable — by anyone,
  including fully unauthenticated requests, because they ran with the
  view owner's privileges rather than the querying user's. These are now
  scoped through purpose-built functions that only ever return what the
  calling page actually needs, and a new automated check now catches
  this exact bug class going forward.
- **Migration 053** used a full live-vs-migration-history schema diff —
  the first of its kind on this project — to find and formally capture
  five triggers that had been running in production but were never
  written into any migration file, including the one that actually
  enforces that voting closes once a question is archived.
- **Migrations 032–036** built out the audit-logging and monitoring
  system described above: an admin-action log, function heartbeat
  monitoring, RLS/policy drift detection, protective-trigger coverage
  checking, and reliable alert-email delivery confirmation.
- **Migrations 026–031** hardened `SECURITY DEFINER` function
  `search_path` settings across the schema, enforced comparison-link
  expiry server-side, and closed two smaller RLS gaps that let a user
  quietly reverse an admin's comment moderation or cascade-delete other
  people's replies.
- **Migrations 054–058** narrowed cross-user profile visibility to only
  what a given page actually needs, added a per-account voting-speed
  cooldown with a durable log of anything it blocks, and closed
  duplicate-send/duplicate-charge gaps in the welcome SMS and
  phone-verification flows.

None of this means the app is done being audited — new features go
through the same review before they ship, and the monitoring above is
built to keep catching the pattern this history shows has come up more
than once: something configured correctly at first that later drifted,
or was set up by hand and never version-controlled. If you find something
we've missed, the reporting process above is how to tell us.

## Out of scope

- Automated scanner output with no demonstrated, concrete impact
- Social engineering, physical attacks, or attacks requiring physical
  access to a user's device
- Denial-of-service testing (please don't load-test production)
- Reports on out-of-date dependencies with no demonstrated exploit path

## Please don't

- Access, modify, or delete another user's data beyond what's needed to
  demonstrate the issue
- Publicly disclose a vulnerability before we've had a reasonable chance
  to address it
- Run automated scanning tools against production infrastructure without
  checking with us first

Thank you for helping keep senseUS and its users safe.
