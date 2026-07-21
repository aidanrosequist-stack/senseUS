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
//
// Usage: import into Admin.jsx and render as a new tab, e.g.
//   <AdminReports supabase={supabase} />

import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const ALERT_LABELS = {
  registration_spike: "Registration Spike",
  vote_manipulation: "Vote Manipulation",
  coordinated_signup: "Coordinated Signup",
  flagged_question: "Flagged Question",
  transparency_event: "Transparency Event",
};

const SEVERITY_COLORS = {
  warning: "#c2731f",
  critical: "#c21f1f",
};

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
  const [questionSort, setQuestionSort] = useState({ field: "votes", dir: "desc" });
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadDashboard();
    // Refresh every 60s so the dashboard stays reasonably live without
    // hammering the DB on every render.
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboard() {
    try {
      setError(null);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: newRegistrations },
        { count: totalVotes24h },
        { count: totalUsers },
        { count: totalVotesAll },
        { data: profilesLast30 },
        { data: votesLast30 },
        { data: anomalyRows },
        { data: questionRows },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("votes").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("votes").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("created_at").gte("created_at", since30d),
        supabase.from("votes").select("created_at").gte("created_at", since30d),
        supabase
          .from("anomaly_log")
          .select("*")
          .order("triggered_at", { ascending: false })
          .limit(25),
        supabase
          .from("questions")
          .select("id, text, domain, human_moderation_required, created_at")
          .limit(100),
      ]);

      setStats({
        newRegistrations: newRegistrations || 0,
        totalVotes24h: totalVotes24h || 0,
        totalUsers: totalUsers || 0,
        totalVotesAll: totalVotesAll || 0,
      });

      setRegistrationSeries(bucketByDay(profilesLast30 || [], "created_at"));
      setVoteSeries(bucketByDay(votesLast30 || [], "created_at"));
      setAnomalies(anomalyRows || []);
      const questionIds = (questionRows || []).map((q) => q.id);
      const { data: tallyRows } = await supabase.rpc("get_vote_tallies_batch", {
        p_question_ids: questionIds,
      });
      const totalsById = {};
      for (const row of tallyRows || []) {
        totalsById[row.question_id] = Number(row.total);
      }
      setQuestions(
        (questionRows || []).map((q) => ({
          ...q,
          voteCount: totalsById[q.id] ?? 0,
        }))
      );
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError("Couldn't load dashboard data. Check the console for details.");
    } finally {
      setLoading(false);
    }
  }

async function resolveAnomaly(id) {
  await supabase
    .from('anomaly_log')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id)
  setAnomalies((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)))
}

  function bucketByDay(rows, field) {
    const buckets = {};
    for (const row of rows) {
      const day = row[field]?.split("T")[0];
      if (!day) continue;
      buckets[day] = (buckets[day] || 0) + 1;
    }
    return Object.entries(buckets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));
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
                  <td style={{ padding: "6px 8px", maxWidth: 280, color: "#444" }}>
                    {a.details?.question || a.details?.country ||
                      (a.details ? JSON.stringify(a.details) : "—")}
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
