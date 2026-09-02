import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  return token === SERVICE_ROLE_KEY
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { "Content-Type": "application/json" }, status: 401 }
    )
  }

  try {
    const { data, error } = await adminClient.rpc("detect_fraud_signals")
    if (error) throw error

    // Best-effort — see migration 033_function_heartbeats.sql. A failed
    // heartbeat write should never fail the actual job.
    const { error: heartbeatError } = await adminClient.rpc("record_function_heartbeat", {
      p_function_name: "detect-fraud-signals",
      p_details: { events_logged: data },
    })
    if (heartbeatError) console.error("record_function_heartbeat failed:", heartbeatError)

    return new Response(
      JSON.stringify({ success: true, events_logged: data }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    )
  }
})
