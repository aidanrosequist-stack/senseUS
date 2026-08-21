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

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { "Content-Type": "application/json" }, status: 401 }
    )
  }

  try {
    const { data, error } = await adminClient.rpc("calculate_all_integrity_weights")
    if (error) throw error

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