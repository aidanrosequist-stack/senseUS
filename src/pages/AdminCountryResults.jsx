// AdminCountryResults.jsx
//
// "Results by country" for one question, shown under the trend chart in
// Admin -> Questions (AdminQuestionTrend.jsx), which also adds the same
// data to its XLSX/PDF export.
//
// Backed by get_question_country_results() (migration 114). Every vote
// carries the country its voter had chosen when voting, plus a
// "verified" flag: whether that country matched the country of their
// verified phone number. Nobody is excluded. "All respondents" counts
// everyone; "Verified only" counts just the matching ones, which is the
// figure to lead with in B2B reports.

import { useEffect, useState } from "react";
import { VERIFIED_EXPLANATION, countryLabel, fetchCountryResults, rowFigures } from "../lib/countryResults";

const cell = { padding: "6px 8px", borderBottom: "1px solid #f0f0f0", fontSize: 12, textAlign: "right", whiteSpace: "nowrap" };
const headCell = { ...cell, color: "#666", fontWeight: 600, borderBottom: "1px solid #ddd" };

export default function AdminCountryResults({ supabase, question }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCountryResults(supabase, question.id)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, question.id]);

  const shown = rows
    .map((r) => ({ code: r.country_code, ...rowFigures(r, verifiedOnly), verified: r.verified_respondents, all: r.respondents }))
    .filter((r) => r.respondents > 0);
  const totalAll = rows.reduce((s, r) => s + r.respondents, 0);
  const totalVerified = rows.reduce((s, r) => s + r.verified_respondents, 0);

  const toggle = (on, label) => (
    <button
      onClick={() => setVerifiedOnly(on)}
      style={{
        fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600,
        border: "1px solid #2D3DCA",
        background: verifiedOnly === on ? "#2D3DCA" : "white",
        color: verifiedOnly === on ? "white" : "#2D3DCA",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>Results by country</div>
        <div style={{ display: "flex", gap: 4 }}>
          {toggle(false, "All respondents")}
          {toggle(true, "Verified only")}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>
        {totalVerified.toLocaleString()} of {totalAll.toLocaleString()} respondents verified. {VERIFIED_EXPLANATION}
      </div>

      {loading ? (
        <div style={{ color: "#999", fontSize: 13 }}>Loading…</div>
      ) : error ? (
        <div style={{ color: "#c21f1f", fontSize: 13 }}>Couldn't load country results: {error}</div>
      ) : shown.length === 0 ? (
        <div style={{ color: "#999", fontSize: 13 }}>
          {verifiedOnly ? "No verified respondents yet." : "No votes yet."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...headCell, textAlign: "left" }}>Country</th>
                <th style={headCell}>Respondents</th>
                {!verifiedOnly && <th style={headCell}>Verified</th>}
                <th style={headCell}>Yes</th>
                <th style={headCell}>Leaning yes</th>
                <th style={headCell}>Leaning no</th>
                <th style={headCell}>No</th>
                <th style={headCell}>Yes side</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code || "none"}>
                  <td style={{ ...cell, textAlign: "left" }}>{countryLabel(r.code)}</td>
                  <td style={cell}>{r.respondents.toLocaleString()}</td>
                  {!verifiedOnly && (
                    <td style={cell}>{r.all ? `${Math.round((r.verified / r.all) * 100)}%` : "—"}</td>
                  )}
                  <td style={cell}>{r.yes}</td>
                  <td style={cell}>{r.ly}</td>
                  <td style={cell}>{r.ln}</td>
                  <td style={cell}>{r.no}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{r.pctYesSide == null ? "—" : `${r.pctYesSide}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: "#aaa", marginTop: 6 }}>
        Yes side = yes + leaning yes, as a share of all four stances, integrity-weighted (same formula as the results card).
      </div>
    </div>
  );
}
