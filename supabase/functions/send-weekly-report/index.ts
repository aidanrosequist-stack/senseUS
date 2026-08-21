// supabase/functions/send-weekly-report/index.ts
//
// Compiles the weekly senseUS report and emails it to hello@senseus.app.
// Triggered by pg_cron on Mondays at 8am UTC (see 002_schedule_reports.sql).
//
// SCHEMA — confirmed against live database:
//   - profiles: id, created_at, integrity_weight, country_code
//   - votes: id, question_id, user_id, created_at
//   - comments: id, created_at, is_deleted (filter out deleted for accurate counts)
//   - questions: id, text, category, domain (domain is the 10 subject areas —
//     plain text field, no separate categories table)
//   - transparency_events: id, event_type, created_at
//
// Deploy:
//   supabase functions deploy send-weekly-report
//
// Secrets required (shared with daily report):
//   RESEND_API_KEY, plus SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REPORT_TO = "hello@senseus.app";
const FROM_ADDRESS = "senseUS Reports <hello@senseus.app>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function buildReportHtml(data: {
  thisWeekRegistrations: number;
  lastWeekRegistrations: number;
  growthPct: string;
  totalUsers: number;
  totalVotes: number;
  totalComments: number;
  topQuestions: { text: string; votes: number }[];
  categoryBreakdown: { name: string; votes: number }[];
  integrityDistribution: { bucket: string; count: number }[];
  transparencyEvents: { type: string; date: string }[];
}) {
  const row = (label: string, value: string | number) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #eeeeee; color:#666666; font-size:14px;">${label}</td>
      <td style="padding:10px 0; border-bottom:1px solid #eeeeee; color:#1a1a1a; font-size:14px; font-weight:bold; text-align:right;">${value}</td>
    </tr>
  `;

  const listSection = (title: string, items: string[]) => `
    <tr><td style="padding-top:20px; padding-bottom:8px; color:#2D3DCA; font-size:14px; font-weight:bold;">${title}</td></tr>
    ${items.map((i) => `<tr><td style="padding:4px 0; color:#1a1a1a; font-size:13px;">${i}</td></tr>`).join("")}
  `;

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family: Merriweather, Georgia, serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:32px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
              <tr>
                <td style="background-color:#2D3DCA; padding:24px 32px;">
                  <span style="color:#ffffff; font-size:18px; font-weight:bold;">senseUS — Weekly Report</span>
                  <div style="color:#c9cdf5; font-size:12px; margin-top:4px;">Week of ${new Date().toISOString().split("T")[0]}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 32px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${row("Registrations this week", data.thisWeekRegistrations)}
                    ${row("Registrations last week", data.lastWeekRegistrations)}
                    ${row("Week-over-week growth", data.growthPct)}
                    ${row("Total users", data.totalUsers)}
                    ${row("Total votes (all time)", data.totalVotes)}
                    ${row("Total comments (all time)", data.totalComments)}

                    ${listSection(
                      "Top 5 questions by engagement",
                      data.topQuestions.map((q, i) => `${i + 1}. ${q.text} — ${q.votes} votes`)
                    )}

                    ${listSection(
                      "Category breakdown",
                      data.categoryBreakdown.map((c) => `${c.name}: ${c.votes} votes`)
                    )}

                    ${listSection(
                      "Integrity weight distribution",
                      data.integrityDistribution.map((b) => `${b.bucket}: ${b.count} users`)
                    )}

                    ${listSection(
                      "Transparency events this week",
                      data.transparencyEvents.length > 0
                        ? data.transparencyEvents.map((e) => `${e.date} — ${e.type}`)
                        : ["None this week"]
                    )}
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
    const now = Date.now();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Registrations this week vs last week
    const { count: thisWeekRegistrations } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", weekAgo);

    const { count: lastWeekRegistrations } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", twoWeeksAgo)
      .lt("created_at", weekAgo);

    const growthPct =
      lastWeekRegistrations && lastWeekRegistrations > 0
        ? `${(((( thisWeekRegistrations || 0) - lastWeekRegistrations) / lastWeekRegistrations) * 100).toFixed(1)}%`
        : "N/A (no prior week data)";

    // Total platform stats
    const { count: totalUsers } = await supabase.from("profiles").select("*", { count: "exact", head: true });
    const { count: totalVotes } = await supabase.from("votes").select("*", { count: "exact", head: true });
    const { count: totalComments } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .eq("is_deleted", false);

    // These three used to each pull an entire (or, for the domain
    // breakdown, completely unwindowed joined) table into function memory
    // to aggregate in JS — two separate full scans of `votes` for two
    // different aggregations that could come from one GROUP BY each, plus
    // an N+1 (one extra round trip per top-question to fetch its text).
    // Same 1000-row PostgREST default applies to plain .select() calls —
    // once votes/profiles exceed that, this was starting to silently
    // under-report with no error. All three now aggregate server-side via
    // RPC (see migration 022), returning only the small already-aggregated
    // result this report actually needs.
    const { data: topQuestionRows } = await supabase.rpc("get_report_top_questions", { p_limit: 5 });
    const topQuestions: { text: string; votes: number }[] = (topQuestionRows || []).map((r: any) => ({
      text: r.text,
      votes: Number(r.votes),
    }));

    const { data: domainRows } = await supabase.rpc("get_report_domain_breakdown");
    const categoryBreakdown: { name: string; votes: number }[] = (domainRows || []).map((r: any) => ({
      name: r.domain,
      votes: Number(r.votes),
    }));

    // Integrity weight distribution (bucketed, since range is 1.0000-1.0050).
    // The RPC only returns buckets that actually have at least one user in
    // them, so merge onto the fixed 3-bucket template to keep all three
    // present (at 0) the way the report has always shown them.
    const { data: bucketRows } = await supabase.rpc("get_report_integrity_distribution");
    const buckets = { "1.0000": 0, "1.0001–1.0020": 0, "1.0021–1.0050": 0 };
    for (const row of (bucketRows || []) as any[]) {
      if (row.bucket in buckets) buckets[row.bucket as keyof typeof buckets] = Number(row.count);
    }
    const integrityDistribution = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

    // Transparency events this week
    // ASSUMPTION: table `transparency_events` with `event_type` and `created_at`.
    const { data: events } = await supabase
      .from("transparency_events")
      .select("event_type, created_at")
      .gte("created_at", weekAgo);
    const transparencyEvents = (events || []).map((e: any) => ({
      type: e.event_type,
      date: new Date(e.created_at).toISOString().split("T")[0],
    }));

    const html = buildReportHtml({
      thisWeekRegistrations: thisWeekRegistrations || 0,
      lastWeekRegistrations: lastWeekRegistrations || 0,
      growthPct,
      totalUsers: totalUsers || 0,
      totalVotes: totalVotes || 0,
      totalComments: totalComments || 0,
      topQuestions,
      categoryBreakdown,
      integrityDistribution,
      transparencyEvents,
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
        subject: `senseUS Weekly Report — Week of ${new Date().toISOString().split("T")[0]}`,
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
    console.error("send-weekly-report error:", err);
    return new Response(JSON.stringify({ error: "Unexpected error", details: String(err) }), { status: 500 });
  }
});
