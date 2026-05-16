import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import Wheel3D from "./Wheel3D";
import { WHEEL_DATA, CATEGORIES } from "../data/categories";
import { THEMES } from "../data/themes";
import { startRound, fetchRoundQuestions, setMode } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { fetchDailyMeta } from "../store/dailySlice";
import { markCategoryPlayed, consumeFreeSpin } from "../store/statsSlice";
import { api } from "../api/client";
import QuestsPanel from "./QuestsPanel";
import LiveLeaderboard from "./LiveLeaderboard";
import Icon from "./Icon";

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
  // Track the two setTimeouts fired in onWheelStop so we can cancel them
  // if the component unmounts (navigation away) before they fire. Without
  // this, the wheel stop will force a view change after the user has
  // already left the page.
  const flashTimerRef = useRef(null);
  const navTimerRef = useRef(null);

  useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (navTimerRef.current) clearTimeout(navTimerRef.current);
    };
  }, []);

  const theme = THEMES[stats.active_theme] || THEMES.classic;

  const startWithCategory = (idx) => {
    const slot = WHEEL_DATA[idx];
    let cat;
    let isMystery = false;
    if (slot.isMystery) {
      isMystery = true;
      // Premium-only categories are gated by Pro status. Previously
      // also unlocked when stats.themes.length > 1 — but buying any
      // theme bumps that, which let non-Pro users bypass the gate. Now
      // strictly Pro-only.
      const pool = CATEGORIES.filter((c) => !c.premium || stats.pro);
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
    try { window.dispatchEvent(new Event("triviaspin")); } catch (e) {}
  };

  const onWheelStop = (winningIdx) => {
    setSpinning(false);
    setFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(false), 320);
    navTimerRef.current = setTimeout(() => startWithCategory(winningIdx), 420);
  };

  // Returns true if we consumed a free spin. Dispatches the local
  // reducer so the counter in the banner updates immediately, then
  // mirrors to the server. Avoids the previous bug where UI showed the
  // stale count until the next fetchStats.
  const useFreeSpinIfPossible = () => {
    if ((stats.free_spins || 0) <= 0) return false;
    dispatch(consumeFreeSpin());
    api.post("/stats/use-free-spin").catch(() => {});
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

          {/* Aggregate "spins left" = free_spins + lives (for non-Pro).
              When zero, swap the SPIN button for an action card pointing
              players at the ways to replenish (ads / store). Pro players
              never see the gate — unlimited lives = infinite spins. */}
          {(() => {
            const spinsLeft = (stats.free_spins || 0) + (stats.pro ? 99 : (stats.lives || 0));
            if (spinsLeft <= 0 && !stats.pro) {
              return <OutOfSpinsCard />;
            }
            return (
              <button
                className="tw-btn tw-btn-spin block"
                disabled={spinning}
                onClick={onSpin}
                title={spinning ? "Wheel is spinning" : "Spin the wheel to start a round"}
              >
                {spinning
                  ? "Spinning..."
                  : (stats.free_spins || 0) > 0
                    ? `SPIN  ·  🎡 ${stats.free_spins} free`
                    : "SPIN"}
              </button>
            );
          })()}
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
    icon: <Icon name="free_spin" size={26} />,
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
    icon: <Icon name="coins" size={26} />,
    text: "+30 coins",
    sub: "Watch ad",
    onClick: () => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "coins" } } }),
    tooltip: "Watch a short ad to earn 30 coins",
  });
  // Shop intentionally omitted here — the bottom nav has a persistent Shop
  // tab, and duplicating it on the home rail clutters the rewards row.

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

// When the player has used every spin (free_spins + lives both 0 and
// not Pro) the SPIN button is replaced with this card — three clear
// paths back into play: watch an ad, hop to the spin packs in the
// Store, or upgrade to Pro for unlimited.
function OutOfSpinsCard() {
  const dispatch = useDispatch();
  return (
    <div className="tw-out-of-spins">
      <div className="tw-out-of-spins-title">🎡 Out of spins</div>
      <div className="tw-out-of-spins-sub">Pick how you want to keep playing:</div>
      <div className="tw-out-of-spins-actions">
        <button
          className="tw-btn ghost"
          onClick={() => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "free_spin" } } })}
          title="Watch a short ad for a free spin">
          <Icon name="free_spin" size={22} /> Watch ad — 1 spin
        </button>
        <button
          className="tw-btn"
          onClick={() => dispatch(setView("shop"))}
          title="Buy a spin pack with your coins">
          🛒 Buy spin pack
        </button>
      </div>
      <div className="tw-out-of-spins-pro">
        Or <button className="tw-link" onClick={() => dispatch(setView("shop"))}>upgrade to Pro</button> for unlimited.
      </div>
    </div>
  );
}
