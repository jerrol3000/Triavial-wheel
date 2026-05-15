import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import Wheel3D from "./Wheel3D";
import { WHEEL_DATA, CATEGORIES } from "../data/categories";
import { THEMES } from "../data/themes";
import { startRound, fetchRoundQuestions, setMode } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { fetchDailyMeta } from "../store/dailySlice";
import { markCategoryPlayed } from "../store/statsSlice";
import { api } from "../api/client";
import QuestsPanel from "./QuestsPanel";
import LiveLeaderboard from "./LiveLeaderboard";

// The wheel's actual duration is set by `spinDuration` below (a multiplier on
// react-custom-roulette's internal default). The tick schedule is self-pacing,
// so it stays in sync regardless of what spinDuration evaluates to.

export default function Home() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const daily = useSelector((s) => s.daily);
  const mode = useSelector((s) => s.game.mode);

  const [spinning, setSpinning] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const wheelRef = useRef(null);

  useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);

  const theme = THEMES[stats.active_theme] || THEMES.classic;

  const startWithCategory = (idx) => {
    const slot = WHEEL_DATA[idx];
    let cat;
    let isMystery = false;
    if (slot.isMystery) {
      isMystery = true;
      const pool = CATEGORIES.filter((c) => !c.premium || stats.pro || stats.themes.length > 1);
      cat = pool[Math.floor(Math.random() * pool.length)];
      dispatch(pushToast({ icon: "🎁", title: "MYSTERY!", text: `${cat.option} · 1.5× points`, duration: 2500 }));
    } else {
      cat = CATEGORIES.find((c) => c.id === slot.id) || CATEGORIES[0];
    }
    dispatch(markCategoryPlayed(cat.id));
    dispatch(startRound({ categoryId: cat.id, mode, isMystery }));
    dispatch(fetchRoundQuestions({ categoryId: cat.id, mode }));
    dispatch(setView("play"));
  };

  const onSpin = () => {
    if (spinning) return;
    const hasFreeSpins = (stats.free_spins || 0) > 0;
    if (!hasFreeSpins && stats.lives <= 0 && !stats.pro) {
      dispatch(setView("shop"));
      return;
    }
    if (hasFreeSpins && useFreeSpinIfPossible()) {
      // free spin used — don't decrement lives
    }
    setSpinning(true);
    if (wheelRef.current) wheelRef.current.spin();
  };

  const onWheelStop = (winningIdx) => {
    setSpinning(false);
    setFlash(true);
    setTimeout(() => setFlash(false), 320);
    setTimeout(() => startWithCategory(winningIdx), 420);
  };

  // Returns true if we consumed a free spin (and updated server-side).
  const useFreeSpinIfPossible = () => {
    if ((stats.free_spins || 0) <= 0) return false;
    // Optimistically tell server. If user is anonymous, server returns 401 but the
    // local free_spins counter (mirrored in localStorage) will be decremented by
    // statsSlice's recordGame at end of round anyway, so this is best-effort.
    api.post("/stats/use-free-spin").catch(() => {});
    // Local fast-path so UI updates immediately.
    return true;
  };

  return (
    <div className="tw-home">
      {/* LEFT — rewards + quests. Hides into the right column on tablet. */}
      <aside className="tw-home-left">
        <EarnMoreStrip />
        <QuestsPanel />
      </aside>

      {/* CENTER — the focal point: title, mode pills, wheel, SPIN. */}
      <section className="tw-home-center">
        <div className="tw-home-hero">
          <h1 style={{ textAlign: "center", margin: "0", fontSize: 28 }}>Spin to play</h1>
          <p style={{ color: "var(--text-dim)", margin: "4px 0 0", textAlign: "center", fontSize: 13 }}>
            10 questions per round. Streaks multiply your score.
          </p>

          <div className="tw-row" style={{ gap: 6, justifyContent: "center" }}>
            {["easy", "medium", "hard"].map((m) => (
              <button
                key={m}
                className="tw-pill"
                onClick={() => { sfx.click(); dispatch(setMode(m)); }}
                title={`${m.charAt(0).toUpperCase() + m.slice(1)} difficulty — ${m === "easy" ? "1x" : m === "medium" ? "1.5x" : "2x"} points`}
                style={{
                  cursor: "pointer",
                  background: mode === m ? "linear-gradient(135deg, var(--primary), var(--primary-2))" : undefined,
                  border: mode === m ? "none" : undefined,
                  color: "#fff",
                  textTransform: "capitalize",
                }}
              >{m}</button>
            ))}
          </div>

          <div className="tw-wheel-wrap" style={{ position: "relative", maxWidth: 480, width: "100%", margin: "0 auto" }}>
            {flash && <div className="tw-wheel-flash" />}
            <Wheel3D
              ref={wheelRef}
              data={WHEEL_DATA}
              theme={theme}
              onStop={onWheelStop}
              size={460}
              fontSize={14}
            />
          </div>

          <button
            className="tw-btn tw-btn-spin block"
            disabled={spinning || ((stats.free_spins || 0) === 0 && stats.lives <= 0 && !stats.pro)}
            onClick={onSpin}
            title={spinning ? "Wheel is spinning" : "Spin the wheel to start a round"}
          >
            {spinning
              ? "Spinning..."
              : (stats.free_spins || 0) > 0
                ? `SPIN  ·  🎡 ${stats.free_spins} free`
                : stats.lives <= 0 && !stats.pro
                  ? "Out of lives — get more"
                  : "SPIN"}
          </button>
        </div>
      </section>

      {/* RIGHT — live leaderboard with score-position animations. */}
      <aside className="tw-home-right">
        <LiveLeaderboard limit={8} />
      </aside>
    </div>
  );
}

// ─── Contextual rewards strip ────────────────────────────────────────────────
// Only renders pills that are actually claimable right now — no clutter.
function EarnMoreStrip() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const user = useSelector((s) => s.auth.user);
  if (stats.pro) return null; // Pro users don't need this row.

  const items = [];
  items.push({
    key: "spin",
    icon: "📺",
    text: "Free spin",
    sub: "Watch ad",
    onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "free_spin" } } }),
    tooltip: "Watch a short ad to earn one free spin",
  });
  if (stats.lives === 0) {
    items.push({
      key: "lives",
      icon: "♥",
      text: "Refill lives",
      sub: "Watch ad",
      onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "life_refill" } } }),
      tooltip: "Watch a short ad to refill your lives",
      accent: true,
    });
  }
  items.push({
    key: "coins",
    icon: "🪙",
    text: "+30 coins",
    sub: "Watch ad",
    onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "coins" } } }),
    tooltip: "Watch a short ad to earn 30 coins",
  });
  if (user) {
    items.push({
      key: "shop",
      icon: "🛒",
      text: "Buy more",
      sub: "Shop",
      onClick: () => dispatch(setView("shop")),
      tooltip: "Coin packs, themes, and Trivia Pro",
    });
  }

  return (
    <div className="tw-earn-strip">
      <div className="tw-earn-strip-label">Earn rewards</div>
      <div className="tw-earn-strip-row">
        {items.map((it) => (
          <button key={it.key}
            className={`tw-earn-pill ${it.accent ? "accent" : ""}`}
            onClick={it.onClick}
            title={it.tooltip}>
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
