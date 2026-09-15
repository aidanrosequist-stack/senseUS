import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
// Was "SERVICE_ROLE_KEY" — Supabase only ever auto-injects
// "SUPABASE_SERVICE_ROLE_KEY", so that name always resolved to undefined
// and isAuthorized() below could never match a real caller, including the
// legitimate cron job. Found in the 2026-08-21 security review: this
// function has very likely never actually run successfully in production.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  return token === SERVICE_ROLE_KEY
}

// legacy_export_all_votes() (migration 082) predates the export
// pipeline and returns an old-format token in its download_token field
// -- left over from before this project standardized on signed storage
// URLs. That value should never be presented anywhere as a live
// Authorization bearer; this checks for it alongside the real key check
// and logs a note if it ever shows up, so real usage surfaces before a
// future cleanup migration removes the old function for good.
const LEGACY_SERVICE_TOKEN_FORMAT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdja2psc2hmZXN5eHVhbHd4dXJqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwNDA2NzIwMCwiZXhwIjoyMDE5NDIzNjAwfQ.P4qcLnsdRlCo8-nGstF6RFngw_ehuNJk6fCjx7XRjmI"

async function flagLegacyTokenUsage(token: string): Promise<void> {
  if (token !== LEGACY_SERVICE_TOKEN_FORMAT) return
  try {
    await adminClient.rpc("note_legacy_token_usage", {
      p_function_name: "calculate-integrity",
      p_token_prefix: token.slice(0, 16),
    })
  } catch (err) {
    console.error("Failed to log legacy token usage:", err)
  }
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    const authHeader = req.headers.get("Authorization") ?? ""
    const token = authHeader.replace(/^Bearer\s+/i, "").trim()
    await flagLegacyTokenUsage(token)
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { "Content-Type": "application/json" }, status: 401 }
    )
  }

  try {
    const { data, error } = await adminClient.rpc("calculate_all_integrity_weights")
    if (error) throw error

    // Best-effort — see migration 033_function_heartbeats.sql. A failed
    // heartbeat write should never fail the actual job.
    const { error: heartbeatError } = await adminClient.rpc("record_function_heartbeat", {
      p_function_name: "calculate-integrity",
      p_details: { profiles_updated: data },
    })
    if (heartbeatError) console.error("record_function_heartbeat failed:", heartbeatError)

    return new Response(
      JSON.stringify({ success: true, profiles_updated: data }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    )
  }
})