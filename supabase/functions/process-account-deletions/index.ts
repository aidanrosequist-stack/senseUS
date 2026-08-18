import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  return token === SERVICE_ROLE_KEY
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: dueForDeletion, error: fetchError } = await adminClient
    .from("profiles")
    .select("id")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  let deletedCount = 0
  const errors: string[] = []

  for (const row of dueForDeletion || []) {
    try {
      // Clear any anomaly_log rows that reference this user as the
      // resolver — that FK is NO ACTION, so it would otherwise block
      // the profile delete below.
      await adminClient.from("anomaly_log").update({ resolved_by: null }).eq("resolved_by", row.id)

      // Deleting the profile row cascades through votes, comments,
      // notifications, and everything else tied to user_id.
      const { error: profileError } = await adminClient.from("profiles").delete().eq("id", row.id)
      if (profileError) throw profileError

      // Separately remove the actual Auth user — phone number and all.
      const { error: authError } = await adminClient.auth.admin.deleteUser(row.id)
      if (authError) throw authError

      deletedCount++
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (deletedCount > 0) {
    await adminClient.from("anomaly_log").insert({
      alert_type: "account_deletions_processed",
      severity: "warning",
      details: { count: deletedCount, errors: errors.length > 0 ? errors : undefined },
      email_sent: false,
    })
  }

  return new Response(JSON.stringify({ deleted: deletedCount, errors }), { status: 200 })
})