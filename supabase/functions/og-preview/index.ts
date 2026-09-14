import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Same display-name rules as getDisplayName() in Compare.jsx/Conversation.jsx
// — kept in sync by hand since this function runs server-side with no
// access to the client bundle. A comparison invite's sender chose their
// own display_preference just like anywhere else in the app, so this
// preview must respect it exactly, not just default to their real name.
function getDisplayName(profile: { first_name?: string; last_initial?: string; display_preference?: string; anon_name?: string } | null): string {
  if (!profile) return "Someone"
  if (profile.display_preference === "anon") return profile.anon_name || "Someone"
  if (profile.display_preference === "first_only") return profile.first_name || "Someone"
  return profile.first_name ? `${profile.first_name} ${profile.last_initial || ""}.`.trim() : "Someone"
}

// Best-effort client IP for the rate limiter below. Supabase Edge
// Functions run behind a proxy that sets x-forwarded-for; take the
// left-most entry (the original client) when there's a chain. No header
// present just means check_og_preview_rate_limit() gets a null ip_hash,
// which it's designed to fail open on rather than block every request
// behind a proxy that doesn't forward one.
function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return req.headers.get("x-real-ip")
}

// SHA-256 the IP before it ever reaches Postgres — the rate-limit table
// only needs a stable per-caller key, not the raw address, and Deno's Web
// Crypto gives us that with no pgcrypto dependency (same reasoning
// generate_short_token used to avoid pgcrypto, migration 074).
async function hashIp(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(ip)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function buildHtml(opts: {
  title: string
  description: string
  canonicalUrl: string
  isCrawler: boolean
}): string {
  const safeTitle = escapeHtml(opts.title)
  const safeDescription = escapeHtml(opts.description)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle} — senseUS</title>
  <meta name="description" content="${safeDescription}" />

  <!-- Open Graph -->
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="https://senseus.app/og-image.png" />
  <meta property="og:url" content="${opts.canonicalUrl}" />
  <meta property="og:site_name" content="senseUS" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="https://senseus.app/og-image.png" />
  <meta name="twitter:site" content="@senseus" />

  ${!opts.isCrawler ? `<meta http-equiv="refresh" content="0;url=${opts.canonicalUrl}" />` : ''}
</head>
<body>
  <p>Redirecting to <a href="${opts.canonicalUrl}">senseUS</a>...</p>
</body>
</html>`
}

async function handleQuestionPreview(number: string, isCrawler: boolean): Promise<Response> {
  // Same visibility rule as the "Public can view published questions" RLS
  // policy (migration 071) — this function reads through the service-role
  // client, which bypasses RLS by design, so it has to apply that same
  // filter itself instead of relying on RLS to have already narrowed the
  // row. Without this, a draft (published_at IS NULL) or a pulled
  // (pulled_at IS NOT NULL) question was fully readable, tally included,
  // by guessing a sequential question_number — round 5's finding.
  const { data: question } = await adminClient
    .from("questions")
    .select("id, text, category, question_number")
    .eq("question_number", parseInt(number, 10))
    .not("published_at", "is", null)
    .lte("published_at", new Date().toISOString())
    .is("pulled_at", null)
    .single()

  if (!question) {
    return new Response("Question not found", { status: 404 })
  }

  // Get vote tally via the shared RPC (integrity-weighted, single aggregate
  // query) instead of pulling every raw vote row down to compute counts here.
  const { data: tally } = await adminClient
    .rpc("get_vote_tally", { p_question_id: question.id })
    .single()

  const counts = {
    yes: Number(tally?.yes || 0),
    ly: Number(tally?.ly || 0),
    ln: Number(tally?.ln || 0),
    no: Number(tally?.no || 0),
  }

  const total = counts.yes + counts.ly + counts.ln + counts.no
  const pctYes = total > 0 ? Math.round(((counts.yes + counts.ly) / total) * 100) : 0
  const pctNo = 100 - pctYes

  const description = total > 0
    ? `${total.toLocaleString()} people have answered. ${pctYes}% yes, ${pctNo}% no. What do you think?`
    : `Be the first to vote on this question at senseUS.`

  const html = buildHtml({
    title: question.text,
    description,
    canonicalUrl: `https://senseus.app/q/${question.question_number}`,
    isCrawler,
  })

  return new Response(html, {
    headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=300" },
    status: 200,
  })
}

// Comparison invite links (/compare/:token) never had a preview at all —
// they fell through Vercel's catch-all rewrite straight to the SPA's
// generic site-wide OG tags, unlike question links. This gives a crawler
// hitting the link (e.g. a messaging app generating a link preview before
// the recipient even opens it) something real: who's inviting them,
// without exposing anything about the comparison itself — there's nothing
// to expose yet, since a pending invite has no results. Uses the admin
// client to read comparison_tokens/profiles directly (bypassing RLS is
// fine and necessary here — this runs server-side under the service role,
// same as the question-tally lookup above, not on behalf of any
// particular signed-in user).
//
// This is inherently an unauthenticated 200-vs-404 oracle on a secret
// token — a crawler generating a preview has no session, so there's no
// auth check to add here, unlike the RPC-side fixes in 074/079. What this
// function CAN and now does add: a per-IP-hash rate limit
// (check_og_preview_rate_limit, migration 081) so a scripted sweep can't
// guess at unlimited speed, and a log_anomaly_only() entry on every miss
// (same 'comparison_token_guess_blocked'-style pattern as
// accept_comparison_token, 074) so a sweep leaves a queryable trail
// instead of zero trace.
async function handleComparePreview(token: string, isCrawler: boolean, ipHash: string | null): Promise<Response> {
  const { data: allowed } = await adminClient.rpc("check_og_preview_rate_limit", { p_ip_hash: ipHash })
  if (allowed === false) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } })
  }

  const { data: tokenRow } = await adminClient
    .from("comparison_tokens")
    .select("sender_id")
    .eq("token", token)
    .single()

  if (!tokenRow) {
    await adminClient.rpc("log_anomaly_only", {
      p_alert_type: "og_preview_token_probe",
      p_severity: "low",
      p_details: { ip_hash: ipHash, attempted_token: token },
    })
    return new Response("Comparison link not found", { status: 404 })
  }

  const { data: sender } = await adminClient
    .from("profiles")
    .select("first_name, last_initial, display_preference, anon_name")
    .eq("id", tokenRow.sender_id)
    .single()

  const senderName = getDisplayName(sender)
  const title = `${senderName} wants to compare voting histories with you`
  const description = "See how your answers line up on senseUS — a verified human opinion platform."

  const html = buildHtml({
    title,
    description,
    canonicalUrl: `https://senseus.app/compare/${token}`,
    isCrawler,
  })

  return new Response(html, {
    headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=300" },
    status: 200,
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const number = url.searchParams.get("number")
  const token = url.searchParams.get("token")
  const userAgent = req.headers.get("user-agent") || ""
  const isCrawler = /facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|WhatsApp|Discordbot|TelegramBot|Applebot|Googlebot/i.test(userAgent)

  if (!number && !token) {
    return new Response("Missing question number or comparison token", { status: 400 })
  }

  try {
    if (token) {
      const ip = getClientIp(req)
      const ipHash = ip ? await hashIp(ip) : null
      return await handleComparePreview(token, isCrawler, ipHash)
    }
    return await handleQuestionPreview(number!, isCrawler)
  } catch (error) {
    return new Response("Error", { status: 500 })
  }
})
