import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { setView, setModal } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { fetchDailyMeta } from "../store/dailySlice";
import QuestsHub from "./QuestsHub";
import GuestWelcome from "./GuestWelcome";
import StreakBanner from "./StreakBanner";
import LiveLeaderboard from "./LiveLeaderboard";
import Icon from "./Icon";
import { useT } from "../i18n";
import { rt } from "../realtime/client";
import { api } from "../api/client";

// Home — a clean 2×3 grid of game modes.
//
// 2026 re-architecture: the wheel used to live HERE as the visual
// hero, with everything else relegated to small tiles. Worked when
// the wheel was the only mode, but Spinlore now has 6+ distinct
// ways to play, and treating one as "the home page" demotes all the
// others. New shape:
//
//   ┌─────────────┬─────────────┬─────────────┐
//   │   📅 Daily  │ 📈 H/L      │  ⚔️ Friends  │
//   ├─────────────┼─────────────┼─────────────┤
//   │   🎡 Wheel  │  🆚 VS      │  ⭐ Season   │
//   └─────────────┴─────────────┴─────────────┘
//
// Each tile dispatches setView to its own dedicated screen. The wheel
// lives at /views/wheel now (WheelView.js) — same logic, just no
// longer hijacks the home page. Mobile collapses to 1 column; tablet+
// keeps the 3-column grid.

