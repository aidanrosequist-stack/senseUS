// supabase/functions/send-daily-report/index.ts
//
// Compiles the daily senseUS report and emails it to hello@senseus.app.
// Triggered by pg_cron at 7am UTC (see 002_schedule_reports.sql).
//
// SCHEMA — confirmed against live database:
//   - profiles: id, created_at, streak_days, is_admin, badges (text array)
//   - votes: id, question_id, user_id, created_at, choice
//   - questions: id, text, category, domain (domain is the 10 subject areas
//     shown on Explore — Society & Culture, Ethics & Philosophy, etc. —
//     stored as a plain text field, no separate categories table)
//   - Twilio: uses the Messages API to compute SMS delivery success rate
//
// NOTE: badges are NOT tracked with per-award timestamps (no user_badges
// table), so "badges awarded in last 24h" isn't directly queryable.
// This reports total current badge holders instead — see comment below.
//
// Deploy:
//   supabase functions deploy send-daily-report
//
// Secrets required:
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//   supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxx
//   supabase secrets set TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REPORT_TO = "hello@senseus.app";
const FROM_ADDRESS = "senseUS Reports <hello@senseus.app>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getSmsSuccessRate(since: string): Promise<{ sent: number; delivered: number; rate: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { sent: 0, delivered: 0, rate: "N/A (Twilio not configured)" };
  }

  // Twilio's DateSentAfter filter requires a plain YYYY-MM-DD date, not a
  // full ISO timestamp — passing the full timestamp caused the filter to
  // silently fail, returning the account's unfiltered recent messages
  // instead of just the last 24 hours.
  const dateOnly = since.split('T')[0]

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?DateSent%3E=${encodeURIComponent(dateOnly)}&PageSize=1000`;

  console.log("DEBUG: querying with dateOnly =", dateOnly);
  console.log("DEBUG: full URL =", url);

  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json();
    console.log("DEBUG: Twilio response status =", res.status);
    console.log("DEBUG: Twilio message count in response =", (data.messages || []).length);
    console.log("DEBUG: first message (if any) =", JSON.stringify(data.messages?.[0] || null));
    const messages = data.messages || [];
    const sent = messages.length;
    const delivered = messages.filter((m: any) => m.status === "delivered").length;
    const rate = sent > 0 ? `${((delivered / sent) * 100).toFixed(1)}%` : "N/A (no messages sent)";
    return { sent, delivered, rate };
  } catch (err) {
    console.error("Twilio fetch error:", err);
    return { sent: 0, delivered: 0, rate: "Error fetching Twilio data" };
  }
}

function buildReportHtml(data: {
  newRegistrations: number;
  totalVotes: number;
  topQuestion: { text: string; votes: number } | null;
  topCategory: { name: string; votes: number } | null;
  activeStreaks: number;
  badgesAwarded: number;
  sms: { sent: number; delivered: number; rate: string };
}) {
  const row = (label: string, value: string | number) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #eeeeee; color:#666666; font-size:14px;">${label}</td>
      <td style="padding:10px 0; border-bottom:1px solid #eeeeee; color:#1a1a1a; font-size:14px; font-weight:bold; text-align:right;">${value}</td>
    </tr>
  `;

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Merriweather, Georgia, serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:32px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
              <tr>
                <td style="background-color:#2D3DCA; padding:24px 32px;">
                  <span style="color:#ffffff; font-size:18px; font-weight:bold;">senseUS — Daily Report</span>
                  <div style="color:#c9cdf5; font-size:12px; margin-top:4px;">${new Date().toISOString().split("T")[0]}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 32px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${row("New registrations (24h)", data.newRegistrations)}
                    ${row("Total votes cast (24h)", data.totalVotes)}
                    ${row("Most voted question", data.topQuestion ? `${data.topQuestion.text} (${data.topQuestion.votes})` : "No votes yet")}
                    ${row("Most popular category", data.topCategory ? `${data.topCategory.name} (${data.topCategory.votes} votes)` : "N/A")}
                    ${row("Active streaks", data.activeStreaks)}
                    ${row("Total badge holders", data.badgesAwarded)}
                    ${row("SMS delivery rate", `${data.sms.rate} (${data.sms.delivered}/${data.sms.sent})`)}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 32px; background-color:#fafafa; border-top:1px solid #eeeeee;">
                  <p style="color:#999999; font-size:12px; margin:0;">real humans. real opinions. real truth.</p>
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

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === SUPABASE_SERVICE_ROLE_KEY;
}

serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // New registrations
    const { count: newRegistrations } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);

    // Total votes cast (24h)
    const { count: totalVotes } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);

    // Most voted question of the day, and most popular domain. These used
    // to each pull every vote (or, for the domain breakdown, every vote
    // joined to its question) cast in the last 24h into function memory to
    // group in JS — completely unwindowed on the domain query — plus an
    // extra round trip to fetch the top question's text. Both now
    // aggregate server-side via RPC (see migration 022), which also backs
    // the weekly report's all-time versions of the same two queries
    // (p_since is optional — null there, this 24h window here).
    const { data: topQuestionRows } = await supabase.rpc("get_report_top_questions", {
      p_limit: 1,
      p_since: since,
    });
    const topQuestion: { text: string; votes: number } | null = topQuestionRows?.[0]
      ? { text: topQuestionRows[0].text, votes: Number(topQuestionRows[0].votes) }
      : null;

    const { data: domainRows } = await supabase.rpc("get_report_domain_breakdown", { p_since: since });
    const topCategory: { name: string; votes: number } | null = domainRows?.[0]
      ? { name: domainRows[0].domain, votes: Number(domainRows[0].votes) }
      : null;

    // Active streaks
    const { count: activeStreaks } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gt("streak_days", 0);

    // Badges: no per-award timestamp exists (badges live as a text array
    // on profiles, not a separate table with awarded_at), so this counts
    // total current badge holders rather than "awarded in last 24h."
    // If per-award tracking is added later (e.g. a badge_events table),
    // swap this out for a proper 24h count. Used to fetch every profile's
    // full badges array (unbounded — not time-windowed at all, since this
    // is a total, not a delta) just to filter/count in JS; now a single
    // server-side count.
    const { data: badgesAwardedCount } = await supabase.rpc("get_report_badge_holder_count");
    const badgesAwarded = Number(badgesAwardedCount) || 0;

    // SMS delivery rate via Twilio
    const sms = await getSmsSuccessRate(since);

    const html = buildReportHtml({
      newRegistrations: newRegistrations || 0,
      totalVotes: totalVotes || 0,
      topQuestion,
      topCategory,
      activeStreaks: activeStreaks || 0,
      badgesAwarded: badgesAwarded || 0,
      sms,
    });

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: REPORT_TO,
        subject: `senseUS Daily Report — ${new Date().toISOString().split("T")[0]}`,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const err = await resendResponse.json();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Failed to send report", details: err }), { status: 502 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error("send-daily-report error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error", details: String(err) }), { status: 500 });
  }
});