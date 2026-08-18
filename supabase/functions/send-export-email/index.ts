// supabase/functions/send-export-email/index.ts
//
// Sends the "your data export is ready" confirmation email via Resend.
//
// Invoke this from wherever the export file finishes generating —
// e.g. at the end of your export-processing logic, or via a DB trigger
// that fires when an `exports` row flips to status = 'ready'.
//
// Deploy:
//   supabase functions deploy send-export-email
//
// Secrets (set once, never exposed to the client):
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//
// Invoke (from another server-side context, e.g. a Postgres trigger
// via pg_net, or directly from your own backend code):
//   POST https://<project-ref>.functions.supabase.co/send-export-email
//   Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY or anon key>
//   Body: { "email": "user@example.com", "name": "Alex", "downloadUrl": "https://..." }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = "senseUS <hello@senseus.app>";
const REPLY_TO = "privacy@senseus.app";

// CORS headers — tighten `Access-Control-Allow-Origin` to your actual
// domain once you know which contexts will call this function directly.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExportEmailPayload {
  email: string;
  name?: string;
  downloadUrl: string;
}

function buildEmailHtml({ name, downloadUrl }: { name?: string; downloadUrl: string }) {
  const greeting = name ? `Hi ${name},` : "Hi,";

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Merriweather, Georgia, serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding: 32px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
              <tr>
                <td style="background-color:#2D3DCA; padding:24px 32px;">
                  <span style="color:#ffffff; font-size:20px; font-weight:bold;">senseUS</span>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="color:#1a1a1a; font-size:16px; line-height:1.6;">${greeting}</p>
                  <p style="color:#1a1a1a; font-size:16px; line-height:1.6;">
                    Your requested data export is ready to download. This link will remain active for 7 days.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
                    <tr>
                      <td style="background-color:#52B788; border-radius:6px;">
                        <a href="${downloadUrl}" style="display:inline-block; padding:14px 28px; color:#ffffff; text-decoration:none; font-size:15px; font-weight:bold;">
                          Download your data
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="color:#1a1a1a; font-size:14px; line-height:1.6;">
                    This export includes your account details, voting history, and any profile information associated with your senseUS account, in accordance with our Privacy Policy.
                  </p>
                  <p style="color:#666666; font-size:13px; line-height:1.6; margin-top:24px;">
                    If you didn't request this, please contact
                    <a href="mailto:privacy@senseus.app" style="color:#2D3DCA;">privacy@senseus.app</a> immediately.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px; background-color:#fafafa; border-top:1px solid #eeeeee;">
                  <p style="color:#999999; font-size:12px; margin:0;">real humans. real opinions. real truth.</p>
                  <p style="color:#999999; font-size:12px; margin:4px 0 0;">The senseUS team</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const payload: ExportEmailPayload = await req.json();

    if (!payload.email || !payload.downloadUrl) {
      return new Response(
        JSON.stringify({ error: "email and downloadUrl are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: payload.email,
        reply_to: REPLY_TO,
        subject: "Your senseUS data export is ready",
        html: buildEmailHtml({ name: payload.name, downloadUrl: payload.downloadUrl }),
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: resendData }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-export-email error:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});