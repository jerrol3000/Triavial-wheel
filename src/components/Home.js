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

const SPIN_DURATION_MS = 4500;
const TICKS_PER_SPIN = WHEEL_DATA.length * 4;

export default function Home() {
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.stats);
  const daily = useSelector((s) => s.daily);
  const mode = useSelector((s) => s.game.mode);

  const [spinning, setSpinning] = React.useState(false);
  const [prize, setPrize] = React.useState(0);
  const [flash, setFlash] = React.useState(false);
  const tickTimers = useRef([]);

  useEffect(() => { dispatch(fetchDailyMeta()); }, [dispatch]);
  useEffect(() => () => tickTimers.current.forEach(clearTimeout), []);

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
    if (stats.lives <= 0 && !stats.pro) {
      dispatch(setView("shop"));
      return;
    }
    const p = Math.floor(Math.random() * WHEEL_DATA.length);
    setPrize(p);
    setSpinning(true);
    sfx.spin();
    // Schedule tick sounds — fast early, slow toward the end (ease-out).
    tickTimers.current.forEach(clearTimeout);
    tickTimers.current = [];
    for (let i = 1; i <= TICKS_PER_SPIN; i++) {
      const t = SPIN_DURATION_MS * (1 - Math.pow(1 - i / TICKS_PER_SPIN, 2));
      tickTimers.current.push(setTimeout(() => sfx.tick(), t));
    }
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
            tickTimers.current.forEach(clearTimeout);
            tickTimers.current = [];
            sfx.coin();
            setFlash(true);
            setTimeout(() => setFlash(false), 320);
            setTimeout(() => startWithCategory(prize), 480);
          }}
        />
      </div>

      <button
        className="tw-btn block"
        disabled={spinning || (stats.lives <= 0 && !stats.pro)}
        onClick={onSpin}
        style={{ maxWidth: 320 }}
      >
        {spinning ? "Spinning..." : stats.lives <= 0 && !stats.pro ? "Out of lives — get more" : "SPIN"}
      </button>

      {!stats.pro && (
        <div className="tw-ad-slot" style={{ maxWidth: 380, width: "100%" }}>
          {/* Replace with real AdSense / Carbon Ads markup in production. */}
          ad slot · upgrade to Pro to remove
        </div>
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
    </div>
  );
}
