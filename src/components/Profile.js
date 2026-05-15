import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchLeaderboard, fetchStats } from "../store/statsSlice";
import { setModal } from "../store/uiSlice";
import { progressToNext } from "../utils/level";
import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from "../data/achievements";
import { api } from "../api/client";

export default function Profile() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const [tab, setTab] = useState("stats");
  const [rank, setRank] = useState(null);

  useEffect(() => {
    dispatch(fetchLeaderboard());
    if (user) {
      dispatch(fetchStats());
      api.get("/stats/my-rank").then((r) => setRank(r.data)).catch(() => setRank(null));
    } else setRank(null);
  }, [dispatch, user]);

  const prog = progressToNext(stats.xp);
  const winRate = stats.games_played > 0
    ? Math.round((stats.correct / Math.max(1, stats.correct + stats.incorrect)) * 100)
    : 0;

  const unlocked = new Set(stats.achievements.map((a) => a.achievement_id));

  return (
    <div className="tw-col">
      <div className="tw-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, color: "var(--text-dim)" }}>{user ? `@${user.username}` : "Guest"}</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 30, fontWeight: 700, margin: "4px 0" }}>
          ⭐ Level {prog.level}
        </div>
        <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, height: 10, overflow: "hidden", margin: "10px 0" }}>
          <div style={{
            width: `${prog.percent}%`, height: "100%",
            background: "linear-gradient(90deg, var(--primary), var(--primary-2))",
            transition: "width 0.4s ease",
          }} />
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
          {prog.xpInLevel} / {prog.xpForNext} XP to next
        </div>
        {rank && (
          <div className="tw-row" style={{ justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {rank.rank && (
              <span className="tw-pill" title={`Out of ${rank.total} players on the high-score leaderboard`}>
                🏆 #{rank.rank} <span style={{ color: "var(--text-dim)" }}>of {rank.total}</span>
              </span>
            )}
            {rank.online_rank && (
              <span className="tw-pill" title="Your rank on the online VS leaderboard">
                🌐 #{rank.online_rank} <span style={{ color: "var(--text-dim)" }}>of {rank.online_total}</span>
              </span>
            )}
            {rank.high_score > 0 && (
              <span className="tw-pill" title="Your single-game high score">
                ⭐ best {rank.high_score}
              </span>
            )}
          </div>
        )}
        {!user && (
          <button className="tw-btn block" style={{ marginTop: 14 }} onClick={() => dispatch(setModal("auth"))}>
            Sign in to sync & climb the leaderboards
          </button>
        )}
      </div>

      <div className="tw-row" style={{ justifyContent: "center" }}>
        {["stats", "achievements", "leaderboard"].map((t) => (
          <button key={t} className="tw-pill"
                  style={{ cursor: "pointer", background: tab === t ? "rgba(124,58,237,0.4)" : undefined, textTransform: "capitalize" }}
                  onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "stats" && (
        <div className="tw-grid-2">
          <div className="tw-stat"><div className="tw-stat-value">{stats.games_played}</div><div className="tw-stat-label">Games played</div></div>
          <div className="tw-stat"><div className="tw-stat-value">{winRate}%</div><div className="tw-stat-label">Accuracy</div></div>
          <div className="tw-stat"><div className="tw-stat-value">🔥 {stats.best_streak}</div><div className="tw-stat-label">Best streak</div></div>
          <div className="tw-stat"><div className="tw-stat-value">📅 {stats.longest_daily_streak}</div><div className="tw-stat-label">Daily record</div></div>
          <div className="tw-stat"><div className="tw-stat-value">{stats.correct}</div><div className="tw-stat-label">Total correct</div></div>
          <div className="tw-stat"><div className="tw-stat-value">{stats.xp}</div><div className="tw-stat-label">Total XP</div></div>
        </div>
      )}

      {tab === "achievements" && (
        <div className="tw-grid-2">
          {ACHIEVEMENTS.map((a) => {
            const got = unlocked.has(a.id);
            return (
              <div key={a.id} className="tw-card" style={{ opacity: got ? 1 : 0.5, padding: 12 }}>
                <div style={{ fontSize: 28 }}>{a.icon}</div>
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{a.desc}</div>
                {got && <div style={{ fontSize: 11, color: "var(--good)", marginTop: 4 }}>✓ Unlocked</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="tw-card">
          <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Global high scores</div>
          {stats.leaderboard.length === 0 ? (
            <div style={{ color: "var(--text-dim)" }}>No scores yet. Be the first!</div>
          ) : (
            stats.leaderboard.map((r, i) => {
              const mine = user && r.username === user.username;
              return (
                <div key={r.username + i} className="tw-row"
                  style={{
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    margin: "2px -10px",
                    borderRadius: 8,
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    background: mine ? "linear-gradient(90deg, rgba(124,58,237,0.25), rgba(236,72,153,0.25))" : undefined,
                    fontWeight: mine ? 700 : undefined,
                  }}>
                  <span>{i + 1}. {r.username}{mine && " (you)"} <span style={{ color: "var(--text-dim)" }}>· L{r.level}</span></span>
                  <strong>{r.high_score}</strong>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
