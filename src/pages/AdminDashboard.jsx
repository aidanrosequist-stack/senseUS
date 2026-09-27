// AdminDashboard.jsx
//
// The /admin "Dashboard" tab -- the default tab, at-a-glance stats only.
// Replaces the old "Reports" tab (AdminReports.jsx), which has been split
// three ways: this file (the live stat cards + 30-day chart + two top-5
// question snapshots), AdminLogs.jsx (the full Anomaly Log, Integrity
// Events, and the full top-20/top-10 question tables), and
// AdminQuestionTrend.jsx (the per-question vote-trend search + export
// tool, now rendered at the top of the Questions tab).
//
// SCHEMA — confirmed against live database:
//   profiles(id, created_at, last_vote_at, streak_days, integrity_weight, country_code, badges)
//   votes(id, question_id, user_id, created_at)
//   integrity_events(id, user_id, event_type, details, reviewed, action_taken, created_at)
//
// Usage: import into Admin.jsx and render as the default tab, e.g.
//   <AdminDashboard supabase={supabase} />

import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function StatCard({ label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "16px 20px", border: "1px solid #eee", height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a1a" }}>{value}</div>
    </div>
  );
}

// Which cards exist and their default left-to-right/top-to-bottom order.
// New cards get appended here; loadCardOrder() below is what lets an
// already-saved localStorage order pick up a newly-added id without
// losing whatever the person already dragged into place.
const DEFAULT_CARD_ORDER = [
  "totalUsers",
  "newRegistrations",
  "votes24h",
  "totalVotesAll",
  "activeToday",
  "activeWeek",
  "activeMonth",
  "activeYear",
  "stickiness",
  "integrityQueue",
];

// Card order is a personal, per-browser display preference -- not
// something anyone else needs to see or that belongs in the database --
// so it lives in localStorage rather than a new table/column, same
// reasoning as any other "remembered UI state" in this app.
const CARD_ORDER_KEY = "senseus_admin_dashboard_card_order";

function loadCardOrder() {
  try {
    const stored = JSON.parse(localStorage.getItem(CARD_ORDER_KEY) || "null");
    if (!Array.isArray(stored)) return DEFAULT_CARD_ORDER;
    // Keep only ids that still exist, in the order they were saved, then
    // append any ids DEFAULT_CARD_ORDER has that the saved order doesn't
    // (a card added in a later release) at the end.
    const known = stored.filter((id) => DEFAULT_CARD_ORDER.includes(id));
    const missing = DEFAULT_CARD_ORDER.filter((id) => !known.includes(id));
    return [...known, ...missing];
  } catch {
    return DEFAULT_CARD_ORDER;
  }
}

function saveCardOrder(order) {
  try {
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Private browsing / storage disabled -- reordering just won't
    // persist across reloads. Not worth surfacing an error for.
  }
}

