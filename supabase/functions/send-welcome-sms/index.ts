import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER")!

async function deleteTwilioMessage(messageSid: string) {
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${messageSid}.json`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      },
    }
  )
}

// Waits briefly for Twilio to register delivery, then deletes the message
// record. Run via EdgeRuntime.waitUntil() so the function's execution
// environment stays alive until this finishes, rather than potentially
// getting killed right after the HTTP response is returned.
async function deleteAfterDelay(messageSid: string) {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  try {
    await deleteTwilioMessage(messageSid)
  } catch (e) {
    // Silent fail — deletion is best-effort
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  try {
    const { phone } = await req.json()

    if (!phone) {
      return new Response(
        JSON.stringify({ error: "Phone number required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const message = `Welcome to senseUS! We're excited to hear what you have to say. Your phone number is stored only for login purposes and never used for anything else. One human, one voice. Reply STOP to opt out.`

    // Send the SMS
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        },
        body: new URLSearchParams({
          To: phone,
          From: TWILIO_PHONE_NUMBER,
          Body: message,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: data.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }

    // Schedule the delayed deletion as a background task that's guaranteed
    // to run to completion, instead of a bare setTimeout that could get
    // silently cut off.
    // @ts-ignore — EdgeRuntime is a Deno Deploy global, not in standard types
    EdgeRuntime.waitUntil(deleteAfterDelay(data.sid))

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})