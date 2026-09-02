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
  ResponsiveContainer,
} from "recharts";

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
        <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Anomaly Log (most recent 25)</div>
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
    </div>
  );
}
