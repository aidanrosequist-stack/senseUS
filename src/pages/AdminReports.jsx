// AdminReports.jsx
//
// New tab for the existing Admin panel. Pulls live stats from Supabase,
// mirroring the daily/weekly report data plus the anomaly log.
//
// SCHEMA — confirmed against live database:
//   profiles(id, created_at, streak_days, integrity_weight, country_code, badges)
//   votes(id, question_id, user_id, created_at)
//   questions(id, text, category, domain, human_moderation_required)
//   comments(id, created_at, is_deleted)
//   anomaly_log(id, alert_type, severity, details, triggered_at, resolved)
//   integrity_events(id, user_id, event_type, details, reviewed, action_taken, created_at)
//
// Usage: import into Admin.jsx and render as a new tab, e.g.
//   <AdminReports supabase={supabase} />

import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { jsPDF } from "jspdf";
import "jspdf-autotable"; // side-effect import: patches doc.autoTable(...) onto jsPDF's prototype
import * as XLSX from "xlsx";

// Same palette Activity.jsx uses for the 4 vote choices (VOTE_COLORS), so
// a stance reads the same color here as it does on the voting UI itself.
const STANCE_COLORS = {
  yes: "#6d8a1c",
  ly: "#d9c01a",
  ln: "#c2731f",
  no: "#c21f1f",
};
// Combined-mode colors: same green/red family as the individual yes/no
// stances above, just for the merged (yes+ly) vs (ln+no) split.
const COMBINED_COLORS = {
  yes: "#4d621d",
  no: "#7a1313",
};

// question_snapshots stores yes_votes/ly_votes/ln_votes/no_votes as raw
// counts (see take_question_snapshots() in migration 000) — this turns a
// day's raw counts into a percentage of that day's total, matching how
// pct_yes/pct_no are already computed server-side.
function pctOf(count, total) {
  if (!total) return 0;
  return Math.round((Number(count) / Number(total)) * 1000) / 10; // 1 decimal
}

// Every alert_type call_alert_function() has ever been called with, across
// migrations 000-052 and the process-account-deletions edge function.
// (Found missing 9 of these — everything from function_heartbeat_stale
// onward — while fixing the Anomaly Log's "wall of raw JSON" bug below:
// they were falling through to the bare alert_type string instead of a
// readable label, same root cause as the details column dumping raw
// JSON. Keep this in sync with any new call_alert_function() call site.)
const ALERT_LABELS = {
  registration_spike: "Registration Spike",
  vote_manipulation: "Vote Manipulation",
  coordinated_signup: "Coordinated Signup",
  flagged_question: "Flagged Question",
  transparency_event: "Transparency Event",
  security_check_failed: "Security Check Failed",
  unauthorized_admin_grant: "Unauthorized Admin Grant",
  function_heartbeat_stale: "Function Heartbeat Stale",
  policy_drift_detected: "Policy Drift Detected",
  admin_action_volume_spike: "Admin Action Volume Spike",
  account_deletions_processed: "Account Deletions Processed",
};

// security_check_failed's `details.check` values, each carrying a
// different array key (tables/functions/columns/profiles/issues/views) —
// see migrations 013/014/033/034/036/050/052.
const SECURITY_CHECK_LABELS = {
  rls_disabled: "RLS disabled",
  unexpected_function_grants: "unexpected function grants",
  unprotected_profile_columns: "unprotected profile columns",
  unauthorized_admin: "unauthorized admin",
  protective_trigger_coverage: "protective trigger coverage",
  unexpected_view_grants: "unexpected view grants",
};

// Builds a short, human-readable summary for the Anomaly Log's Details
// column. Deliberately never touches policy_drift_detected's `previous`/
// `current` snapshot payloads (that's the full weekly RLS/policy state
// for every table — real data, not something to dump in a table cell)
// — `changed_tables`/`rls_disabled_flips` alone say what actually
// changed, which is the same information the alert email itself leads
// with. Anything genuinely unrecognized falls back to a length-capped
// JSON.stringify rather than an unbounded one, so a future alert type
// added without updating this function degrades gracefully instead of
// reproducing the original bug.
function summarizeAnomalyDetails(alertType, details) {
  if (!details) return "—";
  switch (alertType) {
    case "policy_drift_detected": {
      const tables = details.changed_tables?.join(", ") || "—";
      const flipped = details.rls_disabled_flips?.length
        ? ` (RLS disabled on: ${details.rls_disabled_flips.join(", ")})`
        : "";
      return `Changed: ${tables}${flipped}`;
    }
    case "security_check_failed": {
      const label = SECURITY_CHECK_LABELS[details.check] || details.check || "unknown check";
      const items = Object.entries(details)
        .find(([k, v]) => k !== "check" && Array.isArray(v));
      return items ? `${label}: ${items[1].join(", ")}` : label;
    }
    case "function_heartbeat_stale":
      return `${details.function || "unknown function"} — last success ${details.last_success_at || "never"}`;
    case "unauthorized_admin_grant":
      return `Profile ${details.profileId}${details.anonName ? ` (${details.anonName})` : ""}`;
    case "vote_manipulation":
      return details.question ? `"${details.question}" — ${details.count ?? details.changeCount} changes` : JSON.stringify(details);
    case "coordinated_signup":
      return `${details.country || "unknown country"} — ${details.count} signups`;
    case "registration_spike":
    case "admin_action_volume_spike":
      return `${details.count} in ${details.window || "the window"}`;
    case "account_deletions_processed":
      return `${details.count} deleted${details.errors?.length ? `, ${details.errors.length} error(s)` : ""}`;
    case "flagged_question":
      return details.questionId ? `Question ${details.questionId}` : "—";
    case "transparency_event":
      return details.eventType || "—";
    default: {
      if (details.question) return details.question;
      if (details.country) return details.country;
      const json = JSON.stringify(details);
      return json.length > 200 ? json.slice(0, 200) + "…" : json;
    }
  }
}

