import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { api } from "../api/client";
import { useT } from "../i18n";

export default function GlobalLeaderboard({ limit = 10 }) {
  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const user = useSelector((s) => s.auth.user);
  const { t } = useT();

  useEffect(() => {
    fetch((process.env.API_BASE_URL || "/api") + "/stats/leaderboard")
      .then((r) => r.json()).then(setRows).catch(() => setRows([]));
    if (user) {
      api.get("/stats/my-rank").then((r) => setMyRank(r.data)).catch(() => setMyRank(null));
    } else {
      setMyRank(null);
    }
  }, [user]);

  return (
    <div className="tw-card" style={{ width: "100%", maxWidth: 380 }}>
      <div className="tw-row" style={{ marginBottom: 8, gap: 6 }}>
        <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 16 }}>{t("home.leaderboard.title")}</div>
        <div style={{ flex: 1 }} />
        {myRank && myRank.rank && (
          <span className="tw-pill" title="Your global rank">
            #{myRank.rank}<span style={{ color: "var(--text-dim)" }}>/{myRank.total}</span>
          </span>
        )}
      </div>
      {!rows.length ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 12 }}>
          {t("home.leaderboard.empty")}
        </div>
      ) : (
        <>
          {rows.slice(0, limit).map((r, i) => {
            const mine = user && r.username === user.username;
            return (
              <div key={r.username + i} className="tw-row"
                style={{
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  margin: "2px -10px",
                  borderRadius: 8,
                  background: mine ? "linear-gradient(90deg, rgba(124,58,237,0.25), rgba(236,72,153,0.25))" : undefined,
                  fontWeight: mine ? 700 : undefined,
                  fontSize: 13,
                }}>
                <span>
                  {i + 1 <= 3 ? ["🥇","🥈","🥉"][i] : `${i + 1}.`} {r.username}{mine && ` (${t("common.you").toLowerCase()})`}
                  <span style={{ color: "var(--text-dim)" }}> · L{r.level}</span>
                </span>
                <strong>{r.high_score}</strong>
              </div>
            );
          })}
          {myRank && myRank.rank > limit && (
            <div className="tw-row" style={{
              justifyContent: "space-between", padding: "6px 10px", margin: "6px -10px 0",
              borderRadius: 8, background: "linear-gradient(90deg, rgba(124,58,237,0.25), rgba(236,72,153,0.25))",
              fontWeight: 700, fontSize: 13, borderTop: "1px dashed var(--card-border)",
            }}>
              <span>#{myRank.rank}. {user?.username} ({t("common.you").toLowerCase()})</span>
              <strong>{myRank.high_score}</strong>
            </div>
          )}
        </>
      )}
    </div>
  );
}
