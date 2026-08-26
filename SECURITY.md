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