const SEVERITY_COLORS = {
  warning: "#c2731f",
  critical: "#c21f1f",
};

// integrity_events.event_type — see migration 000_functions.sql for the
// full check-constraint list (7 values) and migration 069 for context on
// why only 5 of them are actually detected. geo_mismatch and
// device_cluster are kept here so a raw value never renders unlabeled if
// they're ever manually inserted, but nothing in this codebase logs them
// today — no IP or device-fingerprint data is captured anywhere to
// detect either one.
const INTEGRITY_EVENT_LABELS = {
  voip_detected: "VOIP Number Detected",
  velocity_spike: "Voting Velocity Spike",
  coordinated_voting: "Coordinated Voting",
  new_account_surge: "New Account Surge",
  single_question_account: "Single-Question Account",
  geo_mismatch: "Geo Mismatch (not yet detected)",
  device_cluster: "Device Cluster (not yet detected)",
};

// Builds a short, human-readable summary for the Integrity Events panel's
// Details column — same idea as summarizeAnomalyDetails above, but for
// integrity_events.details instead of anomaly_log.details (different
// shape per event_type — see migration 069).
function summarizeIntegrityDetails(eventType, details) {
  if (!details) return "—";
  switch (eventType) {
    case "voip_detected":
      return details.line_type ? `Line type: ${details.line_type}` : "Non-fixed VOIP number";
    case "velocity_spike":
      return `${details.peak_votes_in_window} votes in ${details.window || "window"}`;
    case "coordinated_voting":
      return `Question ${details.question_id} — cluster of ${details.cluster_size}`;
    case "new_account_surge":
      return `Cluster of ${details.cluster_size} signups within ${details.window || "window"}`;
    case "single_question_account":
      return `Account age: ${details.account_age_days} day${details.account_age_days === 1 ? "" : "s"}, 1 lifetime vote`;
    default: {
      const json = JSON.stringify(details);
      return json.length > 200 ? json.slice(0, 200) + "…" : json;
    }
  }
}

// integrity_events has no display_preference/anon_name convention to
// respect the way public-facing name display does — this panel is
// admin-only, so it always shows the real first name + last initial for
// clarity during review, falling back to anon_name if first_name is
// somehow missing.
function integrityEventSubjectName(profile) {
  if (!profile) return "Unknown user";
  if (profile.first_name) {
    return `${profile.first_name}${profile.last_initial ? ` ${profile.last_initial}.` : ""}`;
  }
  return profile.anon_name || "Unknown user";
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "16px 20px", border: "1px solid #eee" }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a" }}>{value}</div>
    </div>
  );
}

