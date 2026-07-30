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

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?DateSentAfter=${encodeURIComponent(since)}&PageSize=1000`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json();
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

    // Total votes cast
    const { count: totalVotes, data: votesData } = await supabase
      .from("votes")
      .select("question_id", { count: "exact" })
      .gte("created_at", since);

    // Most voted question of the day
    let topQuestion: { text: string; votes: number } | null = null;
    if (votesData && votesData.length > 0) {
      const counts: Record<string, number> = {};
      for (const v of votesData) {
        counts[v.question_id] = (counts[v.question_id] || 0) + 1;
      }
      const topId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (topId) {
        const { data: q } = await supabase
          .from("questions")
          .select("text")
          .eq("id", topId[0])
          .single();
        if (q) topQuestion = { text: q.text, votes: topId[1] };
      }
    }

    // Most popular domain (there's no separate categories table —
    // questions.domain is a plain text field, e.g. "ethics & philosophy")
    let topCategory: { name: string; votes: number } | null = null;
    const { data: categoryVotes } = await supabase
      .from("votes")
      .select("questions(domain)")
      .gte("created_at", since);

    if (categoryVotes && categoryVotes.length > 0) {
      const catCounts: Record<string, number> = {};
      for (const row of categoryVotes as any[]) {
        const domain = row.questions?.domain;
        if (domain) catCounts[domain] = (catCounts[domain] || 0) + 1;
      }
      const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
      if (topCat) topCategory = { name: topCat[0], votes: topCat[1] };
    }

    // Active streaks
    const { count: activeStreaks } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gt("streak_days", 0);

    // Badges: no per-award timestamp exists (badges live as a text array
    // on profiles, not a separate table with awarded_at), so this counts
    // total current badge holders rather than "awarded in last 24h."
    // If per-award tracking is added later (e.g. a badge_events table),
    // swap this out for a proper 24h count.
    const { data: badgeProfiles } = await supabase
      .from("profiles")
      .select("badges")
      .not("badges", "is", null);
    const badgesAwarded = (badgeProfiles || []).filter((p: any) => p.badges && p.badges.length > 0).length;

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