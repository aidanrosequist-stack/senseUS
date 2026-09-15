// supabase/functions/submit-sponsorship-inquiry/index.ts
//
// Public endpoint for the /sponsor page's "get in touch" inquiry form
// (see supabase/migrations/046_sponsorship_inquiries.sql and
// 083_sponsorship_inquiry_length_limits_and_edge_function.sql).
// Previously the form inserted directly into sponsorship_inquiries with
// the anon key -- no CAPTCHA, no rate limit, no length cap at any layer
// (round 7 pentest, 2026-09-14). This follows the same pattern already
// used for the waitlist table (009_waitlist_via_edge_function_only.sql):
// verify a Cloudflare Turnstile token server-side, then insert via the
// service role (which bypasses RLS). Migration 083 drops the direct
// anon/authenticated INSERT policy, so this is now the only way to
// create a row.
//
// Deploy:
//   supabase functions deploy submit-sponsorship-inquiry
//
// Secrets required:
//   supabase secrets set TURNSTILE_SECRET_KEY=0x...
//   (the secret key paired with VITE_TURNSTILE_SITE_KEY in the
//   Cloudflare Turnstile dashboard -- same widget already used by
//   Login/Register, just bound here as a new server-side secret)
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY")

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const VALID_TIERS = new Set(["region", "country", "global"])
const VALID_REGIONS = new Set(["Northeast", "Midwest", "South", "West"])
const VALID_CATEGORIES = new Set([
  "brand", "research", "ngo", "media", "government", "political", "healthcare", "technology", "other",
])

// Mirrors the DB CHECK constraints added in migration 083 -- kept in
// sync deliberately so a too-long submission gets a clean 400 here
// instead of a raw Postgres constraint-violation message.
const MAX_LENGTHS: Record<string, number> = { name: 200, email: 320, company: 200, message: 5000 }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

async function verifyTurnstile(token: string, remoteIp: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SECRET_KEY is not configured")
    return false
  }
  const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token })
  if (remoteIp) body.set("remoteip", remoteIp)
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
    const data = await res.json()
    return data?.success === true
  } catch (err) {
    console.error("Turnstile verification request failed:", err)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 })
  }

  const {
    turnstileToken,
    name,
    email,
    company,
    tier,
    region,
    country_code,
    category,
    wants_custom_content,
    message,
  } = payload as Record<string, any>

  if (!isNonEmptyString(turnstileToken)) {
    return new Response(JSON.stringify({ error: "Missing verification token" }), { status: 400 })
  }

  const remoteIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  const verified = await verifyTurnstile(turnstileToken, remoteIp)
  if (!verified) {
    return new Response(JSON.stringify({ error: "Verification failed. Please try again." }), { status: 403 })
  }

  if (!isNonEmptyString(name) || !isNonEmptyString(email)) {
    return new Response(JSON.stringify({ error: "Name and email are required." }), { status: 400 })
  }
  if (!VALID_TIERS.has(tier)) {
    return new Response(JSON.stringify({ error: "Invalid tier." }), { status: 400 })
  }
  if (region != null && !VALID_REGIONS.has(region)) {
    return new Response(JSON.stringify({ error: "Invalid region." }), { status: 400 })
  }
  if (category != null && !VALID_CATEGORIES.has(category)) {
    return new Response(JSON.stringify({ error: "Invalid category." }), { status: 400 })
  }
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const value = (payload as Record<string, unknown>)[field]
    if (typeof value === "string" && value.length > max) {
      return new Response(
        JSON.stringify({ error: `${field} is too long (max ${max} characters).` }),
        { status: 400 }
      )
    }
  }

  const { error } = await adminClient.from("sponsorship_inquiries").insert({
    name: name.trim(),
    email: email.trim(),
    company: isNonEmptyString(company) ? company.trim() : null,
    tier,
    region: tier === "region" ? region : null,
    country_code: tier === "country" || tier === "region" ? country_code ?? null : null,
    category: category ?? "other",
    wants_custom_content: wants_custom_content === true,
    message: isNonEmptyString(message) ? message.trim() : null,
  })

  if (error) {
    console.error("Failed to insert sponsorship inquiry:", error)
    return new Response(JSON.stringify({ error: "Something went wrong submitting this." }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 })
})
