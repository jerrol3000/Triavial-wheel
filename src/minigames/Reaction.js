import React, { useEffect, useState, useRef } from "react";
import { sfx } from "../utils/sound";
import { makeRng } from "./_seed";

// Reaction — wait for the screen to turn green, then tap as fast as
// you can. Tap before green = penalty (counted as 0). Score is
// max(0, 1000 - reaction_ms), so 200ms → 800, 500ms → 500, late or
// false-start → 0. Server caps at 900 (sub-100ms is impossible).
//
// Seeded delay so both players see the SAME wait time — otherwise a
// player who got a 0.8s delay would have an unfair edge over one who
// got a 2.5s delay (longer waits inflate variance + are stressful).
//
// Phase chart:
//   ready  → tap to begin
//   wait   → red screen, "WAIT…"
//   go     → green screen, "TAP NOW!"
//   done   → result card

const MIN_WAIT_MS = 1500;
const MAX_WAIT_MS = 4000;

export default function Reaction({ onComplete, seed }) {
  const [phase, setPhase] = useState("ready");
  const [reactionMs, setReactionMs] = useState(null);
  const goAtRef = useRef(0);
  const timerRef = useRef(null);
  const doneRef = useRef(false);

  const begin = () => {
    if (phase !== "ready") return;
    setPhase("wait");
    const rng = makeRng(seed);
    const waitMs = MIN_WAIT_MS + Math.floor(rng.float() * (MAX_WAIT_MS - MIN_WAIT_MS));
    goAtRef.current = Date.now() + waitMs;
    timerRef.current = setTimeout(() => {
      setPhase("go");
      goAtRef.current = Date.now(); // overwrite to the actual go-instant
    }, waitMs);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const finish = (score, ms) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setReactionMs(ms);
    setPhase("done");
    if (score > 600) sfx.win?.();
    else sfx.click?.();
    onComplete({ score });
  };

  const onTap = () => {
    if (phase === "ready") return begin();
    if (phase === "wait") {
      // FALSE START — tapped before green. Counts as 0.
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      finish(0, -1);
      return;
    }
    if (phase === "go") {
      const ms = Date.now() - goAtRef.current;
      // Score = max(0, 1000 - ms). 200ms → 800, 500ms → 500, 1000ms → 0.
      const score = Math.max(0, 1000 - ms);
      finish(score, ms);
    }
  };

  const bg = phase === "wait" ? "linear-gradient(135deg, #dc2626, #991b1b)"
           : phase === "go"   ? "linear-gradient(135deg, #10b981, #059669)"
           : phase === "done" ? "rgba(255,255,255,0.04)"
                              : "linear-gradient(135deg, #1f2937, #111827)";

  const label = phase === "ready" ? "Tap to start"
              : phase === "wait"  ? "WAIT…"
              : phase === "go"    ? "TAP NOW!"
                                  : reactionMs === -1 ? "Too early! Score: 0"
                                                      : `${reactionMs}ms · score ${Math.max(0, 1000 - reactionMs)}`;

  return (
    <div className="tw-card" style={{ textAlign: "center", userSelect: "none" }}>
      <div style={{ fontFamily: "Fredoka", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
        ⚡ Reaction
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Wait for GREEN, then tap fast. Don't false-start!
      </div>

      <button
        onClick={onTap}
        disabled={phase === "done"}
        style={{
          width: "100%", padding: "80px 16px",
          fontSize: 36, fontFamily: "Fredoka", fontWeight: 800,
          borderRadius: 18, border: "none", cursor: "pointer",
          background: bg, color: "#fff",
          transition: "background 0.15s",
        }}
      >
        {label}
      </button>
    </div>
  );
}
