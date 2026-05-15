import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { api } from "../api/client";
import { CATEGORIES } from "../data/categories";

const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export default function CategoryMastery() {
  const user = useSelector((s) => s.auth.user);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!user) return;
    api.get("/stats/category-stats").then((r) => setRows(r.data || [])).catch(() => setRows([]));
  }, [user]);
  if (!user || !rows.length) return null;

  return (
    <div className="tw-card">
      <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16, marginBottom: 10 }}>🎯 Category Mastery</div>
      {rows.map((r) => {
        const cat = CATEGORY_BY_ID[r.category_id];
        return (
          <div key={r.category_id} style={{ marginBottom: 8 }}>
            <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: cat ? cat.color : "var(--text-dim)", marginRight: 8 }} />
                {cat ? cat.option : `Category ${r.category_id}`}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {r.accuracy_pct}% · {r.games_played} game{r.games_played === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 6, overflow: "hidden" }}>
              <div style={{
                width: `${r.accuracy_pct}%`,
                height: "100%",
                background: cat ? `linear-gradient(90deg, ${cat.color}, var(--primary-2))` : "var(--primary)",
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