export default function Home() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const stats = useSelector((s) => s.stats);
  const { t } = useT();

  React.useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);

  // The 6 tiles. Each is fully self-contained (icon, title, subtitle,
  // gradient, target view) so adding a 7th mode later is one entry.
  const tiles = [
    {
      id: "daily", icon: "📅",
      title: "Daily Challenge",
      subtitle: "5 questions. Everyone gets the same set. Streak-eligible.",
      bg: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.18))",
      border: "rgba(245,158,11,0.4)",
      action: () => dispatch(setView("daily")),
      authedOnly: false,
    },
    {
      id: "higherlower", icon: "📈",
      title: "Higher or Lower",
      subtitle: "Songs, movies, followers — which is bigger? 1-second decisions.",
      bg: "linear-gradient(135deg, rgba(34,211,238,0.18), rgba(124,58,237,0.18))",
      border: "rgba(34,211,238,0.4)",
      action: () => dispatch(setView("higherlower")),
      authedOnly: true,
    },
    {
      id: "challenges", icon: "⚔️",
      title: "Friend Challenges",
      subtitle: "Send a 5-q duel. Wager coins. Winner takes the pot.",
      bg: "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(236,72,153,0.18))",
      border: "rgba(245,158,11,0.4)",
      action: () => dispatch(setView("challenges")),
      authedOnly: true,
    },
    {
      id: "wheel", icon: "🎡",
      title: "Spin the Wheel",
      subtitle: "Classic trivia — wheel picks a category, 10 questions.",
      bg: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))",
      border: "rgba(124,58,237,0.4)",
      action: () => dispatch(setView("wheel")),
      authedOnly: false,
      badge: !stats.pro && (stats.free_spins || 0) > 0 ? `${stats.free_spins} spins` : null,
    },
    {
      id: "online", icon: "🆚",
      title: "VS Online",
      subtitle: "Real-time 1v1 against a stranger or a friend.",
      bg: "linear-gradient(135deg, rgba(16,185,129,0.18), rgba(34,211,238,0.18))",
      border: "rgba(16,185,129,0.4)",
      // PRE-WARM the WS + server health BEFORE navigating to the
      // Online view. This eliminates the "Connecting to live
      // server…" banner for users who land on the app fresh, since
      // by the time the Online view's useEffect calls rt.connect()
      // again, the connection is usually already open. Both calls
      // are idempotent (rt.connect short-circuits on an active
      // socket; /api/health is cheap), so firing them twice is a
      // free defense against cold-start jank.
      action: () => {
        try { rt.connect(); } catch (e) {}
        try { api.get("/health").catch(() => {}); } catch (e) {}
        dispatch(setView("online"));
      },
      authedOnly: true,
    },
    {
      id: "season", icon: "⭐",
      title: "Season Pass",
      subtitle: "20 tiers of rewards. Play to climb. Premium = the good stuff.",
      bg: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(236,72,153,0.18))",
      border: "rgba(236,72,153,0.4)",
      action: () => dispatch(setView("season")),
      authedOnly: true,
    },
  ];

  return (
    <div className="tw-home">
      {/* LEFT — rewards strip + active quests. Hides into the right
          column on tablet via existing tw-home-left styles. */}
      <aside className="tw-home-left">
        <EarnMoreStrip />
        <QuestsHub />
      </aside>

      {/* CENTER — the mode grid. */}
      <section className="tw-home-center">
        {!user && <GuestWelcome />}
        <StreakBanner />

        <div style={{ textAlign: "center", margin: "8px 0 4px" }}>
          <h1 style={{ margin: 0, fontSize: 26 }}>{t("home.title") || "Spin. Answer. Get roasted."}</h1>
          <p style={{ color: "var(--text-dim)", margin: "6px 0 0", fontSize: 13 }}>
            {t("home.subtitle") || "Pick how you want to play."}
          </p>
        </div>

        {/* Hierarchy: two hero tiles (Daily + VS) at full row width,
            then a 2x2 grid of secondary modes. This reflects the
            actual usage funnel — Daily is the universal entry-point
            and VS is the brand-defining social hook. Higher/Lower,
            Wheel, Friend Challenges, and Season Pass are all great
            but secondary in priority for a new session.
            On screens >= 720px the secondary 2x2 expands to 4x1
            for a more spacious layout. */}
        {(() => {
          const heroIds = new Set(["daily", "online"]);
          const heroTiles = tiles.filter((t) => heroIds.has(t.id));
          const secondaryTiles = tiles.filter((t) => !heroIds.has(t.id));
          const renderTile = (tile, hero) => {
            const locked = tile.authedOnly && !user;
            return (
              <button
                key={tile.id}
                className={`tw-card tw-mode-tile ${locked ? "locked" : ""} ${hero ? "hero" : ""}`}
                onClick={() => {
                  sfx.click();
                  if (locked) {
                    dispatch(setModal({ name: "auth", data: { tab: "register", reason: tile.id } }));
                  } else {
                    tile.action();
                  }
                }}
                style={{
                  cursor: "pointer",
                  background: locked ? "rgba(255,255,255,0.04)" : tile.bg,
                  border: `1px solid ${locked ? "rgba(255,255,255,0.1)" : tile.border}`,
                  textAlign: hero ? "left" : "center",
                  padding: hero ? "20px 20px" : "20px 14px",
                  minHeight: hero ? 100 : 140,
                  display: "flex",
                  flexDirection: hero ? "row" : "column",
                  alignItems: "center",
                  justifyContent: hero ? "flex-start" : "center",
                  gap: hero ? 16 : 6,
                  position: "relative",
                  opacity: locked ? 0.7 : 1,
                  transition: "transform 0.12s ease, filter 0.12s ease",
                }}
              >
                {tile.badge && (
                  <span style={{
                    position: "absolute", top: 8, right: 8,
                    fontSize: 10, fontWeight: 700,
                    padding: "2px 8px", borderRadius: 999,
                    background: "rgba(0,0,0,0.35)", color: "#fff", letterSpacing: 0.5,
                  }}>{tile.badge}</span>
                )}
                {locked && (
                  <span style={{
                    position: "absolute", top: 8, right: 8,
                    fontSize: 11, color: "var(--text-dim)",
                  }}>🔒</span>
                )}
                <div style={{ fontSize: hero ? 48 : 36, lineHeight: 1, flex: hero ? "0 0 auto" : undefined }} aria-hidden="true">{tile.icon}</div>
                <div style={{ flex: hero ? 1 : undefined, minWidth: 0 }}>
                  <div style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: hero ? 18 : 16 }}>{tile.title}</div>
                  <div style={{ fontSize: hero ? 13 : 12, color: "var(--text-dim)", lineHeight: 1.35, maxWidth: hero ? "none" : 240, marginTop: hero ? 4 : 0 }}>
                    {tile.subtitle}
                  </div>
                </div>
                {hero && (
                  <div className="tw-pill" style={{ background: "rgba(255,255,255,0.15)", border: "none", fontWeight: 700, color: "#fff", flex: "0 0 auto" }}>
                    Play →
                  </div>
                )}
              </button>
            );
          };
          return (
            <>
              <div className="tw-mode-hero-stack">
                {heroTiles.map((t) => renderTile(t, /* hero */ true))}
              </div>
              <div className="tw-mode-grid">
                {secondaryTiles.map((t) => renderTile(t, /* hero */ false))}
              </div>
            </>
          );
        })()}
      </section>

      {/* RIGHT — live leaderboard. */}
      <aside className="tw-home-right">
        <LiveLeaderboard limit={8} />
      </aside>
    </div>
  );
}

// ─── Earn-rewards row (kept from old Home, scoped down) ─────────────
// Only renders pills that are actually claimable right now — no clutter.
function EarnMoreStrip() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  if (stats.pro) return null;

  const items = [
    {
      key: "spin", icon: <Icon name="free_spin" size={26} />, text: "Free spin", sub: "Watch ad",
      onClick: () => dispatch(setModal({ name: "adReward", data: { reward: "free_spin" } })),
    },
    {
      key: "coins", icon: <Icon name="coins" size={26} />, text: "+30 coins", sub: "Watch ad",
      onClick: () => dispatch(setModal({ name: "adReward", data: { reward: "coins" } })),
    },
  ];

  return (
    <div className="tw-earn-strip">
      <div className="tw-earn-strip-label">Earn rewards</div>
      <div className="tw-earn-strip-row">
        {items.map((it) => (
          <button key={it.key} className="tw-earn-pill" onClick={it.onClick}>
            <span className="tw-earn-icon">{it.icon}</span>
            <span className="tw-earn-text">
              <strong>{it.text}</strong>
              <span>{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
