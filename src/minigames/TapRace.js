import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";

// Tap Race — tap the big button as fast as you can in 5 seconds.
// Score = number of taps (server clamps to max_score = 75, which is
// 15 taps/sec — well above realistic single-finger ceilings).
//
// Why this game leads the launch lineup: zero learning curve, satisfying
// haptic loop (every tap visibly increments the count), and a clear
// "did I win" outcome. Also the most TikTok-able — watching someone
// lose at the simplest possible game is the joke.

const DURATION_MS = 5000;

export default function TapRace({ onComplete, seed }) {
  const [taps, setTaps] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_MS);
  const [phase, setPhase] = useState("ready"); // ready | racing | done
  const startRef = useRef(0);
  const doneRef = useRef(false);

  // Countdown to start — single tap on the screen begins the race.
  // No 3-2-1 timer; that's friction we don't want. The button copy
  // makes the start-tap obvious.
  const start = () => {
    if (phase !== "ready") return;
    setPhase("racing");
    startRef.current = Date.now();
  };

  useEffect(() => {
    if (phase !== "racing") return;
    const tick = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, DURATION_MS - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        finish();
      }
    }, 50);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPhase("done");
    sfx.win?.();
    onComplete({ score: taps });
  };

  // Tap handler — counts the tap if we're racing.
  const onTap = () => {
    if (phase === "ready") return start();
    if (phase !== "racing") return;
    setTaps((t) => t + 1);
    sfx.click?.();
  };

  // Tap count visually pops on every increment.
  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
        👆 Tap Race
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Tap as fast as you can!
      </div>

      <div style={{
        fontFamily: "Fredoka", fontSize: 60, fontWeight: 800, marginBottom: 8,
        color: phase === "racing" ? "var(--accent, #fb923c)" : "var(--text)",
        transition: "color 0.2s",
      }}>
        {taps}
      </div>

      {phase === "racing" && (
        <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", marginBottom: 18 }}>
          <div style={{
            height: "100%",
            width: `${(remaining / DURATION_MS) * 100}%`,
            background: "linear-gradient(90deg, #fb923c, #ef4444)",
            transition: "width 50ms linear",
          }} />
        </div>
      )}

      <button
        onClick={onTap}
        disabled={phase === "done"}
        style={{
          width: "100%", padding: "32px 16px",
          fontSize: 28, fontFamily: "Fredoka", fontWeight: 800,
          borderRadius: 18, border: "none", cursor: "pointer",
          background: phase === "racing"
            ? "linear-gradient(135deg, #fb923c, #ef4444)"
            : phase === "done"
            ? "rgba(255,255,255,0.08)"
            : "linear-gradient(135deg, #f59e0b, #ef4444)",
          color: "#fff",
          transform: phase === "racing" ? "scale(0.98)" : "scale(1)",
          transition: "transform 0.05s, background 0.2s",
        }}
      >
        {phase === "ready" ? "TAP TO START" : phase === "racing" ? "TAP! TAP! TAP!" : `Done — ${taps}`}
      </button>

      {phase === "racing" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
          {(remaining / 1000).toFixed(1)}s left
        </div>
      )}
    </div>
  );
}
