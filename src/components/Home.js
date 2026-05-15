import React, { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Wheel } from "react-custom-roulette";
import { WHEEL_DATA, CATEGORIES } from "../data/categories";
import { THEMES } from "../data/themes";
import { startRound, fetchRoundQuestions, setMode } from "../store/gameSlice";
import { setView, pushToast } from "../store/uiSlice";
import { sfx } from "../utils/sound";
import { fetchDailyMeta } from "../store/dailySlice";
import { markCategoryPlayed } from "../store/statsSlice";
import { api } from "../api/client";
import QuestsPanel from "./QuestsPanel";

// The wheel's actual duration is set by `spinDuration` below (a multiplier on
// react-custom-roulette's internal default). The tick schedule is self-pacing,
// so it stays in sync regardless of what spinDuration evaluates to.

export default function Home() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const daily = useSelector((s) => s.daily);
  const mode = useSelector((s) => s.game.mode);

  const [spinning, setSpinning] = React.useState(false);
  const [prize, setPrize] = React.useState(0);
  const [flash, setFlash] = React.useState(false);
  const tickHandleRef = useRef(null);

  useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);
  useEffect(() => () => { if (tickHandleRef.current) clearTimeout(tickHandleRef.current); }, []);

  // Self-scheduling tick loop. Starts fast (~70ms between ticks) and slows
  // exponentially toward 500ms. Cancelled in onStopSpinning, so it tracks
  // whatever duration the wheel ends up running for.
  const startTicks = () => {
    if (tickHandleRef.current) clearTimeout(tickHandleRef.current);
    let delay = 70;
    const tick = () => {
      sfx.tick();
      delay = Math.min(500, delay * 1.07);
      tickHandleRef.current = setTimeout(tick, delay);
    };
    tickHandleRef.current = setTimeout(tick, delay);
  };
  const stopTicks = () => {
    if (tickHandleRef.current) clearTimeout(tickHandleRef.current);
    tickHandleRef.current = null;
  };

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
    // If signed in and have free spins, consume one before lives.
    if (hasFreeSpins && useFreeSpinIfPossible()) {
      // free spin used — don't decrement lives
    }
    const p = Math.floor(Math.random() * WHEEL_DATA.length);
    setPrize(p);
    setSpinning(true);
    sfx.spin();
    startTicks();
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
    <div className="tw-col" style={{ gap: 16, alignItems: "center" }}>
      <h1 style={{ textAlign: "center", margin: "8px 0 0", fontSize: 32 }}>Spin to play</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0, textAlign: "center" }}>
        10 questions per round. Streaks multiply your score.
      </p>

      <div className="tw-row" style={{ gap: 6 }}>
        {["easy", "medium", "hard"].map((m) => (
          <button
            key={m}
            className="tw-pill"
            onClick={() => { sfx.click(); dispatch(setMode(m)); }}
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

      <div className="tw-wheel-wrap" style={{ position: "relative", maxWidth: 380, width: "100%" }}>
        {flash && <div className="tw-wheel-flash" />}
        <Wheel
          mustStartSpinning={spinning}
          prizeNumber={prize}
          data={WHEEL_DATA}
          spinDuration={0.6}
          fontSize={13}
          outerBorderWidth={6}
          outerBorderColor={theme.wheelColors[1] || "#ffffff22"}
          innerBorderWidth={4}
          innerBorderColor="#ffffff22"
          radiusLineColor="#ffffff22"
          radiusLineWidth={1}
          backgroundColors={theme.wheelColors}
          textColors={theme.wheelTextColors}
          onStopSpinning={() => {
            setSpinning(false);
            stopTicks();
            sfx.coin();
            setFlash(true);
            setTimeout(() => setFlash(false), 320);
            setTimeout(() => startWithCategory(prize), 480);
          }}
        />
      </div>

      <button
        className="tw-btn block"
        disabled={spinning || ((stats.free_spins || 0) === 0 && stats.lives <= 0 && !stats.pro)}
        onClick={onSpin}
        style={{ maxWidth: 320 }}
      >
        {spinning
          ? "Spinning..."
          : (stats.free_spins || 0) > 0
            ? `SPIN  ·  🎡 ${stats.free_spins} free`
            : stats.lives <= 0 && !stats.pro
              ? "Out of lives — get more"
              : "SPIN"}
      </button>

      {!stats.pro && (
        <button
          className="tw-btn ghost block"
          style={{ maxWidth: 380 }}
          onClick={() => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "free_spin" } } })}
          title="Watch a short ad to earn one free spin (cooldown applies)"
        >
          📺 Watch ad → +1 Free Spin
        </button>
      )}
      {!stats.pro && stats.lives === 0 && (
        <button
          className="tw-btn ghost block"
          style={{ maxWidth: 380 }}
          onClick={() => dispatch({ type: "ui/setModal", payload: { name: "adReward", data: { reward: "life_refill" } } })}
          title="Watch a short ad to refill your lives"
        >
          📺 Watch ad → Refill Lives
        </button>
      )}

      <div className="tw-card" style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ fontSize: 14, color: "var(--text-dim)", letterSpacing: 0.5 }}>TODAY'S CHALLENGE</div>
        <div style={{ fontFamily: "Fredoka", fontSize: 22, fontWeight: 700, margin: "6px 0" }}>
          {daily.alreadyPlayed ? "✓ Already played today" : "📅 New daily ready"}
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>
          Same 10 questions for everyone. Streak: 🔥 {stats.current_daily_streak} (best {stats.longest_daily_streak})
        </div>
        <button className="tw-btn block" onClick={() => { sfx.click(); dispatch(setView("daily")); }}>
          {daily.alreadyPlayed ? "See leaderboard" : "Play daily"}
        </button>
      </div>

      <QuestsPanel />
    </div>
  );
}
