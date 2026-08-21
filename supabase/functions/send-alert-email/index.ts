// supabase/functions/send-alert-email/index.ts
//
// Sends an immediate threshold-alert email. Called by DB triggers
// (via pg_net) the moment a threshold is crossed, and also logs
// the alert to anomaly_log.
//
// Deploy:
//   supabase functions deploy send-alert-email
//
// Secrets required: RESEND_API_KEY (shared with the other report functions)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Was "SERVICE_ROLE_KEY" — Supabase only ever auto-injects
// "SUPABASE_SERVICE_ROLE_KEY". The DB triggers in
// 003_threshold_alert_triggers.sql send the real key as the Bearer token
// (pulled from vault.decrypted_secrets), so this mismatch means
// isAuthorized() below always returned false and every trigger-fired
// alert (registration spikes, vote manipulation, coordinated signups,
// flagged questions, transparency events) has very likely been silently
// rejected with 401 — no alert emails actually going out. Found in the
// 2026-08-21 security review.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALERT_TO = "hello@senseus.app";
const FROM_ADDRESS = "senseUS Alerts <hello@senseus.app>";

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return !!SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface AlertPayload {
  alertType: string;
  severity: "warning" | "critical";
  message: string;
  details?: Record<string, unknown>;
}

const ALERT_LABELS: Record<string, string> = {
  registration_spike: "Registration Spike",
  vote_manipulation: "Vote Manipulation Signal",
  coordinated_signup: "Coordinated Signup Signal",
  flagged_question: "Question Flagged for Review",
  transparency_event: "New Transparency Event",
};

function buildAlertHtml(payload: AlertPayload) {
  const label = escapeHtml(ALERT_LABELS[payload.alertType] || payload.alertType);
  const color = payload.severity === "critical" ? "#c21f1f" : "#c2731f";
  const detailsRows = payload.details
    ? Object.entries(payload.details)
        .map(
          ([k, v]) => `
      <tr>
        <td style="padding:6px 0; color:#666666; font-size:13px;">${escapeHtml(k)}</td>
        <td style="padding:6px 0; color:#1a1a1a; font-size:13px; font-weight:bold; text-align:right;">${escapeHtml(v)}</td>
      </tr>`
        )
        .join("")
    : "";

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Merriweather, Georgia, serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:32px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
              <tr>
                <td style="background-color:${color}; padding:20px 32px;">
                  <span style="color:#ffffff; font-size:16px; font-weight:bold;">⚠ ${label}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 32px;">
                  <p style="color:#1a1a1a; font-size:15px; line-height:1.6;">${escapeHtml(payload.message)}</p>
                  ${detailsRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px; border-top:1px solid #eeeeee; padding-top:12px;">${detailsRows}</table>` : ""}
                  <p style="color:#999999; font-size:12px; margin-top:20px;">Triggered ${new Date().toISOString()}</p>
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), { status: 500 });
  }

  try {
    const payload: AlertPayload = await req.json();
    const label = ALERT_LABELS[payload.alertType] || payload.alertType;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: ALERT_TO,
        subject: `[senseUS Alert] ${label}`,
        html: buildAlertHtml(payload),
      }),
    });

    if (!resendResponse.ok) {
      const err = await resendResponse.json();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Failed to send alert", details: err }), { status: 502 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error("send-alert-email error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error", details: String(err) }), { status: 500 });
  }
});