export default function AdminDashboard({ supabase }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [registrationSeries, setRegistrationSeries] = useState([]);
  const [voteSeries, setVoteSeries] = useState([]);
  const [topVotes, setTopVotes] = useState([]);
  const [topComments, setTopComments] = useState([]);
  const [cardOrder, setCardOrder] = useState(loadCardOrder);

  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const since365d = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

      // "Active" is defined purely by profiles.last_vote_at (set on every
      // cast_vote() call, migrations 055/073) -- there's no login/session
      // signal anywhere in this schema, and votes are what actually
      // matter here (Aidan: "I don't care if users just log in"). Each
      // count below is a plain filtered head-count, same pattern as the
      // existing newRegistrations/totalVotes24h queries -- not a new RPC,
      // since these are simple filters, not cross-row aggregation.
      // idx_profiles_last_vote_at (migration 093) is what keeps the four
      // last_vote_at queries cheap on every 60s poll.
      const [
        { count: newRegistrations },
        { count: totalVotes24h },
        { count: totalUsers },
        { count: totalVotesAll },
        { count: activeToday },
        { count: activeWeek },
        { count: activeMonth },
        { count: activeYear },
        { count: integrityUnreviewed },
        { data: dailyActivity },
        { data: topVotesData },
        { data: topCommentsData },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("votes").select("*", { count: "exact", head: true }).gte("created_at", since24h),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("votes").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_vote_at", since24h),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_vote_at", since7d),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_vote_at", since30d),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("last_vote_at", since365d),
        supabase.from("integrity_events").select("*", { count: "exact", head: true }).eq("reviewed", false),
        supabase.rpc("get_daily_activity", { p_since: since30d }),
        // Condensed (top 5) snapshots for this dashboard -- the full
        // top-20/top-10 tables live on the Logs tab now.
        supabase.rpc("get_top_questions_by_votes", { p_limit: 5 }),
        supabase.rpc("get_top_questions_by_comments", { p_limit: 5 }),
      ]);

      setStats({
        newRegistrations: newRegistrations || 0,
        totalVotes24h: totalVotes24h || 0,
        totalUsers: totalUsers || 0,
        totalVotesAll: totalVotesAll || 0,
        activeToday: activeToday || 0,
        activeWeek: activeWeek || 0,
        activeMonth: activeMonth || 0,
        activeYear: activeYear || 0,
        integrityUnreviewed: integrityUnreviewed || 0,
      });
      setRegistrationSeries((dailyActivity || []).map((d) => ({ date: d.day, count: Number(d.registrations) })));
      setVoteSeries((dailyActivity || []).map((d) => ({ date: d.day, count: Number(d.votes) })));
      setTopVotes((topVotesData || []).map((q) => ({ ...q, voteCount: Number(q.vote_count) })));
      setTopComments((topCommentsData || []).map((q) => ({ ...q, commentCount: Number(q.comment_count) })));
    } catch (err) {
      console.error("Dashboard load error:", err);
      setError("Couldn't load dashboard data. Check the console for details.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  function handleDragStart(index) {
    dragIndexRef.current = index;
  }
  function handleDragOver(e, index) {
    e.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
  }
  function handleDrop(index) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from === null || from === index) return;
    setCardOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      saveCardOrder(next);
      return next;
    });
  }
  function handleDragEnd() {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }

  if (loading) {
    return <div style={{ padding: 32, color: "#888" }}>Loading dashboard…</div>;
  }
  if (error) {
    return <div style={{ padding: 32, color: "#c21f1f" }}>{error}</div>;
  }

  const stickiness = stats.activeMonth > 0 ? Math.round((stats.activeToday / stats.activeMonth) * 1000) / 10 : null;

  const cardDefs = {
    totalUsers: { label: "Total Users", value: stats.totalUsers },
    newRegistrations: { label: "New Registrations (24h)", value: stats.newRegistrations },
    votes24h: { label: "Votes Cast (24h)", value: stats.totalVotes24h },
    totalVotesAll: { label: "Total Votes (all time)", value: stats.totalVotesAll },
    activeToday: { label: "Active Today", value: stats.activeToday },
    activeWeek: { label: "Active This Week", value: stats.activeWeek },
    activeMonth: { label: "Active This Month", value: stats.activeMonth },
    activeYear: { label: "Active This Year", value: stats.activeYear },
    stickiness: { label: "Stickiness (Today / This Month)", value: stickiness === null ? "—" : `${stickiness}%` },
    integrityQueue: { label: "Unreviewed Integrity Events", value: stats.integrityUnreviewed },
  };

  return (
    <div style={{ padding: 24, fontFamily: "Merriweather, Georgia, serif" }}>
      <h2 style={{ marginBottom: 4, color: "#1a1a1a" }}>Dashboard</h2>
      <div style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
        Drag a card by its handle to reorder — saved on this device only.
      </div>

      {/* Reorderable stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {cardOrder.map((id, index) => {
          const def = cardDefs[id];
          if (!def) return null;
          const isDragOver = dragOverIndex === index;
          return (
            <div
              key={id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              style={{
                position: "relative",
                outline: isDragOver ? "2px dashed #2D3DCA" : "none",
                outlineOffset: 2,
                borderRadius: 8,
              }}
            >
              <div
                title="Drag to reorder"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 8,
                  fontSize: 12,
                  color: "#ccc",
                  cursor: "grab",
                  userSelect: "none",
                  lineHeight: 1,
                }}
              >
                ⠿
              </div>
              <StatCard label={def.label} value={def.value} />
            </div>
          );
        })}
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

      {/* Top-5 snapshots -- full top-20/top-10 tables live on the Logs tab */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Top 5 Questions by Votes</div>
          {topVotes.length === 0 ? (
            <div style={{ color: "#999", fontSize: 13 }}>No votes yet.</div>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {topVotes.map((q) => (
                <li key={q.id} style={{ marginBottom: 8 }}>
                  <span style={{ color: "#1a1a1a" }}>{q.text}</span>{" "}
                  <span style={{ color: "#888" }}>— {q.voteCount} votes</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>Top 5 Questions by Comments</div>
          {topComments.length === 0 ? (
            <div style={{ color: "#999", fontSize: 13 }}>No comments yet.</div>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {topComments.map((q) => (
                <li key={q.id} style={{ marginBottom: 8 }}>
                  <span style={{ color: "#1a1a1a" }}>{q.text}</span>{" "}
                  <span style={{ color: "#888" }}>— {q.commentCount} comments</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
