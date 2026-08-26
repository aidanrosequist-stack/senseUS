-- senseUS: make sponsored questions geo-exclusive by purchased tier,
-- fix "regional" scope to actually match region, and expose public
-- reach counts for the sponsorship pricing page.
--
-- CONTEXT: the sponsorship pricing page (2026-08-26) sells three tiers
-- of reach -- Region ($1,500 floor), Country ($5,000 floor), Global
-- ($10,000 floor) -- priced by how many real users that tier reaches.
-- That only makes sense if the tiers are actually enforced.
--
-- PROBLEM 1: migration 044 made every sponsored question geo-blind --
-- guaranteed in every user's candidate pool regardless of geo_scope,
-- country_code, or region_code. That was the right call for the
-- "one admin-entered sponsor slot, maximize its reach" world we were
-- in at the time. It directly breaks tiered pricing: a Region sponsor
-- and a Global sponsor would get identical delivery, so charging
-- $10,000 for Global vs $1,500 for Region would be selling an
-- exclusivity the backend doesn't enforce.
--
-- PROBLEM 2 (pre-existing, unrelated to 044, found while fixing the
-- above): "regional" geo_scope has never actually been matched against
-- a user's region anywhere in this function. The tier-priority CASE
-- lumps 'country' and 'regional' together and only ever compares
-- country_code -- region_code is declared on questions but never once
-- referenced. A Northeast-scoped question has therefore always been
-- eligible for every US user, not just Northeast ones. Harmless so far
-- because nothing has used geo_scope='regional' in practice, but it
-- would have quietly undermined the Region tier being sold here, so
-- it's fixed now rather than discovered after a sponsor pays for it.
--
-- FIX:
--  1. get_candidate_questions gains a p_region parameter (the caller's
--     profiles.region), and 'regional' now genuinely means "matches
--     the caller's region" via region_code, on equal footing with how
--     'country' already means "matches the caller's country".
--  2. Sponsored questions switch from a soft priority tier (eligible
--     everywhere, just deprioritized when non-matching, same as every
--     other question) to a hard eligibility filter: a sponsored
--     question is only a candidate at all for users within the
--     geo_scope it was actually scoped to. Guaranteed-inclusion (never
--     lost to the random LIMIT draw, added in 044) still applies, but
--     now only within that matching population -- so Global genuinely
--     reaches everyone, Region genuinely reaches only that region, and
--     the tiers mean what the pricing page says they mean. Regular
--     (non-sponsored) questions are NOT changed to hard-filtering --
--     they keep the existing soft-priority-plus-fallback behavior,
--     since that's a UX choice about content variety, not a paid
--     exclusivity guarantee.
--  3. questions.region_code gets the same 4-value CHECK constraint
--     profiles.region already has, so it can't drift into inconsistent
--     values.
--  4. New get_sponsorship_reach_counts() RPC: aggregate-only counts
--     (global total, per-country, per-region) for the public pricing
--     page's live numbers. No individual rows, no PII -- safe to grant
--     to anon since the page has no login wall.
-- ============================================================

ALTER TABLE public.questions
  ADD CONSTRAINT questions_region_code_check
  CHECK (region_code IS NULL OR region_code IN ('Northeast', 'Midwest', 'South', 'West'));

CREATE OR REPLACE FUNCTION public.get_candidate_questions(p_user_id uuid, p_country_code text, p_limit integer DEFAULT 75, p_region text DEFAULT NULL)
 RETURNS SETOF questions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with eligible as (
    select q.*
    from questions q
    where p_user_id = auth.uid()
      and q.published_at is not null
      and q.published_at <= now()
      and q.archived_at is null
      and not exists (select 1 from votes v where v.user_id = p_user_id and v.question_id = q.id)
      and not exists (select 1 from question_skips s where s.user_id = p_user_id and s.question_id = q.id)
  ),
  sponsored as (
    -- Hard geo filter, not a soft priority: a sponsored question is
    -- only ever a candidate for users within the geo_scope it was
    -- actually scoped to. Guaranteed included (not subject to the
    -- random LIMIT draw below) for everyone who does match -- capped
    -- at p_limit purely as a safety net.
    select *
    from eligible
    where is_sponsored
      and (
        geo_scope in ('global', 'country_own')
        or (geo_scope = 'country' and country_code = p_country_code)
        or (geo_scope = 'regional' and region_code = p_region)
      )
    order by random()
    limit p_limit
  ),
  non_sponsored as (
    -- Same soft geo-tier-then-random logic as before -- 'regional' now
    -- correctly checks region_code instead of being silently treated
    -- as an alias for 'country'.
    select *
    from eligible
    where not is_sponsored
    order by
      case
        when geo_scope in ('global', 'country_own') then 0
        when geo_scope = 'country' and country_code = p_country_code then 0
        when geo_scope = 'regional' and region_code = p_region then 0
        else 1
      end,
      random()
    limit greatest(p_limit - (select count(*) from sponsored), 0)
  )
  select * from sponsored
  union all
  select * from non_sponsored;
$function$;

CREATE OR REPLACE FUNCTION public.get_sponsorship_reach_counts()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'global', (select count(*) from profiles),
    'by_country', (
      select coalesce(jsonb_object_agg(country_code, cnt), '{}'::jsonb)
      from (
        select country_code, count(*) as cnt
        from profiles
        where country_code is not null
        group by country_code
      ) t
    ),
    'by_region', (
      select coalesce(jsonb_object_agg(region, cnt), '{}'::jsonb)
      from (
        select region, count(*) as cnt
        from profiles
        where region is not null
        group by region
      ) t
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_sponsorship_reach_counts() TO anon, authenticated;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('get_sponsorship_reach_counts', 'Client RPC (public sponsorship pricing page, unauthenticated) — returns only aggregate counts (global total, per-country, per-region) with no individual rows or PII. Used to compute live per-capita sponsorship pricing.')
ON CONFLICT (function_name) DO NOTHING;
