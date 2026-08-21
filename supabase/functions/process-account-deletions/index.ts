import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  return token === SERVICE_ROLE_KEY
}

// Runs `fn` over `items` with at most `limit` in flight at once — same
// shape as process-pending-exports' existing .limit(20) cap, just for
// concurrency instead of batch size. Each account deletion is 3
// sequential round trips (anomaly_log update, profile delete, auth user
// delete), so running the whole due-for-deletion batch one row at a time
// meant total runtime scaled linearly with however many accounts were
// due — this runs several of those independent per-user chains at once.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Previously unbounded — a backlog of overdue deletions (e.g. after
  // this cron missed a run) would all be fetched and processed in one
  // invocation. Capped at 75 per run so a large backlog drains over a
  // few runs instead of risking one very long invocation.
  const { data: dueForDeletion, error: fetchError } = await adminClient
    .from("profiles")
    .select("id")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .limit(75)

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  const outcomes = await mapWithConcurrency(dueForDeletion || [], 5, async (row) => {
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

      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, message: `${row.id}: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  const deletedCount = outcomes.filter((o) => o.ok).length
  const errors = outcomes.filter((o): o is { ok: false; message: string } => !o.ok).map((o) => o.message)

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