import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { api } from "../api/client";

export default function MatchHistory({ limit = 20 }) {
  const user = useSelector((s) => s.auth.user);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!user) return;
    api.get("/stats/match-history", { params: { limit } })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]));
  }, [user, limit]);
  if (!user) return null;

  return (
    <div className="tw-card">
      <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>📜 Match history</div>
      {!rows.length ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 14 }}>
          No matches yet. Hit VS to play one!
        </div>
      ) : (
        rows.map((r) => {
          const color = r.outcome === "win" ? "var(--good)" : r.outcome === "loss" ? "var(--bad)" : "var(--warn)";
          const tag = r.outcome === "win" ? "WIN" : r.outcome === "loss" ? "LOSS" : "TIE";
          return (
            <div key={r.id} className="tw-row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <span className="tw-pill" style={{ background: color, color: "#fff", border: "none", fontSize: 11, marginRight: 8 }}>{tag}</span>
                <span>vs @{r.opponent}</span>
              </div>
              <div style={{ fontFamily: "Fredoka", fontWeight: 700 }}>
                {r.your_score} <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>–</span> {r.opponent_score}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
