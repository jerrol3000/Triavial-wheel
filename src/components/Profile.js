import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchLeaderboard, fetchStats } from "../store/statsSlice";
import { setModal, setProfileTab } from "../store/uiSlice";
import { progressToNext } from "../utils/level";
import { ACHIEVEMENTS } from "../data/achievements";
import { api } from "../api/client";
import FriendsPanel from "./FriendsPanel";
import MatchHistory from "./MatchHistory";
import CategoryMastery from "./CategoryMastery";
import Avatar from "./Avatar";
import Icon from "./Icon";
import BadgesPanel from "./BadgesPanel";
import Inventory from "./Inventory";
import { BadgeCase } from "./PlayerFlair";

export default function Profile() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  const deepLinkTab = useSelector((s) => s.ui.profileTab);
  const [tab, setTab] = useState(deepLinkTab || "stats");
  const [rank, setRank] = useState(null);

  // Honor incoming deep-link from other views (e.g., Store's Inventory
  // pill), then clear the signal so default landing stays at "stats" on
  // subsequent Profile visits.
  useEffect(() => {
    if (deepLinkTab) {
      setTab(deepLinkTab);
      dispatch(setProfileTab(null));
    }
  }, [deepLinkTab, dispatch]);

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
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <Avatar value={user?.avatar} size={88} ring me={!!user} />
        </div>
        {user && <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <ProfileBadgeCase />
        </div>}
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

      <div className="tw-store-tabs">
        {["stats", "inventory", "badges", "achievements", "leaderboard", "friends", "history"].map((t) => (
          <button key={t}
                  className={`tw-store-tab ${tab === t ? "active" : ""}`}
                  onClick={() => setTab(t)}
                  style={{ textTransform: "capitalize" }}>
            <span>{t}</span>
          </button>
        ))}
      </div>

      {tab === "inventory" && <Inventory />}
      {tab === "badges" && <BadgesPanel />}

      {tab === "stats" && (
        <>
          <div className="tw-grid-2">
            <div className="tw-stat"><div className="tw-stat-value">{stats.games_played}</div><div className="tw-stat-label">Games played</div></div>
            <div className="tw-stat"><div className="tw-stat-value">{winRate}%</div><div className="tw-stat-label">Accuracy</div></div>
            <div className="tw-stat"><div className="tw-stat-value">🔥 {stats.best_streak}</div><div className="tw-stat-label">Best streak</div></div>
            <div className="tw-stat"><div className="tw-stat-value">📅 {stats.longest_daily_streak}</div><div className="tw-stat-label">Daily record</div></div>
            <div className="tw-stat"><div className="tw-stat-value">{stats.correct}</div><div className="tw-stat-label">Total correct</div></div>
            <div className="tw-stat"><div className="tw-stat-value">{stats.xp}</div><div className="tw-stat-label">Total XP</div></div>
          </div>
          <CategoryMastery />
          <ShowcasePrivacyCard />
        </>
      )}
      {tab === "friends" && <FriendsPanel />}
      {tab === "history" && <MatchHistory />}

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
          <div style={{ fontFamily: "Fredoka", fontSize: 18, fontWeight: 700, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="leaderboard" size={22} /> Global high scores
          </div>
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

function ProfileBadgeCase() {
  const equipped = useSelector((s) => s.badges.equipped);
  if (!equipped || !equipped.length) return null;
  return <BadgeCase badges={equipped} size="md" />;
}

// Privacy control for the public-profile showcase. When toggled off,
// other players tapping this user's row in the leaderboard / VS see
// only their name, level, and PRO badge — all cosmetics, equipped
// badges, and lifetime stats are hidden. The bling itself doesn't
// disappear from THIS user's own views; it just stops being exposed
// to others via /api/stats/profile/:id.
function ShowcasePrivacyCard() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  // showcase_public defaults to 1 on the server — treat undefined as on
  // so an old client that hasn't refetched stats still shows the right
  // value at first render.
  const on = stats.showcase_public !== 0;
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api.put("/stats", { showcase_public: on ? 0 : 1 });
      dispatch(fetchStats());
    } catch (e) {}
    setBusy(false);
  };
  return (
    <div className="tw-card" style={{ marginTop: 12 }}>
      <div className="tw-row" style={{ marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 20 }}>{on ? "🌟" : "🔒"}</span>
        <strong style={{ fontFamily: "Fredoka", fontSize: 15 }}>
          Public showcase
        </strong>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="tw-pill"
          style={{
            cursor: "pointer",
            background: on
              ? "linear-gradient(135deg, var(--primary, #7c3aed), var(--primary-2, #ec4899))"
              : "rgba(255,255,255,0.06)",
            border: on ? "none" : "1px solid rgba(255,255,255,0.18)",
            color: "#fff",
            fontWeight: 700,
            minWidth: 56,
          }}
        >{on ? "ON" : "OFF"}</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
        {on
          ? "Other players who tap your name see your frame, title, badges, achievements count, and lifetime stats. Your email and settings stay private."
          : "Other players who tap your name only see your username, level, and PRO badge. Your cosmetics, badges, and stats are hidden."}
      </div>
    </div>
  );
}
