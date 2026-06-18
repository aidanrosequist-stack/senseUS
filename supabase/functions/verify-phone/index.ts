import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")
const TWILIO_VERIFY_SID = Deno.env.get("TWILIO_VERIFY_SID")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { action, phone, code } = body
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)

    if (action === "send") {
      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/Verifications`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: phone, Channel: "sms" }),
        }
      )
      const data = await response.json()
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: response.status,
      })
    }

    if (action === "check") {
      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/VerificationCheck`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: phone, Code: code }),
        }
      )
      const data = await response.json()

      if (data.status !== "approved") {
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: response.status,
        })
      }

      return new Response(JSON.stringify({ status: "approved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      })
    }

    if (action === "complete_registration") {
      const { birthYear, displayNameType, displayName, anonymousColor } = body

      // Create the auth user server-side using the service role (bypasses RLS, no password needed)
      const { data: userData, error: createError } = await adminClient.auth.admin.createUser({
        phone,
        phone_confirm: true,
      })
      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        })
      }

      const userId = userData.user.id

      const { error: insertError } = await adminClient.from("users").insert({
        id: userId,
        phone,
        birth_year: birthYear,
        display_name_type: displayNameType,
        display_name: displayName,
        anonymous_color: anonymousColor,
        is_verified: true,
      })
      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        })
      }

      return new Response(JSON.stringify({ status: "created", userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      })
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    })
  }
})