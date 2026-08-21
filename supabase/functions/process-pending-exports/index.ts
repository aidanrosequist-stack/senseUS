// supabase/functions/process-pending-exports/index.ts
//
// Cron-only (see migration 012_export_pipeline.sql, runs every 15 min).
// Picks up exports with status = 'pending', builds a JSON export of the
// requesting user's data, uploads it to the private 'user-exports'
// storage bucket, generates a 7-day signed URL, updates the row to
// 'completed', and emails the link to the user's recovery_email
// (required to exist — enforced by require_recovery_email_for_export_trigger
// at request time, so every pending row here is guaranteed to have one).
//
// Deploy:
//   supabase functions deploy process-pending-exports
//
// Secrets required:
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  return token === SUPABASE_SERVICE_ROLE_KEY
}

// Runs `fn` over `items` with at most `limit` in flight at once. This
// batch is already capped at 20 (below), but was still processed one
// export at a time — each one several sequential round trips (profile
// lookup, build, storage upload, signed URL, DB update, email send) — so
// total runtime scaled with batch size. Bounded concurrency instead of a
// higher cap keeps each individual export's work the same size while
// letting several independent exports' round trips overlap.
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

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

async function buildExportData(userId: string) {
  const [profileRes, votesRes, changesRes, commentsRes, resonancesRes] = await Promise.all([
    adminClient
      .from("profiles")
      .select(
        "first_name, last_initial, display_preference, anon_name, birth_year, country_code, region, avatar, bio, resonance_score, resonance_tier, integrity_weight, answers_count, streak_days, longest_streak, replies_count, likes_received, badges, created_at"
      )
      .eq("id", userId)
      .single(),
    adminClient
      .from("votes")
      .select("choice, created_at, updated_at, change_count, questions(question_number, text)")
      .eq("user_id", userId),
    adminClient
      .from("vote_changes")
      .select("previous_choice, new_choice, changed_at, questions(question_number, text)")
      .eq("user_id", userId),
    adminClient
      .from("comments")
      .select("body, is_deleted, created_at, updated_at, questions(question_number, text)")
      .eq("user_id", userId),
    adminClient
      .from("comment_resonances")
      .select("comment_id, created_at")
      .eq("user_id", userId),
  ])

  return {
    generated_at: new Date().toISOString(),
    profile: profileRes.data ?? null,
    votes: votesRes.data ?? [],
    vote_changes: changesRes.data ?? [],
    comments: commentsRes.data ?? [],
    comment_resonances_given: resonancesRes.data ?? [],
  }
}

async function sendExportEmail(email: string, signedUrl: string) {
  const html = `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Merriweather, Georgia, serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:32px 0;">
        <tr><td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
            <tr><td style="background-color:#2D3DCA; padding:20px 32px;">
              <span style="color:#ffffff; font-size:16px; font-weight:bold;">Your senseUS data export is ready</span>
            </td></tr>
            <tr><td style="padding:24px 32px;">
              <p style="color:#1a1a1a; font-size:15px; line-height:1.6;">
                Your requested data export is ready to download. This link is valid for 7 days.
              </p>
              <p style="margin:20px 0;">
                <a href="${escapeHtml(signedUrl)}" style="background-color:#2D3DCA; color:#ffffff; padding:10px 20px; border-radius:6px; text-decoration:none; font-size:14px; font-weight:500;">Download your data</a>
              </p>
              <p style="color:#999999; font-size:12px;">
                If you didn't request this, you can safely ignore this email — the link expires automatically.
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "senseUS <hello@senseus.app>",
      to: email,
      subject: "Your senseUS data export is ready",
      html,
    }),
  })

  if (!res.ok) {
    throw new Error(`Resend error: ${await res.text()}`)
  }
}

Deno.serve(async (req) => {
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }

  // recovery_email is now embedded via the FK join instead of a separate
  // per-export lookup below — that was a joinable N+1 (one extra round
  // trip per export in this already-capped batch of 20).
  const { data: pending, error: pendingError } = await adminClient
    .from("exports")
    .select("id, user_id, profiles(recovery_email)")
    .eq("status", "pending")
    .limit(20)

  if (pendingError) {
    console.error("Failed to fetch pending exports:", pendingError)
    return new Response(JSON.stringify({ error: pendingError.message }), { status: 500 })
  }

  const results = await mapWithConcurrency(pending || [], 5, async (exportRow: any) => {
    try {
      await adminClient.from("exports").update({ status: "processing" }).eq("id", exportRow.id)

      const recoveryEmail = exportRow.profiles?.recovery_email

      if (!recoveryEmail) {
        // Shouldn't happen — require_recovery_email_for_export_trigger
        // blocks the insert without one — but fail safe rather than
        // send nowhere.
        await adminClient
          .from("exports")
          .update({ status: "failed", error_message: "No recovery email on file." })
          .eq("id", exportRow.id)
        return { id: exportRow.id, status: "failed" }
      }

      const exportData = await buildExportData(exportRow.user_id)
      const filePath = `${exportRow.user_id}/${exportRow.id}.json`

      const { error: uploadError } = await adminClient.storage
        .from("user-exports")
        .upload(filePath, JSON.stringify(exportData, null, 2), {
          contentType: "application/json",
          upsert: true,
        })

      if (uploadError) throw uploadError

      const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
        .from("user-exports")
        .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS, {
          download: "senseUS-data-export.json",
        })

      if (signedUrlError || !signedUrlData?.signedUrl) {
        throw signedUrlError || new Error("Failed to create signed URL")
      }

      const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()

      await adminClient
        .from("exports")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          download_url: signedUrlData.signedUrl,
          expires_at: expiresAt,
        })
        .eq("id", exportRow.id)

      await sendExportEmail(recoveryEmail, signedUrlData.signedUrl)

      return { id: exportRow.id, status: "completed" }
    } catch (err) {
      console.error(`Export ${exportRow.id} failed:`, err)
      await adminClient
        .from("exports")
        .update({ status: "failed", error_message: String(err) })
        .eq("id", exportRow.id)
      return { id: exportRow.id, status: "failed" }
    }
  })

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
