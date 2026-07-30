// supabase/functions/join-waitlist/index.ts
//
// Verifies a Cloudflare Turnstile token server-side, then inserts the
// waitlist row using the service role. This replaces a direct anon
// insert into `waitlist` from the client — a client-side widget alone
// doesn't stop someone from calling the insert directly with the anon
// key and skipping the widget entirely, so verification has to happen
// here, not just in the browser.
//
// Deploy:
//   supabase functions deploy join-waitlist
//
// Secrets required:
//   supabase secrets set TURNSTILE_SECRET_KEY=0x...
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY")!

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function verifyTurnstile(token: string, remoteIp: string | null): Promise<boolean> {
  if (!token) return false

  const body = new URLSearchParams()
  body.append("secret", TURNSTILE_SECRET_KEY)
  body.append("response", token)
  if (remoteIp) body.append("remoteip", remoteIp)

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  })

  const outcome = await res.json()
  return outcome.success === true
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const { phone, first_name, turnstileToken } = await req.json()

    if (!phone || typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "Phone number is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Cloudflare recommends passing the caller's IP for stronger scoring,
    // but we deliberately do NOT log it anywhere ourselves — it's only
    // relayed to Cloudflare's own verification call, matching our
    // no-IP-logging principle everywhere else in the app.
    const remoteIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")

    const verified = await verifyTurnstile(turnstileToken, remoteIp)
    if (!verified) {
      return new Response(JSON.stringify({ error: "Verification failed. Please try again." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { error: insertError } = await adminClient
      .from("waitlist")
      .insert({ phone, first_name: first_name || null })

    if (insertError) {
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({ error: "That number is already on the list." }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      console.error("join-waitlist insert error:", insertError)
      return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("join-waitlist error:", err)
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