export default function AdminReports({ supabase }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [registrationSeries, setRegistrationSeries] = useState([]);
  const [voteSeries, setVoteSeries] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [integrityEvents, setIntegrityEvents] = useState([]);
  const [questionSort, setQuestionSort] = useState({ field: "votes", dir: "desc" });
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState(null);

  // Question Trend report state — separate from the auto-refreshing
  // dashboard above, since this is an on-demand lookup for one question
  // at a time rather than something to re-poll every 60s.
  const [trendSearch, setTrendSearch] = useState("");
  const [trendResults, setTrendResults] = useState([]);
  const [trendSearching, setTrendSearching] = useState(false);
  const [trendQuestion, setTrendQuestion] = useState(null);
  const [trendSnapshots, setTrendSnapshots] = useState([]);
  const [trendMode, setTrendMode] = useState("4"); // "4" = all stances, "2" = yes+ly vs ln+no
  const [trendUnit, setTrendUnit] = useState("pct"); // "pct" = % of day's votes, "count" = raw vote counts
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState(null);
  const [exportFormat, setExportFormat] = useState("xlsx"); // "xlsx" | "pdf"
  const [exportLoading, setExportLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // This used to fetch every profiles/votes row from the last 30 days
      // (no limit) and bucket them into a 30-point daily chart in JS —
      // at meaningful volume, a multi-MB payload every 60s poll. It also
      // separately fetched the 400 most-recently-created questions and
      // sorted THOSE client-side by vote count for "top by engagement" —
      // since the bound was on recency, not votes, an older
      // high-engagement question outside that 400-row window could never
      // surface, silently returning the wrong ranking rather than just a
      // slow one. get_daily_activity and get_top_questions_by_votes move
      // both aggregations server-side (see migration 021), returning only
      // the small, already-correct results this dashboard actually needs.
      const [
        { count: newRegistrations },
        { count: totalVotes24h },
        { count: totalUsers },
        { count: totalVotesAll },
        { data: dailyActivity },
        { data: anomalyRows },
        { data: integrityEventRows },
        { data: topQuestions },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("votes").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("votes").select("*", { count: "exact", head: true }),
        supabase.rpc("get_daily_activity", { p_since: since30d }),
        supabase
          .from("anomaly_log")
          .select("*")
          .order("triggered_at", { ascending: false })
          .limit(25),
        // Admins have full SELECT on profiles (see "Admins can view all
        // profiles" policy) so this embedded join resolves for admin
        // sessions the same way flaggedComments' profiles join does
        // elsewhere in Admin.jsx.
        supabase
          .from("integrity_events")
          .select("id, user_id, event_type, details, reviewed, action_taken, created_at, profiles (first_name, last_initial, anon_name)")
          .order("created_at", { ascending: false })
          .limit(25),
        supabase.rpc("get_top_questions_by_votes", { p_limit: 20 }),
      ]);

      setStats({
        newRegistrations: newRegistrations || 0,
        totalVotes24h: totalVotes24h || 0,
        totalUsers: totalUsers || 0,
        totalVotesAll: totalVotesAll || 0,
      });

      setRegistrationSeries((dailyActivity || []).map((d) => ({ date: d.day, count: Number(d.registrations) })));
      setVoteSeries((dailyActivity || []).map((d) => ({ date: d.day, count: Number(d.votes) })));
      setAnomalies(anomalyRows || []);
      setIntegrityEvents(integrityEventRows || []);
      // Now genuinely the top 20 by vote count platform-wide, not the top
      // 20 (by whichever column is sorted) within a 400-most-recent pool —
      // the column-header sort below re-orders within this same set of 20.
      setQuestions(
        (topQuestions || []).map((q) => ({
          ...q,
          voteCount: Number(q.vote_count),
        }))
      );
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError("Couldn't load dashboard data. Check the console for details.");
    } finally {
      setLoading(false);
    }
  }, [])

  useEffect(() => {
    loadDashboard();
    // Refresh every 60s so the dashboard stays reasonably live without
    // hammering the DB on every render.
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  // Debounced question search for the trend report below — queries
  // `questions` directly (same "Authenticated users can view published
  // questions" / "Admins can do everything" policies every other page
  // already relies on) rather than a dedicated search RPC, since none of
  // the ones referenced elsewhere in the schema (admin_search_questions,
  // search_questions) are actually called from anywhere in src/ today and
  // this dashboard is already admin-only.
  useEffect(() => {
    const q = trendSearch.trim();
    if (q.length < 2) {
      setTrendResults([]);
      return;
    }
    setTrendSearching(true);
    const handle = setTimeout(async () => {
      const { data, error: searchErr } = await supabase
        .from("questions")
        .select("id, text, domain, category, question_number, created_at, published_at, human_moderation_required, is_sponsored")
        .not("published_at", "is", null)
        .ilike("text", `%${q}%`)
        .order("published_at", { ascending: false })
        .limit(15);
      if (!searchErr) setTrendResults(data || []);
      setTrendSearching(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [trendSearch, supabase]);

  async function selectTrendQuestion(question) {
    setTrendQuestion(question);
    setTrendResults([]);
    setTrendSearch("");
    setTrendError(null);
    setTrendLoading(true);
    // Full un-pruned history for this one question, oldest first — daily
    // snapshots have accumulated since its publish date (see
    // take_question_snapshots() in migration 000; nothing here is ever
    // pruned).
    const { data, error: snapErr } = await supabase
      .from("question_snapshots")
      .select("snapshot_date, pct_yes, pct_no, total_votes, yes_votes, ly_votes, ln_votes, no_votes")
      .eq("question_id", question.id)
      .order("snapshot_date", { ascending: true });
    if (snapErr) {
      setTrendError("Couldn't load snapshot history: " + snapErr.message);
      setTrendSnapshots([]);
    } else {
      setTrendSnapshots(
        (data || []).map((s) => ({
          date: s.snapshot_date,
          // Percentage of that day's votes, per stance.
          yesPct: pctOf(s.yes_votes, s.total_votes),
          lyPct: pctOf(s.ly_votes, s.total_votes),
          lnPct: pctOf(s.ln_votes, s.total_votes),
          noPct: pctOf(s.no_votes, s.total_votes),
          // Raw vote counts, per stance — straight from the snapshot row.
          yesCount: Number(s.yes_votes) || 0,
          lyCount: Number(s.ly_votes) || 0,
          lnCount: Number(s.ln_votes) || 0,
          noCount: Number(s.no_votes) || 0,
          // Combined yes+ly vs ln+no, both units. Percentage uses the
          // already-rounded pct_yes/pct_no columns (same values
          // Activity.jsx's trend indicator uses); count is summed here
          // since question_snapshots only stores the combined percentage,
          // not a combined count column.
          combinedYesPct: s.pct_yes,
          combinedNoPct: s.pct_no,
          combinedYesCount: (Number(s.yes_votes) || 0) + (Number(s.ly_votes) || 0),
          combinedNoCount: (Number(s.ln_votes) || 0) + (Number(s.no_votes) || 0),
          total_votes: s.total_votes,
        }))
      );
    }
    setTrendLoading(false);
  }

  // Converts a "#rrggbb" string (all the STANCE_COLORS/COMBINED_COLORS
  // values already use this format) into the [r, g, b] triple
  // jsPDF's setDrawColor/setFillColor/setTextColor expect.
  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  // Draws the same trend line(s) currently shown on screen directly
  // into the PDF with jsPDF's own vector line-drawing primitives —
  // deliberately not a rasterized snapshot of the on-screen recharts
  // SVG (no html2canvas dependency, no tainted-canvas/CORS surface,
  // and the output stays crisp at any zoom since it's real vector
  // content, not a bitmap).
  function drawTrendChartOnPdf(doc, x, y, width, height, snapshots, mode, unit) {
    const series =
      mode === "4"
        ? [
            { key: unit === "pct" ? "yesPct" : "yesCount", name: "Yes", color: STANCE_COLORS.yes },
            { key: unit === "pct" ? "lyPct" : "lyCount", name: "Leaning yes", color: STANCE_COLORS.ly },
            { key: unit === "pct" ? "lnPct" : "lnCount", name: "Leaning no", color: STANCE_COLORS.ln },
            { key: unit === "pct" ? "noPct" : "noCount", name: "No", color: STANCE_COLORS.no },
          ]
        : [
            { key: unit === "pct" ? "combinedYesPct" : "combinedYesCount", name: "Yes + Leaning yes", color: COMBINED_COLORS.yes },
            { key: unit === "pct" ? "combinedNoPct" : "combinedNoCount", name: "No + Leaning no", color: COMBINED_COLORS.no },
          ];

    const chartH = height - 14; // reserve room for the legend row below the plot
    const allValues = series.flatMap((s) => snapshots.map((p) => Number(p[s.key]) || 0));
    const maxVal = unit === "pct" ? 100 : Math.max(1, ...allValues);
    const minVal = 0;

    const plotX = (i) => x + (snapshots.length <= 1 ? 0 : (i / (snapshots.length - 1)) * width);
    const plotY = (v) => y + chartH - ((v - minVal) / (maxVal - minVal || 1)) * chartH;

    // Axes
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.line(x, y, x, y + chartH);
    doc.line(x, y + chartH, x + width, y + chartH);

    // Y-axis ticks (min/mid/max)
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    [minVal, (minVal + maxVal) / 2, maxVal].forEach((v) => {
      const yy = plotY(v);
      doc.text(`${Math.round(v)}${unit === "pct" ? "%" : ""}`, x - 2, yy, { align: "right", baseline: "middle" });
    });

    // X-axis ticks — first, middle, last date, so a dense history doesn't overlap
    const tickIdxs = snapshots.length <= 1 ? [0] : [0, Math.floor((snapshots.length - 1) / 2), snapshots.length - 1];
    [...new Set(tickIdxs)].forEach((i) => {
      doc.text(String(snapshots[i]?.date ?? ""), plotX(i), y + chartH + 5, { align: "center" });
    });

    // One polyline per series
    series.forEach((s) => {
      const [r, g, b] = hexToRgb(s.color);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.5);
      for (let i = 1; i < snapshots.length; i++) {
        const v0 = Number(snapshots[i - 1][s.key]) || 0;
        const v1 = Number(snapshots[i][s.key]) || 0;
        doc.line(plotX(i - 1), plotY(v0), plotX(i), plotY(v1));
      }
    });

    // Legend row, wrapped left-to-right beneath the plot
    let legendX = x;
    const legendY = y + height - 3;
    doc.setFontSize(8);
    series.forEach((s) => {
      const [r, g, b] = hexToRgb(s.color);
      doc.setFillColor(r, g, b);
      doc.rect(legendX, legendY - 2.5, 3, 3, "F");
      doc.setTextColor(60, 60, 60);
      doc.text(s.name, legendX + 4.5, legendY);
      legendX += doc.getTextWidth(s.name) + 14;
    });
  }

  // Pulls the two pieces of data the Question Trend screen doesn't
  // already have loaded: live, exact vote tallies by choice (the
  // snapshot history is daily and by stance percentage/count, not a
  // single up-to-the-second total) and comment counts. Both are simple
  // client queries against tables every signed-in user can already
  // read a scoped slice of — nothing new needed at the database layer.
  async function fetchExportExtras(questionId) {
    const [{ data: voteRows, error: voteErr }, { count: commentCount, error: commentErr }, { count: flaggedCount, error: flagErr }] =
      await Promise.all([
        supabase.from("votes").select("choice").eq("question_id", questionId),
        supabase.from("comments").select("*", { count: "exact", head: true }).eq("question_id", questionId).eq("is_deleted", false),
        supabase.from("comments").select("*", { count: "exact", head: true }).eq("question_id", questionId).eq("is_deleted", false).eq("is_flagged", true),
      ]);
    if (voteErr || commentErr || flagErr) {
      throw new Error((voteErr || commentErr || flagErr).message);
    }
    const tallies = { yes: 0, ly: 0, ln: 0, no: 0, dec: 0 };
    (voteRows || []).forEach((v) => {
      if (tallies[v.choice] !== undefined) tallies[v.choice] += 1;
    });
    const totalVotes = (voteRows || []).length;
    return { tallies, totalVotes, commentCount: commentCount || 0, flaggedCount: flaggedCount || 0 };
  }

  async function exportQuestionReport() {
    if (!trendQuestion) return;
    setExportLoading(true);
    setTrendError(null);
    try {
      const extras = await fetchExportExtras(trendQuestion.id);
      if (exportFormat === "xlsx") {
        exportQuestionXlsx(trendQuestion, trendSnapshots, extras);
      } else {
        exportQuestionPdf(trendQuestion, trendSnapshots, extras, trendMode, trendUnit);
      }
    } catch (err) {
      setTrendError("Couldn't build export: " + err.message);
    } finally {
      setExportLoading(false);
    }
  }

  function questionFileBase(question) {
    const numberPart = question.question_number != null ? `q${question.question_number}` : question.id.slice(0, 8);
    return `senseus-${numberPart}`;
  }

  function exportQuestionXlsx(question, snapshots, extras) {
    const summaryRows = [
      ["Question", question.text],
      ["Question #", question.question_number ?? "—"],
      ["Category", question.category ?? "—"],
      ["Domain", question.domain ?? "—"],
      ["Created", question.created_at ? new Date(question.created_at).toLocaleString() : "—"],
      ["Published", question.published_at ? new Date(question.published_at).toLocaleString() : "—"],
      ["Human moderation required", question.human_moderation_required ? "Yes" : "No"],
      ["Sponsored", question.is_sponsored ? "Yes" : "No"],
      [],
      ["Total votes (live)", extras.totalVotes],
      ["Yes", extras.tallies.yes],
      ["Leaning yes", extras.tallies.ly],
      ["Leaning no", extras.tallies.ln],
      ["No", extras.tallies.no],
      ["Declined to answer", extras.tallies.dec],
      [],
      ["Total comments", extras.commentCount],
      ["Flagged comments", extras.flaggedCount],
      [],
      ["Exported", new Date().toLocaleString()],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 28 }, { wch: 60 }];

    const historyHeader = [
      "Date",
      "Yes votes",
      "Leaning-yes votes",
      "Leaning-no votes",
      "No votes",
      "Total votes",
      "Yes %",
      "Leaning-yes %",
      "Leaning-no %",
      "No %",
      "Combined Yes+LY %",
      "Combined No+LN %",
    ];
    const historyRows = snapshots.map((s) => [
      s.date,
      s.yesCount,
      s.lyCount,
      s.lnCount,
      s.noCount,
      s.total_votes,
      s.yesPct,
      s.lyPct,
      s.lnPct,
      s.noPct,
      s.combinedYesPct,
      s.combinedNoPct,
    ]);
    const historySheet = XLSX.utils.aoa_to_sheet([historyHeader, ...historyRows]);
    historySheet["!cols"] = historyHeader.map(() => ({ wch: 14 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
    XLSX.utils.book_append_sheet(workbook, historySheet, "Daily History");
    XLSX.writeFile(workbook, `${questionFileBase(question)}.xlsx`);
  }

  function exportQuestionPdf(question, snapshots, extras, mode, unit) {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    doc.setFontSize(11);
    doc.setTextColor(109, 166, 39); // senseUS green, matches the "US" in the wordmark elsewhere in the app
    doc.text("senseUS", margin, 15);
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(14);
    const titleLines = doc.splitTextToSize(question.text, pageWidth - margin * 2);
    doc.text(titleLines, margin, 24);
    let cursorY = 24 + titleLines.length * 6 + 4;

    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const meta = [
      question.category ? `Category: ${question.category}` : null,
      question.domain ? `Domain: ${question.domain}` : null,
      question.question_number != null ? `Question #${question.question_number}` : null,
      question.published_at ? `Published: ${new Date(question.published_at).toLocaleDateString()}` : null,
    ].filter(Boolean).join("   ·   ");
    doc.text(meta, margin, cursorY);
    cursorY += 8;

    if (snapshots.length > 0) {
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Vote trend (${mode === "4" ? "4 stances" : "Yes vs No"}, ${unit === "pct" ? "% of day's votes" : "vote count"})`, margin, cursorY);
      cursorY += 3;
      drawTrendChartOnPdf(doc, margin + 10, cursorY, pageWidth - margin * 2 - 10, 55, snapshots, mode, unit);
      cursorY += 55 + 8;
    } else {
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text("No snapshot history yet for this question.", margin, cursorY);
      cursorY += 8;
    }

    doc.autoTable({
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [["Stance", "Votes", "% of total"]],
      body: [
        ["Yes", extras.tallies.yes, pctOf(extras.tallies.yes, extras.totalVotes) + "%"],
        ["Leaning yes", extras.tallies.ly, pctOf(extras.tallies.ly, extras.totalVotes) + "%"],
        ["Leaning no", extras.tallies.ln, pctOf(extras.tallies.ln, extras.totalVotes) + "%"],
        ["No", extras.tallies.no, pctOf(extras.tallies.no, extras.totalVotes) + "%"],
        ["Declined to answer", extras.tallies.dec, pctOf(extras.tallies.dec, extras.totalVotes) + "%"],
      ],
      foot: [["Total", extras.totalVotes, "—"]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [45, 61, 202] },
      theme: "striped",
    });

    const afterTableY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`Total comments: ${extras.commentCount}  (${extras.flaggedCount} flagged)`, margin, afterTableY);

    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(
      `Exported ${new Date().toLocaleString()} · full daily history available in the spreadsheet export`,
      margin,
      doc.internal.pageSize.getHeight() - 10
    );

    doc.save(`${questionFileBase(question)}.pdf`);
  }

async function resolveAnomaly(id) {
  const { error } = await supabase
    .from('anomaly_log')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    alert('Something went wrong: ' + error.message)
    return
  }
  setAnomalies((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)))
}

async function deleteAnomaly(id) {
  if (!window.confirm('Delete this anomaly log entry? This cannot be undone.')) return
  const { error } = await supabase
    .from('anomaly_log')
    .delete()
    .eq('id', id)
  if (error) {
    alert('Something went wrong: ' + error.message)
    return
  }
  setAnomalies((prev) => prev.filter((a) => a.id !== id))
}

async function clearResolvedAnomalies() {
  const resolvedIds = anomalies.filter((a) => a.resolved).map((a) => a.id)
  if (resolvedIds.length === 0) return
  if (!window.confirm(`Delete all ${resolvedIds.length} resolved anomaly log entries? This cannot be undone.`)) return
  const { error } = await supabase
    .from('anomaly_log')
    .delete()
    .in('id', resolvedIds)
  if (error) {
    alert('Something went wrong: ' + error.message)
    return
  }
  setAnomalies((prev) => prev.filter((a) => !a.resolved))
}

async function reviewIntegrityEvent(id) {
  const { error } = await supabase
    .from('integrity_events')
    .update({ reviewed: true })
    .eq('id', id)
  if (error) {
    alert('Something went wrong: ' + error.message)
    return
  }
  setIntegrityEvents((prev) => prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e)))
}

  function sortedQuestions() {
    const sorted = [...questions].sort((a, b) => {
      const field = questionSort.field === "votes" ? "voteCount" : questionSort.field;
      const av = a[field];
      const bv = b[field];
      if (av < bv) return questionSort.dir === "asc" ? -1 : 1;
      if (av > bv) return questionSort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function toggleSort(field) {
    setQuestionSort((prev) =>
      prev.field === field ? { field, dir: prev.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" }
    );
  }

  if (loading) {
    return <div style={{ padding: 32, color: "#888" }}>Loading dashboard…</div>;
  }

  if (error) {
    return <div style={{ padding: 32, color: "#c21f1f" }}>{error}</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: "Merriweather, Georgia, serif" }}>
      <h2 style={{ marginBottom: 16, color: "#1a1a1a" }}>Reporting Dashboard</h2>

      {/* Live stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard label="New Registrations (24h)" value={stats.newRegistrations} />
        <StatCard label="Votes Cast (24h)" value={stats.totalVotes24h} />
        <StatCard label="Total Users" value={stats.totalUsers} />
        <StatCard label="Total Votes (all time)" value={stats.totalVotesAll} />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Registrations (last 30 days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={registrationSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#2D3DCA" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Votes (last 30 days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={voteSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#52B788" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Anomaly log */}
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee", marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#888" }}>Anomaly Log (most recent 25)</div>
          {anomalies.some((a) => a.resolved) && (
            <button
              onClick={clearResolvedAnomalies}
              style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid #c21f1f", background: "white", color: "#c21f1f", cursor: "pointer" }}
            >
              Clear resolved
            </button>
          )}
        </div>
        {anomalies.length === 0 ? (
          <div style={{ color: "#999", fontSize: 13 }}>No anomalies logged.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Details</th>
                <th style={{ padding: "6px 8px" }}>Severity</th>
                <th style={{ padding: "6px 8px" }}>Triggered</th>
                <th style={{ padding: "6px 8px" }}>Resolved</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "6px 8px" }}>{ALERT_LABELS[a.alert_type] || a.alert_type}</td>
                  <td style={{ padding: "6px 8px", maxWidth: 280, wordBreak: "break-word", color: "#444" }}>
                    {summarizeAnomalyDetails(a.alert_type, a.details)}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ color: SEVERITY_COLORS[a.severity] || "#666", fontWeight: 600 }}>
                      {a.severity}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", color: "#666" }}>
                    {new Date(a.triggered_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
  {a.resolved ? "Yes" : (
    <button
      onClick={() => resolveAnomaly(a.id)}
      style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid #2D3DCA", background: "white", color: "#2D3DCA", cursor: "pointer" }}
    >
      Mark resolved
    </button>
  )}
</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      onClick={() => deleteAnomaly(a.id)}
                      title="Delete this entry"
                      style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid #999", background: "white", color: "#999", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Integrity events — see migration 069_fraud_signal_detection.sql.
          Separate from the Anomaly Log above: anomaly_log is platform/
          config-level ("RLS just got disabled"), integrity_events is
          per-user fraud signals ("this account's voting pattern looks
          off"), each with its own review workflow. */}
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee", marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Integrity Events (most recent 25)</div>
        {integrityEvents.length === 0 ? (
          <div style={{ color: "#999", fontSize: 13 }}>No integrity events logged.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "6px 8px" }}>User</th>
                <th style={{ padding: "6px 8px" }}>Signal</th>
                <th style={{ padding: "6px 8px" }}>Details</th>
                <th style={{ padding: "6px 8px" }}>Action Taken</th>
                <th style={{ padding: "6px 8px" }}>Logged</th>
                <th style={{ padding: "6px 8px" }}>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {integrityEvents.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "6px 8px" }}>{integrityEventSubjectName(e.profiles)}</td>
                  <td style={{ padding: "6px 8px" }}>{INTEGRITY_EVENT_LABELS[e.event_type] || e.event_type}</td>
                  <td style={{ padding: "6px 8px", maxWidth: 280, wordBreak: "break-word", color: "#444" }}>
                    {summarizeIntegrityDetails(e.event_type, e.details)}
                  </td>
                  <td style={{ padding: "6px 8px", color: "#666" }}>{e.action_taken || "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#666" }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {e.reviewed ? "Yes" : (
                      <button
                        onClick={() => reviewIntegrityEvent(e.id)}
                        style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid #2D3DCA", background: "white", color: "#2D3DCA", cursor: "pointer" }}
                      >
                        Mark reviewed
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Question engagement table */}
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee" }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Question Engagement</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #eee" }}>
              <th style={{ padding: "6px 8px", cursor: "pointer" }} onClick={() => toggleSort("text")}>
                Question
              </th>
              <th style={{ padding: "6px 8px", cursor: "pointer" }} onClick={() => toggleSort("votes")}>
                Votes
              </th>
              <th style={{ padding: "6px 8px", cursor: "pointer" }} onClick={() => toggleSort("created_at")}>
                Created
              </th>
              <th style={{ padding: "6px 8px" }}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {sortedQuestions()
              .slice(0, 20)
              .map((q) => (
                <tr key={q.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "6px 8px", maxWidth: 320 }}>{q.text}</td>
                  <td style={{ padding: "6px 8px" }}>{q.voteCount}</td>
                  <td style={{ padding: "6px 8px", color: "#666" }}>
                    {new Date(q.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {q.human_moderation_required ? <span style={{ color: "#c21f1f" }}>Yes</span> : "No"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Question Trend report — per-question vote-stance history, from
          publication to today, in either a 4-line (yes/ly/ln/no) or
          2-line (yes+ly vs ln+no) view. Backed by question_snapshots,
          which take_question_snapshots() populates daily and never
          prunes (see migration 000). */}
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee", marginTop: 32 }}>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Question Trend</div>

        <div style={{ position: "relative", marginBottom: 16 }}>
          <input
            type="text"
            value={trendSearch}
            onChange={(e) => setTrendSearch(e.target.value)}
            placeholder="Search a published question by text…"
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 13,
              border: "1px solid #ddd",
              borderRadius: 6,
              boxSizing: "border-box",
              fontFamily: "Merriweather, Georgia, serif",
            }}
          />
          {trendSearch.trim().length >= 2 && (trendResults.length > 0 || trendSearching) && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 6,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 5,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {trendSearching ? (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "#999" }}>Searching…</div>
              ) : (
                trendResults.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => selectTrendQuestion(q)}
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      cursor: "pointer",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {q.text}
                    {q.domain && <span style={{ color: "#999", fontSize: 11 }}> — {q.domain}</span>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {!trendQuestion && (
          <div style={{ color: "#999", fontSize: 13 }}>Search for a question above to see its vote trend.</div>
        )}

        {trendQuestion && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 12 }}>
              {trendQuestion.text}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              {/* Primary toggle: percentage of that day's votes, or raw
                  vote counts. */}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setTrendUnit("pct")}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    border: "1px solid #2D3DCA",
                    background: trendUnit === "pct" ? "#2D3DCA" : "white",
                    color: trendUnit === "pct" ? "white" : "#2D3DCA",
                    fontWeight: 600,
                  }}
                >
                  Percentage
                </button>
                <button
                  onClick={() => setTrendUnit("count")}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    border: "1px solid #2D3DCA",
                    background: trendUnit === "count" ? "#2D3DCA" : "white",
                    color: trendUnit === "count" ? "white" : "#2D3DCA",
                    fontWeight: 600,
                  }}
                >
                  Vote Count
                </button>
              </div>

              {/* Secondary toggle: all 4 stances, or the combined 2-line
                  view — applies under either unit above. */}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setTrendMode("4")}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    border: "1px solid #6B7280",
                    background: trendMode === "4" ? "#6B7280" : "white",
                    color: trendMode === "4" ? "white" : "#6B7280",
                    fontWeight: 600,
                  }}
                >
                  4 stances
                </button>
                <button
                  onClick={() => setTrendMode("2")}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    border: "1px solid #6B7280",
                    background: trendMode === "2" ? "#6B7280" : "white",
                    color: trendMode === "2" ? "white" : "#6B7280",
                    fontWeight: 600,
                  }}
                >
                  Yes vs No
                </button>
              </div>
            </div>

            {/* Export — pulls this question's full report (metadata, live
                vote tallies, comment counts, and the daily history above)
                into a downloadable file. The spreadsheet always includes
                the full daily history; the PDF mirrors whatever unit/mode
                toggle is currently selected for its chart. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingTop: 12, borderTop: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 12, color: "#888" }}>Export this question:</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd" }}
              >
                <option value="xlsx">Spreadsheet (.xlsx)</option>
                <option value="pdf">PDF report</option>
              </select>
              <button
                onClick={exportQuestionReport}
                disabled={exportLoading || trendSnapshots.length === 0 && trendLoading}
                style={{
                  fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: exportLoading ? "default" : "pointer",
                  border: "1px solid #52B788", background: exportLoading ? "#eee" : "#52B788", color: exportLoading ? "#999" : "white",
                  fontWeight: 600,
                }}
              >
                {exportLoading ? "Building…" : "Export"}
              </button>
            </div>

            {trendLoading ? (
              <div style={{ color: "#999", fontSize: 13 }}>Loading history…</div>
            ) : trendError ? (
              <div style={{ color: "#c21f1f", fontSize: 13 }}>{trendError}</div>
            ) : trendSnapshots.length === 0 ? (
              <div style={{ color: "#999", fontSize: 13 }}>No snapshot history yet for this question.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trendSnapshots}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  {trendUnit === "pct" ? (
                    <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                  ) : (
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  )}
                  <Tooltip formatter={(value) => (trendUnit === "pct" ? `${value}%` : value)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {trendMode === "4" ? (
                    <>
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "yesPct" : "yesCount"} name="Yes" stroke={STANCE_COLORS.yes} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "lyPct" : "lyCount"} name="Leaning yes" stroke={STANCE_COLORS.ly} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "lnPct" : "lnCount"} name="Leaning no" stroke={STANCE_COLORS.ln} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "noPct" : "noCount"} name="No" stroke={STANCE_COLORS.no} strokeWidth={2} dot={false} />
                    </>
                  ) : (
                    <>
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "combinedYesPct" : "combinedYesCount"} name="Yes + Leaning yes" stroke={COMBINED_COLORS.yes} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey={trendUnit === "pct" ? "combinedNoPct" : "combinedNoCount"} name="No + Leaning no" stroke={COMBINED_COLORS.no} strokeWidth={2} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
