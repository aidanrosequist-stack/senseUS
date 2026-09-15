-- migration: 082_legacy_export_tool_removal_prep.sql
--
-- legacy_export_all_votes() predates the current async export pipeline
-- (012_export_pipeline.sql) -- it's the old synchronous, one-shot version
-- from before exports moved to a request-and-poll model backed by
-- process-pending-exports. It's unclear at this point whether anything
-- outside this codebase ever called it directly, so rather than dropping
-- it outright, this migration keeps the function's exact existing
-- response shape (so nothing that might still be calling it breaks) and
-- adds usage monitoring: any call now logs an alert, so real usage shows
-- up before a future migration removes it for good.
--
-- note_legacy_token_usage() is a small companion piece: legacy_export_all_
-- votes()'s response includes an old-format token in its download_token
-- field, left over from before this project standardized on signed
-- storage URLs for exports. That token was never meant to be presented
-- anywhere as a live Authorization bearer, but nothing has ever actually
-- enforced that. Each service-role-gated edge function now checks for it
-- alongside its real key check and logs a note if it ever shows up, same
-- reasoning as the usage monitoring above -- surface it before deciding
-- whether it's safe to finally clean up.
-- ============================================================

-- ---------- legacy_export_all_votes(): kept for shape compatibility, now monitored ----------
CREATE OR REPLACE FUNCTION public.legacy_export_all_votes()
 RETURNS TABLE(status text, rows_exported integer, download_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform call_alert_function(
    'legacy_export_endpoint_used',
    'critical',
    format(
      'legacy_export_all_votes() was called by uid=%s at %s. This predates the export pipeline (012) and nothing in src/ has called it in a long time -- worth finding out what did, before this gets removed.',
      coalesce(v_uid::text, 'null (no auth context)'),
      now()
    ),
    jsonb_build_object('function', 'legacy_export_all_votes', 'caller_uid', v_uid, 'caller_role', auth.role())
  );

  return query
    select
      'completed'::text as status,
      (select count(*)::integer from public.votes) as rows_exported,
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdja2psc2hmZXN5eHVhbHd4dXJqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwNDA2NzIwMCwiZXhwIjoyMDE5NDIzNjAwfQ.P4qcLnsdRlCo8-nGstF6RFngw_ehuNJk6fCjx7XRjmI'::text as download_token;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.legacy_export_all_votes() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.legacy_export_all_votes() FROM PUBLIC;

INSERT INTO public.intentionally_public_functions (function_name, note) VALUES
  ('legacy_export_all_votes', 'Legacy export utility predating the 012 export pipeline. Broad grant to authenticated predates the narrower per-feature RPC pattern adopted later (051/054/067/074/079) -- flagged for usage monitoring (migration 082) rather than immediate removal since it is unclear whether anything external still depends on it. Revisit once monitoring confirms it is safe to drop.')
ON CONFLICT (function_name) DO UPDATE SET note = EXCLUDED.note;

-- ---------- note_legacy_token_usage(): companion usage-monitoring RPC ----------
--
-- Called by each service-role-gated edge function's own auth-failure path
-- when the presented Bearer token matches legacy_export_all_votes()'s
-- old-format download_token value instead of the real
-- SUPABASE_SERVICE_ROLE_KEY. Only ever called from an edge function's own
-- admin client (service_role) -- no anon/authenticated grant needed.
CREATE OR REPLACE FUNCTION public.note_legacy_token_usage(p_function_name text, p_token_prefix text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform call_alert_function(
    'legacy_token_reused',
    'critical',
    format(
      'The old-format token from legacy_export_all_votes()''s response (migration 082) was just presented as a Bearer token against %s. That value was never meant to be used as a live credential anywhere -- worth tracing where it came from.',
      p_function_name
    ),
    jsonb_build_object('function_name', p_function_name, 'token_prefix', p_token_prefix, 'triggered_at', now())
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.note_legacy_token_usage(text, text) FROM PUBLIC;

-- ============================================================
-- One-time verification (SQL Editor, after applying):
--
-- 1. As any authenticated test user: select * from legacy_export_all_votes();
--    -> returns status='completed', a real rows_exported count, and a
--    token starting "eyJhbGciOiJIUzI1NiIs...". Check anomaly_log for a
--    new 'legacy_export_endpoint_used' / critical row with your test uid.
--
-- 2. As anon (no session): the same call should fail outright (no
--    EXECUTE grant to anon).
--
-- 3. select note_legacy_token_usage('test-function', 'eyJhbGciOiJIUzI1');
--    -> a new 'legacy_token_reused' / critical row in anomaly_log.
-- ============================================================
