// supabase/functions/check-line-type/index.ts
//
// Called right after phone verification succeeds (see useRegistration.js
// checkCode()). Looks up the verified number's line type via Twilio
// Lookup v2 and, if it's non-fixed VOIP (Google Voice, TextNow, etc. —
// the type phone farms overwhelmingly use), logs it to integrity_events
// and sets profiles.voip_flagged_at, which withholds integrity weight
// growth for a probation window (see migration
// 010_voip_weight_withholding.sql). Registration itself is never
// blocked — this only affects how fast weight grows later.
//
// Fixed VOIP (a real home/business line-replacement service) is
// deliberately NOT flagged — it isn't the type farms use, and flagging
// it would just punish legitimate users for no fraud-prevention benefit.
//
// Deploy:
//   supabase functions deploy check-line-type
//
// Secrets required:
//   supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
//   supabase secrets set TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Identify the caller from their own session — never trust a
    // client-supplied user_id, same pattern as send-welcome-sms.
    const authHeader = req.headers.get("Authorization") ?? ""
    const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()

    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { phone } = await req.json()
    if (!phone || typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "Phone number is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Only ever act on the caller's OWN verified phone number — never
    // let this be used to probe an arbitrary number.
    if (phone !== userData.user.phone) {
      return new Response(JSON.stringify({ error: "Phone does not match verified session." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const lookupUrl = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)

    const lookupRes = await fetch(lookupUrl, {
      headers: { Authorization: `Basic ${twilioAuth}` },
    })

    if (!lookupRes.ok) {
      console.error("Twilio Lookup error:", await lookupRes.text())
      // Don't block registration on a Lookup failure — just skip flagging.
      return new Response(JSON.stringify({ success: true, flagged: false, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const lookupData = await lookupRes.json()
    const lineType = lookupData?.line_type_intelligence?.type ?? null

    if (lineType === "nonFixedVoip") {
      await adminClient.from("integrity_events").insert({
        user_id: userData.user.id,
        event_type: "voip_detected",
        details: {
          line_type: lineType,
          carrier_name: lookupData?.line_type_intelligence?.carrier_name ?? null,
        },
        action_taken: "flagged",
        reviewed: false,
      })

      await adminClient
        .from("profiles")
        .update({ voip_flagged_at: new Date().toISOString() })
        .eq("id", userData.user.id)
    }

    return new Response(
      JSON.stringify({ success: true, flagged: lineType === "nonFixedVoip" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("check-line-type error:", err)
    // Never block registration on an unexpected error here — worst case,
    // an account simply doesn't get checked.
    return new Response(JSON.stringify({ success: true, flagged: false, skipped: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
